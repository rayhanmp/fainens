import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, is, SQL } from "drizzle-orm";
import { getTableConfig, SQLiteSyncDialect, SQLiteTable } from "drizzle-orm/sqlite-core";
import * as schema from "../db/schema";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db/client", () => ({ db: new Proxy({}, {
  get(_target, key) {
    const value = state.db[key];
    return typeof value === "function" ? value.bind(state.db) : value;
  },
}) }));

import goalRoutes from "./goals";
import { completeGoalsForWishlist } from "../services/goals";

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

describe("goals", () => {
  let sqlite: InstanceType<typeof Database>;
  let app: ReturnType<typeof Fastify>;

  const get = async () => (await app.inject({ method: "GET", url: "/api/goals" })).json();
  const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, payload: payload as any });

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    createAllTables(sqlite);
    state.db = drizzle(sqlite, { schema });
    const db = state.db;
    db.insert(schema.accounts).values([
      { id: 1, name: "BNI", type: "asset", liquidityClass: "cash_equivalent" },
      { id: 2, name: "Bibit", type: "asset", liquidityClass: "investment" },
      { id: 3, name: "Owed to me", type: "asset", liquidityClass: "receivable" },
      { id: 4, name: "Old wallet", type: "asset", liquidityClass: "cash_equivalent", isActive: false },
      { id: 9, name: "Salary", type: "revenue" },
    ]).run();
    // Rp40 juta in BNI, Rp5 juta in Bibit, Rp3 juta owed: 45 juta can be set aside.
    db.insert(schema.transactions).values({ id: 1, date: new Date(Date.now() - 86_400_000), description: "Opening", status: "posted" }).run();
    db.insert(schema.transactionLines).values([
      { transactionId: 1, accountId: 1, debit: 40_000_000, credit: 0 },
      { transactionId: 1, accountId: 2, debit: 5_000_000, credit: 0 },
      { transactionId: 1, accountId: 3, debit: 3_000_000, credit: 0 },
      { transactionId: 1, accountId: 9, debit: 0, credit: 48_000_000 },
    ]).run();
    db.insert(schema.transactions).values({ id: 2, date: new Date(), description: "Laptop", status: "posted" }).run();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate("authenticate", async () => {});
    await app.register(goalRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    sqlite.close();
  });

  it("counts active cash and investment accounts as money to set aside", async () => {
    const overview = await get();
    expect(overview.accounts.map((account: { name: string }) => account.name)).toEqual(["BNI", "Bibit"]);
    expect([overview.available, overview.setAside, overview.unassigned]).toEqual([45_000_000, 0, 45_000_000]);
    const settings = await app.inject({ method: "PUT", url: "/api/goals/settings", payload: { excludedAccountIds: [2] } });
    expect(settings.json().available).toBe(40_000_000);
    expect(settings.json().accounts.find((account: { id: number }) => account.id === 2).included).toBe(false);
    expect((await app.inject({ method: "PUT", url: "/api/goals/settings", payload: { excludedAccountIds: [9] } })).statusCode).toBe(400);
  });

  it("sets money aside for goals within what's unassigned", async () => {
    const fund = (await post("/api/goals", { name: "Emergency fund", targetAmount: 30_000_000, kind: "keep", setAside: 24_000_000 })).json();
    expect(fund).toMatchObject({ name: "Emergency fund", kind: "keep", setAside: 24_000_000, status: "active" });
    expect((await get()).unassigned).toBe(21_000_000);

    const laptop = (await post("/api/goals", { name: "Laptop", targetAmount: 20_000_000 })).json();
    expect((await post(`/api/goals/${laptop.id}/allocations`, { amount: 22_000_000 })).statusCode).toBe(409);
    expect((await post(`/api/goals/${laptop.id}/allocations`, { amount: 5_000_000, note: "Bonus" })).json().setAside).toBe(5_000_000);
    expect((await post(`/api/goals/${laptop.id}/allocations`, { amount: -6_000_000 })).statusCode).toBe(409);
    expect((await post(`/api/goals/${laptop.id}/allocations`, { amount: -2_000_000 })).json().setAside).toBe(3_000_000);
    expect((await post("/api/goals", { name: "Too much", targetAmount: 1, setAside: 99_000_000 })).statusCode).toBe(409);

    const history = (await app.inject({ method: "GET", url: `/api/goals/${laptop.id}/allocations` })).json();
    expect(history.map((row: { amount: number; kind: string }) => [row.amount, row.kind])).toEqual([[-2_000_000, "release"], [5_000_000, "assign"]]);
    expect((await get()).setAside).toBe(27_000_000);
  });

  it("sets aside each goal's monthly amount, dated goals first, up to target and what's unassigned", async () => {
    const soon = (await post("/api/goals", { name: "Trip", targetAmount: 3_000_000, byDate: Date.now() + 90 * 86_400_000, monthlyAmount: 5_000_000 })).json();
    const later = (await post("/api/goals", { name: "Car", targetAmount: 100_000_000, monthlyAmount: 50_000_000 })).json();
    const result = (await post("/api/goals/fund-monthly", {})).json();
    expect(result.assigned).toEqual([{ goalId: soon.id, amount: 3_000_000 }, { goalId: later.id, amount: 42_000_000 }]);
    expect((await get()).unassigned).toBe(0);
  });

  it("counts what a goal already got this month, so funding twice sets nothing more", async () => {
    const bike = (await post("/api/goals", { name: "Bike", targetAmount: 10_000_000, monthlyAmount: 2_000_000, setAside: 500_000 })).json();
    expect(bike.setAsideThisMonth).toBe(500_000);
    expect((await post("/api/goals/fund-monthly", {})).json().assigned).toEqual([{ goalId: bike.id, amount: 1_500_000 }]);
    expect((await post("/api/goals/fund-monthly", {})).json()).toEqual({ assigned: [], total: 0 });
    expect((await get()).goals[0]).toMatchObject({ setAside: 2_000_000, setAsideThisMonth: 2_000_000 });
  });

  it("finishing a goal releases its money and fulfils the wishlist item it was for", async () => {
    state.db.insert(schema.wishlist).values({ id: 7, name: "Laptop", amount: 20_000_000 }).run();
    const laptop = (await post("/api/goals", { name: "Laptop", targetAmount: 20_000_000, wishlistId: 7, setAside: 20_000_000 })).json();
    const done = (await post(`/api/goals/${laptop.id}/complete`, { transactionId: 2 })).json();
    expect(done).toMatchObject({ status: "done", setAside: 0, spentTransactionId: 2 });
    expect((await get()).unassigned).toBe(45_000_000);
    const [item] = state.db.select().from(schema.wishlist).where(eq(schema.wishlist.id, 7)).all();
    expect([item.status, item.fulfilledTransactionId]).toEqual(["fulfilled", 2]);
    expect((await post(`/api/goals/${laptop.id}/complete`, {})).statusCode).toBe(409);
    expect((await post(`/api/goals/${laptop.id}/allocations`, { amount: 1 })).statusCode).toBe(409);
    expect((await post(`/api/goals/${laptop.id}/reopen`, {})).json().status).toBe("active");
  });

  it("a wishlist purchase finishes the goal saving for it", async () => {
    state.db.insert(schema.wishlist).values({ id: 8, name: "Phone", amount: 5_000_000 }).run();
    const phone = (await post("/api/goals", { name: "Phone", targetAmount: 5_000_000, wishlistId: 8, setAside: 4_000_000 })).json();
    await completeGoalsForWishlist(8, 2);
    expect((await get()).goals.find((goal: { id: number }) => goal.id === phone.id)).toMatchObject({ status: "done", setAside: 0 });
  });

  it("archiving lets the money go", async () => {
    const fund = (await post("/api/goals", { name: "Fund", targetAmount: 10_000_000, setAside: 6_000_000 })).json();
    expect((await get()).setAside).toBe(6_000_000);
    expect((await app.inject({ method: "PATCH", url: `/api/goals/${fund.id}`, payload: { status: "archived" } })).json()).toMatchObject({ status: "archived", setAside: 0 });
    expect((await get()).setAside).toBe(0);
    expect((await app.inject({ method: "PUT", url: "/api/goals/settings", payload: { excludedAccountIds: [9] } })).statusCode).toBe(400);
  });
});
