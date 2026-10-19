import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
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

import taxIncomeRoutes from "./tax-income";

function createAllTables(sqlite: InstanceType<typeof Database>) {
  const dialect = new SQLiteSyncDialect();
  for (const table of Object.values(schema).filter((value): value is SQLiteTable => is(value, SQLiteTable))) {
    const config = getTableConfig(table);
    const columns = config.columns.map((column) => {
      let defaultSql = "";
      if (column.default !== undefined) {
        const value = column.default;
        const literal = is(value, SQL) ? dialect.sqlToQuery(value).sql
          : typeof value === "string" ? `'${value.replace(/'/g, "''")}'`
          : typeof value === "boolean" ? String(Number(value)) : String(value);
        defaultSql = ` DEFAULT ${literal}`;
      }
      return `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}${column.notNull ? " NOT NULL" : ""}${defaultSql}`;
    });
    sqlite.exec(`CREATE TABLE IF NOT EXISTS "${config.name}" (${columns.join(", ")})`);
  }
}

describe("tax treatment of income", () => {
  let sqlite: InstanceType<typeof Database>;
  let app: ReturnType<typeof Fastify>;
  const entry = (date: Date, description: string, lines: Array<{ accountId: number; debit: number; credit: number }>, extra: Record<string, unknown> = {}) => {
    const tx = state.db.insert(schema.transactions).values({ date, description, txType: "simple_income", status: "posted", ...extra }).returning().all()[0];
    state.db.insert(schema.transactionLines).values(lines.map((line) => ({ ...line, transactionId: tx.id }))).run();
    return tx.id as number;
  };

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    createAllTables(sqlite);
    state.db = drizzle(sqlite);
    state.db.insert(schema.accounts).values([
      { id: 1, name: "BNI", type: "asset", liquidityClass: "cash_equivalent", isActive: true },
      { id: 2, name: "Income (Auto)", type: "revenue", isActive: true },
      { id: 3, name: "Expense (Auto)", type: "expense", isActive: true },
    ]).run();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate("authenticate", async () => {});
    await app.register(taxIncomeRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    sqlite.close();
  });

  const list = async (year = 2026) => (await app.inject({ method: "GET", url: `/api/tax-income?year=${year}` })).json().rows as Array<{ id: number; taxTreatment: string; marked: boolean; incomeCents: number }>;
  const mark = (id: number, taxTreatment: string | null) => app.inject({ method: "PATCH", url: `/api/transactions/${id}/tax-treatment`, payload: { taxTreatment } });

  it("lists a year's income, unmarked entries counting as taxable", async () => {
    const thr = entry(new Date(2026, 2, 22), "THR Nenek", [{ accountId: 1, debit: 500_000, credit: 0 }, { accountId: 2, debit: 0, credit: 500_000 }]);
    entry(new Date(2026, 2, 23), "Lunch", [{ accountId: 3, debit: 50_000, credit: 0 }, { accountId: 1, debit: 0, credit: 50_000 }], { txType: "simple_expense" });
    entry(new Date(2025, 11, 30), "Last year's gift", [{ accountId: 1, debit: 100_000, credit: 0 }, { accountId: 2, debit: 0, credit: 100_000 }]);
    entry(new Date(2026, 3, 1), "Draft income", [{ accountId: 1, debit: 9_000, credit: 0 }, { accountId: 2, debit: 0, credit: 9_000 }], { status: "draft" });

    const rows = await list();
    expect(rows).toEqual([expect.objectContaining({ id: thr, incomeCents: 500_000, taxTreatment: "taxable", marked: false })]);
  });

  it("marks, changes and clears an entry's treatment", async () => {
    const thr = entry(new Date(2026, 2, 22), "THR from parents", [{ accountId: 1, debit: 500_000, credit: 0 }, { accountId: 2, debit: 0, credit: 500_000 }]);
    expect((await mark(thr, "exempt")).statusCode).toBe(200);
    expect((await list())[0]).toMatchObject({ taxTreatment: "exempt", marked: true });
    expect((await mark(thr, "final")).json()).toEqual({ id: thr, taxTreatment: "final" });
    expect((await mark(thr, null)).statusCode).toBe(200);
    expect((await list())[0]).toMatchObject({ taxTreatment: "taxable", marked: false });
    expect(state.db.select().from(schema.auditLogs).all()).toHaveLength(3);
  });

  it("refuses an unknown treatment or transaction", async () => {
    const thr = entry(new Date(2026, 2, 22), "THR", [{ accountId: 1, debit: 1_000, credit: 0 }, { accountId: 2, debit: 0, credit: 1_000 }]);
    expect((await mark(thr, "maybe")).statusCode).toBe(400);
    expect((await mark(99_999, "exempt")).statusCode).toBe(404);
  });
});
