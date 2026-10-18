import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { is, SQL } from "drizzle-orm";
import { getTableConfig, SQLiteSyncDialect, SQLiteTable } from "drizzle-orm/sqlite-core";
import * as schema from "../db/schema";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db/client", () => ({ db: new Proxy({}, {
  get(_target, key) {
    const value = state.db[key];
    return typeof value === "function" ? value.bind(state.db) : value;
  },
}) }));

import { buildNetWorthTrendBuckets, buildPeriodNetWorthBuckets, calculateNetWorthAsOf, getNetWorthTrend, netWorthAtEach, trimLeadingEmptyNetWorth } from "./analytics";

function createAllTables(sqlite: InstanceType<typeof Database>) {
  const dialect = new SQLiteSyncDialect();
  for (const table of Object.values(schema).filter((value): value is SQLiteTable => is(value, SQLiteTable))) {
    const config = getTableConfig(table);
    const columns = config.columns.map((column) => {
      const value = column.default;
      const literal = value === undefined ? "" : ` DEFAULT ${is(value, SQL) ? dialect.sqlToQuery(value).sql
        : typeof value === "string" ? `'${value.replace(/'/g, "''")}'` : typeof value === "boolean" ? String(Number(value)) : String(value)}`;
      return `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}${column.notNull ? " NOT NULL" : ""}${literal}`;
    });
    sqlite.exec(`CREATE TABLE IF NOT EXISTS "${config.name}" (${columns.join(", ")})`);
  }
}

const day = (n: number) => new Date(2026, 8, n, 12).getTime();

describe("net worth trend", () => {
  beforeEach(() => {
    const sqlite = new Database(":memory:");
    createAllTables(sqlite);
    state.db = drizzle(sqlite);
    state.db.insert(schema.accounts).values([
      { id: 1, name: "BCA", type: "asset", liquidityClass: "cash_equivalent", isActive: true },
      { id: 2, name: "Car", type: "asset", liquidityClass: "non_cash", isActive: false },
      { id: 3, name: "Card", type: "liability", isActive: true },
      { id: 4, name: "Expense", type: "expense", isActive: true },
      { id: 5, name: "Equity", type: "equity", isActive: true },
    ]).run();
    const post = (id: number, date: number, lines: Array<[number, number, number]>, extra: Record<string, unknown> = {}) => {
      state.db.insert(schema.transactions).values({ id, date: new Date(date), description: `t${id}`, txType: "manual", ...extra }).run();
      state.db.insert(schema.transactionLines).values(lines.map(([accountId, debit, credit]) => ({ transactionId: id, accountId, debit, credit }))).run();
    };
    post(1, day(1), [[1, 1_000_000, 0], [5, 0, 1_000_000]]); // opening cash
    post(2, day(3), [[2, 50_000_000, 0], [5, 0, 50_000_000]]); // car (inactive account still counts)
    post(3, day(5), [[4, 200_000, 0], [3, 0, 200_000]]); // card purchase
    post(4, day(6), [[4, 99_000, 0], [1, 0, 99_000]], { status: "reversed" }); // reversed original
    post(5, day(9), [[1, 99_000, 0], [4, 0, 99_000]], { txType: "reversal", reversalOfTxId: 4 }); // its reversal
    post(6, day(7), [[4, 5_000, 0], [1, 0, 5_000]], { status: "draft" }); // draft
    post(7, day(10), [[3, 150_000, 0], [1, 0, 150_000]]); // pay card
  });

  it("matches the per-instant calculation at every point, in any order", async () => {
    const instants = [day(11), day(0), day(5), day(6), day(9), day(3), new Date(2026, 8, 5, 11, 59).getTime()];
    const fast = await netWorthAtEach(instants);
    for (const [index, instant] of instants.entries()) {
      const slow = await calculateNetWorthAsOf(instant);
      expect(fast[index]).toEqual({ netWorth: slow.netWorth, totalAssets: slow.totalAssets, totalLiabilities: slow.totalLiabilities });
    }
    expect(fast[0]).toEqual({ totalAssets: 50_850_000, totalLiabilities: 50_000, netWorth: 50_800_000 });
  });

  it("samples the long ranges weekly, ending now", () => {
    const now = new Date(2026, 9, 18, 15, 30).getTime();
    for (const [range, weeks] of [["3m", 13], ["6m", 26], ["1y", 52]] as const) {
      const buckets = buildNetWorthTrendBuckets(range, now);
      expect(buckets).toHaveLength(weeks);
      expect(buckets[buckets.length - 1].asOfMs).toBe(now);
      expect(buckets[0].label).toBe(new Date(now - (weeks - 1) * 7 * 24 * 60 * 60 * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }));
      for (let i = 1; i < buckets.length - 1; i++) {
        expect(buckets[i].asOfMs - buckets[i - 1].asOfMs).toBe(7 * 24 * 60 * 60 * 1000);
      }
    }
    expect(buildNetWorthTrendBuckets("30d", now)).toHaveLength(30);
  });

  it("spans a salary period day by day, stopping at now for the live period", () => {
    const start = new Date(2026, 8, 25).getTime();
    const end = new Date(2026, 9, 24).getTime();
    const live = buildPeriodNetWorthBuckets({ startDate: start, endDate: end }, new Date(2026, 9, 18, 15).getTime());
    expect(live).toHaveLength(24);
    expect(live[0].label).toBe("Sep 25");
    expect(live[live.length - 1].asOfMs).toBe(new Date(2026, 9, 18, 15).getTime());
    const closed = buildPeriodNetWorthBuckets({ startDate: start, endDate: end }, new Date(2027, 0, 1).getTime());
    expect(closed).toHaveLength(30);
    expect(closed[closed.length - 1].asOfMs).toBe(new Date(2026, 9, 24, 23, 59, 59, 999).getTime());
    expect(buildPeriodNetWorthBuckets({ startDate: start, endDate: end }, new Date(2026, 8, 1).getTime())).toEqual([]);
    const long = buildPeriodNetWorthBuckets({ startDate: new Date(2025, 0, 1).getTime(), endDate: new Date(2025, 11, 31).getTime() }, new Date(2027, 0, 1).getTime());
    expect(long.length).toBeLessThanOrEqual(121);
    expect(long[long.length - 1].label).toBe("Dec 31");
  });

  it("loads the period range from the period table", async () => {
    state.db.insert(schema.salaryPeriods).values({ id: 7, name: "September", startDate: day(1), endDate: day(10), status: "open" }).run();
    const trend = await getNetWorthTrend("period", 7);
    expect(trend?.period).toMatchObject({ id: 7, name: "September" });
    expect(trend?.series.length).toBeGreaterThan(1);
    expect(trend?.series[trend.series.length - 1].netWorth).toBe(50_800_000);
    expect(await getNetWorthTrend("period", 99)).toBeNull();
  });

  it("drops the empty points before the first activity but keeps at least two", () => {
    const empty = { totalAssets: 0, totalLiabilities: 0 };
    const active = { totalAssets: 10, totalLiabilities: 0 };
    expect(trimLeadingEmptyNetWorth([empty, empty, active, active]).length).toBe(2);
    expect(trimLeadingEmptyNetWorth([active, empty, active]).length).toBe(3);
    expect(trimLeadingEmptyNetWorth([empty, empty, empty, active]).length).toBe(2);
    expect(trimLeadingEmptyNetWorth([empty, empty]).length).toBe(2);
    // Assets that equal liabilities are activity, not an empty ledger.
    expect(trimLeadingEmptyNetWorth([{ totalAssets: 5, totalLiabilities: 5 }, active]).length).toBe(2);
  });
});
