import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db/client", () => ({ db: new Proxy({}, {
  get(_target, key) {
    const value = state.db[key];
    return typeof value === "function" ? value.bind(state.db) : value;
  },
}) }));

import auditRoutes from "./audit-log";

describe("audit log routes", () => {
  let sqlite: InstanceType<typeof Database>;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    sqlite.exec(`CREATE TABLE audit_log (id integer PRIMARY KEY, entity_type text NOT NULL, entity_id integer NOT NULL, action text NOT NULL, before_snapshot blob, after_snapshot blob, created_at integer NOT NULL DEFAULT (unixepoch('now') * 1000))`);
    state.db = drizzle(sqlite);
    const snapshot = (value: unknown) => Buffer.from(JSON.stringify(value));
    state.db.insert(schema.auditLogs).values([
      { entityType: "transaction", entityId: 1, action: "create", afterSnapshot: snapshot({ description: "Lunch" }) },
      { entityType: "salary_period", entityId: 2, action: "close", beforeSnapshot: snapshot({ status: "open" }), afterSnapshot: snapshot({ status: "closed" }) },
      { entityType: "reimbursement_claim", entityId: 3, action: "approve", afterSnapshot: snapshot({ status: "approved" }) },
    ]).run();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate("authenticate", async () => {});
    await app.register(auditRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    sqlite.close();
  });

  it("lists entries written by workflows with their own entity types and actions", async () => {
    const response = await app.inject({ method: "GET", url: "/api/audit-log" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(3);
    expect(body.entries.map((entry: { action: string }) => entry.action).sort()).toEqual(["approve", "close", "create"]);
  });

  it("filters by a workflow entity type and returns its history", async () => {
    const filtered = await app.inject({ method: "GET", url: "/api/audit-log?entityType=salary_period&action=close" });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().entries).toHaveLength(1);
    const history = await app.inject({ method: "GET", url: "/api/audit-log/reimbursement_claim/3" });
    expect(history.statusCode).toBe(200);
    expect(history.json().history[0].action).toBe("approve");
  });

  it("searches what the records held, and groups workflow steps as other", async () => {
    const byName = await app.inject({ method: "GET", url: "/api/audit-log?search=lunch" });
    expect(byName.json().entries.map((entry: { entityId: number }) => entry.entityId)).toEqual([1]);
    const other = await app.inject({ method: "GET", url: "/api/audit-log?action=other" });
    expect(other.json().entries.map((entry: { action: string }) => entry.action).sort()).toEqual(["approve", "close"]);
  });

  it("filters by time and counts entries per day of the viewer's clock", async () => {
    // 23:30 UTC on 1 Oct is already 2 Oct in Jakarta (UTC+7).
    const lateUtc = Date.UTC(2026, 9, 1, 23, 30);
    sqlite.prepare("UPDATE audit_log SET created_at = ? WHERE id = 1").run(lateUtc);
    sqlite.prepare("UPDATE audit_log SET created_at = ?, action = 'delete' WHERE id = 2").run(lateUtc - 60 * 60 * 1000);
    sqlite.prepare("UPDATE audit_log SET created_at = ? WHERE id = 3").run(Date.UTC(2026, 9, 5, 3));

    const ranged = await app.inject({ method: "GET", url: `/api/audit-log?startDate=${lateUtc - 2 * 60 * 60 * 1000}&endDate=${lateUtc}` });
    expect(ranged.json().total).toBe(2);

    const jakarta = await app.inject({ method: "GET", url: `/api/audit-log/activity?since=${Date.UTC(2026, 8, 1)}&utcOffsetMinutes=420` });
    expect(jakarta.statusCode).toBe(200);
    expect(jakarta.json().days).toEqual([
      { day: "2026-10-02", count: 2, removed: 1 },
      { day: "2026-10-05", count: 1, removed: 0 },
    ]);
    const utc = await app.inject({ method: "GET", url: `/api/audit-log/activity?since=${Date.UTC(2026, 8, 1)}` });
    expect(utc.json().days[0]).toEqual({ day: "2026-10-01", count: 2, removed: 1 });
  });
});
