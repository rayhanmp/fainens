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
});
