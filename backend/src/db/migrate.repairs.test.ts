import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

const state = vi.hoisted(() => ({ sqlite: null as any }));
vi.mock("./client", () => ({ db: { get $client() { return state.sqlite; } } }));
vi.mock("./seed", () => ({ seedDb: vi.fn() }));

import { backfillFinalDayPeriodAssignments, ensureSubscriptionBillingDay, normalizeLegacyPeriodBoundaries } from "./migrate";

// vitest pins TZ to Asia/Jakarta, matching production.
const local = (year: number, month: number, day: number, hour = 0) => new Date(year, month - 1, day, hour).getTime();

describe("startup data repairs", () => {
  beforeEach(() => {
    state.sqlite = new Database(":memory:");
    state.sqlite.exec(`
      CREATE TABLE salary_period (id integer PRIMARY KEY, start_date integer NOT NULL, end_date integer NOT NULL);
      CREATE TABLE "transaction" (id integer PRIMARY KEY, date integer NOT NULL, period_id integer);
      CREATE TABLE audit_log (id integer PRIMARY KEY, entity_type text, entity_id integer, action text, before_snapshot blob, after_snapshot blob);
      CREATE TABLE subscription (id integer PRIMARY KEY, next_renewal_at integer NOT NULL);
      CREATE TABLE recurring_occurrence (id integer PRIMARY KEY, job_type text, schedule_id integer, occurrence_date integer);
    `);
  });
  afterEach(() => state.sqlite.close());

  it("assigns last-day transactions to their period and nothing else", () => {
    state.sqlite.prepare("INSERT INTO salary_period VALUES (1, ?, ?)").run(local(2026, 8, 25), local(2026, 9, 24));
    const insert = state.sqlite.prepare(`INSERT INTO "transaction" VALUES (?, ?, ?)`);
    insert.run(1, local(2026, 9, 24, 12), null); // last day, missed by the old rule
    insert.run(2, local(2026, 9, 25, 1), null); // next day: not this period
    insert.run(3, local(2026, 9, 10), 1); // already assigned
    insert.run(4, local(2026, 9, 24, 0), null); // the exact boundary instant was never missed; left alone
    backfillFinalDayPeriodAssignments();
    backfillFinalDayPeriodAssignments(); // idempotent
    const rows = state.sqlite.prepare(`SELECT id, period_id AS periodId FROM "transaction" ORDER BY id`).all();
    expect(rows).toEqual([{ id: 1, periodId: 1 }, { id: 2, periodId: null }, { id: 3, periodId: 1 }, { id: 4, periodId: null }]);
    expect(state.sqlite.prepare("SELECT entity_id AS id FROM audit_log").all()).toEqual([{ id: 1 }]);
  });

  it("stores periods saved as UTC midnights as the same dates at local midnight", () => {
    state.sqlite.prepare("INSERT INTO salary_period VALUES (1, ?, ?), (2, ?, ?)").run(Date.UTC(2026, 7, 25), Date.UTC(2026, 8, 24), local(2026, 9, 25), local(2026, 10, 24));
    normalizeLegacyPeriodBoundaries();
    normalizeLegacyPeriodBoundaries();
    expect(state.sqlite.prepare("SELECT id, start_date AS s, end_date AS e FROM salary_period ORDER BY id").all()).toEqual([
      { id: 1, s: local(2026, 8, 25), e: local(2026, 9, 24) },
      { id: 2, s: local(2026, 9, 25), e: local(2026, 10, 24) },
    ]);
  });

  it("backfills billing days, recovering month-end drift but following a changed renewal date", () => {
    state.sqlite.prepare("INSERT INTO subscription VALUES (1, ?), (2, ?), (3, ?)").run(local(2027, 2, 28), local(2027, 3, 15), local(2026, 10, 22));
    const occurrence = state.sqlite.prepare("INSERT INTO recurring_occurrence (job_type, schedule_id, occurrence_date) VALUES ('subscription', ?, ?)");
    occurrence.run(1, local(2027, 1, 31)); // drifted 31st -> 28th
    occurrence.run(3, local(2026, 8, 13)); // user later moved the date to the 22nd
    ensureSubscriptionBillingDay();
    ensureSubscriptionBillingDay();
    expect(state.sqlite.prepare("SELECT id, billing_day AS day FROM subscription ORDER BY id").all()).toEqual([{ id: 1, day: 31 }, { id: 2, day: 15 }, { id: 3, day: 22 }]);
  });

  it("repairs a billing day that disagrees with the next renewal", () => {
    state.sqlite.exec("ALTER TABLE subscription ADD COLUMN billing_day integer");
    state.sqlite.prepare("INSERT INTO subscription VALUES (1, ?, 13), (2, ?, 31), (3, ?, 23)").run(local(2026, 10, 22), local(2027, 2, 28), local(2026, 11, 1));
    ensureSubscriptionBillingDay();
    expect(state.sqlite.prepare("SELECT id, billing_day AS day FROM subscription ORDER BY id").all()).toEqual([{ id: 1, day: 22 }, { id: 2, day: 31 }, { id: 3, day: 1 }]);
  });
});
