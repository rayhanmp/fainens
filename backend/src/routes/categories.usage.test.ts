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
vi.mock("../cache", () => ({ invalidateOnTransactionMutation: vi.fn(async () => {}) }));
vi.mock("../cache/invalidation", () => ({ invalidateOnTransactionMutation: vi.fn(async () => {}) }));

import categoryRoutes from "./categories";

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

describe("category and tag usage", () => {
  let sqlite: InstanceType<typeof Database>;
  let app: ReturnType<typeof Fastify>;
  const entry = (values: Record<string, unknown>, lines: Array<[number, number, number]>, extra: { tags?: number[]; allocations?: Array<[number, number]> } = {}) => {
    const tx = state.db.insert(schema.transactions).values({ date: new Date(2026, 4, 1), description: "x", txType: "simple_expense", status: "posted", ...values }).returning().all()[0];
    state.db.insert(schema.transactionLines).values(lines.map(([accountId, debit, credit]) => ({ transactionId: tx.id, accountId, debit, credit }))).run();
    for (const tagId of extra.tags ?? []) state.db.insert(schema.transactionTags).values({ transactionId: tx.id, tagId }).run();
    for (const [categoryId, amount] of extra.allocations ?? []) state.db.insert(schema.transactionCategoryAllocations).values({ transactionId: tx.id, categoryId, amount }).run();
    return tx.id as number;
  };

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    createAllTables(sqlite);
    state.db = drizzle(sqlite);
    state.db.insert(schema.accounts).values([
      { id: 1, name: "BNI", type: "asset", liquidityClass: "cash_equivalent", isActive: true },
      { id: 2, name: "Expense (Auto)", type: "expense", isActive: true },
      { id: 3, name: "Income (Auto)", type: "revenue", isActive: true },
    ]).run();
    state.db.insert(schema.categories).values([{ id: 1, name: "Food" }, { id: 2, name: "Gifts" }]).run();
    state.db.insert(schema.tags).values([{ id: 1, name: "Hangout", color: "#000" }, { id: 2, name: "Unused", color: "#111" }]).run();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate("authenticate", async () => {});
    await app.register(categoryRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    sqlite.close();
  });

  it("counts posted activity across the ledger, split allocations included and corrections left out", async () => {
    entry({ categoryId: 1 }, [[2, 50_000, 0], [1, 0, 50_000]], { tags: [1], allocations: [[1, 50_000]] });
    entry({}, [[2, 80_000, 0], [1, 0, 80_000]], { allocations: [[1, 40_000], [2, 40_000]] });
    entry({}, [[2, 9_000, 0], [1, 0, 9_000]]);
    entry({ txType: "simple_income" }, [[1, 100_000, 0], [3, 0, 100_000]], { tags: [1] });
    entry({ categoryId: 1, status: "reversed" }, [[2, 7_000, 0], [1, 0, 7_000]], { tags: [1] });
    entry({ categoryId: 1, status: "draft" }, [[2, 7_000, 0], [1, 0, 7_000]]);

    const response = await app.inject({ method: "GET", url: "/api/categories/usage" });
    expect(response.statusCode).toBe(200);
    const usage = response.json();
    expect(usage.categories.sort((a: { categoryId: number }, b: { categoryId: number }) => a.categoryId - b.categoryId)).toEqual([
      { categoryId: 1, transactionCount: 2, amount: 90_000 },
      { categoryId: 2, transactionCount: 1, amount: 40_000 },
    ]);
    expect(usage.tags).toEqual([{ tagId: 1, transactionCount: 2 }]);
    expect(usage).toMatchObject({ expenseCount: 3, categorizedExpenseCount: 2, transactionCount: 4, taggedCount: 2 });
  });

  it("splits spending by salary period, oldest first, skipping periods that haven't started", async () => {
    state.db.insert(schema.salaryPeriods).values([
      { id: 1, name: "May 2026", startDate: new Date(2026, 3, 25).getTime(), endDate: new Date(2026, 4, 24).getTime() },
      { id: 2, name: "June 2026", startDate: new Date(2026, 4, 25).getTime(), endDate: new Date(2026, 5, 24).getTime() },
      { id: 3, name: "Far future", startDate: new Date(2099, 0, 1).getTime(), endDate: new Date(2099, 1, 1).getTime() },
    ]).run();
    entry({ categoryId: 1, date: new Date(2026, 4, 2) }, [[2, 30_000, 0], [1, 0, 30_000]]);
    // The last day of May's period counts in May, not June.
    entry({ categoryId: 2, date: new Date(2026, 4, 24, 20, 0) }, [[2, 15_000, 0], [1, 0, 15_000]]);
    entry({ categoryId: 2, date: new Date(2026, 5, 2) }, [[2, 70_000, 0], [1, 0, 70_000]]);

    const response = await app.inject({ method: "GET", url: "/api/categories/usage-by-period?count=5" });
    expect(response.statusCode).toBe(200);
    const { periods } = response.json();
    expect(periods.map((period: { name: string }) => period.name)).toEqual(["May 2026", "June 2026"]);
    const amounts = (period: { categories: Array<{ categoryId: number; amount: number }> }) => Object.fromEntries(period.categories.map((row) => [row.categoryId, row.amount]));
    expect(amounts(periods[0])).toEqual({ 1: 30_000, 2: 15_000 });
    expect(amounts(periods[1])).toEqual({ 2: 70_000 });
  });

  it("puts single-category spending on its category and nets out a reimbursement, within a date range", async () => {
    entry({ categoryId: 1, date: new Date(2026, 4, 2) }, [[2, 30_000, 0], [1, 0, 30_000]]);
    entry({ categoryId: 2, date: new Date(2026, 6, 2) }, [[2, 70_000, 0], [1, 0, 70_000]]);
    // A reimbursement approval moves part of a meal off the books: a negative allocation, not a new entry.
    entry({ txType: "reimbursement_recognition", date: new Date(2026, 4, 3) }, [[1, 10_000, 0], [2, 0, 10_000]], { allocations: [[1, -10_000]] });

    const all = (await app.inject({ method: "GET", url: "/api/categories/usage" })).json();
    expect(all.categories.find((row: { categoryId: number }) => row.categoryId === 1)).toEqual({ categoryId: 1, transactionCount: 1, amount: 20_000 });
    const may = (await app.inject({ method: "GET", url: `/api/categories/usage?from=${new Date(2026, 4, 1).getTime()}&to=${new Date(2026, 4, 31).getTime()}` })).json();
    expect(may.categories.map((row: { categoryId: number }) => row.categoryId)).toEqual([1]);
  });
});
