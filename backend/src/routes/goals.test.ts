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

  const patch = (url: string, payload: unknown) => app.inject({ method: "PATCH", url, payload: payload as any });

  it("keeps a goal's notes, icon, link, account, return and breakdown, and shows them on its page", async () => {
    const trip = (await post("/api/goals", {
      name: "Japan", targetAmount: 25_000_000, icon: "✈️", description: "- [ ] Book flights", linkUrl: "https://example.com/tour",
      accountId: 1, expectedReturn: 4, monthlyAmount: 1_000_000, setAside: 5_000_000,
    })).json();
    expect(trip).toMatchObject({ icon: "✈️", description: "- [ ] Book flights", accountId: 1, expectedReturn: 4, reachMonths: 20 });
    expect((await post("/api/goals", { name: "Bad", targetAmount: 1, accountId: 9 })).statusCode).toBe(400);
    expect((await post("/api/goals", { name: "Bad", targetAmount: 1, linkUrl: "javascript:alert(1)" })).statusCode).toBe(400);

    const flights = (await post(`/api/goals/${trip.id}/parts`, { name: "Flights", amount: 9_000_000 })).json();
    await post(`/api/goals/${trip.id}/parts`, { name: "Hotel", amount: 10_000_000 });
    // Paying the flights from the goal ticks them off and takes their cost out of it.
    const paid = (await post(`/api/goals/${trip.id}/spend`, { amount: 4_000_000, partId: flights.id, transactionId: 2 })).json();
    expect(paid.setAside).toBe(1_000_000);
    expect((await post(`/api/goals/${trip.id}/spend`, { amount: 2_000_000 })).statusCode).toBe(409);

    const detail = (await app.inject({ method: "GET", url: `/api/goals/${trip.id}` })).json();
    expect(detail.parts.map((part: { name: string; paidAt: number | null }) => [part.name, part.paidAt !== null])).toEqual([["Flights", true], ["Hotel", false]]);
    expect(detail.account).toMatchObject({ name: "BNI", balance: 40_000_000, goalsHold: 1_000_000 });
    expect(detail.milestones.map((item: { share: number }) => item.share)).toEqual([]);
    expect(detail.goal.status).toBe("active");
    const history = (await app.inject({ method: "GET", url: `/api/goals/${trip.id}/allocations` })).json();
    expect(history[0]).toMatchObject({ amount: -4_000_000, kind: "spend", note: "Paid: Flights", partId: flights.id });
  });

  it("puts money in by priority, skipping paused goals, and on payday when that's on", async () => {
    const first = (await post("/api/goals", { name: "First", targetAmount: 50_000_000, monthlyAmount: 30_000_000 })).json();
    const second = (await post("/api/goals", { name: "Second", targetAmount: 50_000_000, monthlyAmount: 30_000_000 })).json();
    const paused = (await post("/api/goals", { name: "Paused", targetAmount: 50_000_000, monthlyAmount: 1_000_000 })).json();
    await patch(`/api/goals/${paused.id}`, { paused: true });
    // Second moves to the top, so it's filled first.
    await app.inject({ method: "PUT", url: "/api/goals/order", payload: { ids: [second.id, first.id] } });
    expect((await get()).goals.map((goal: { name: string }) => goal.name)).toEqual(["Second", "First", "Paused"]);
    const { autoFundAfterPayday } = await import("../services/goals");
    expect(await autoFundAfterPayday()).toBeNull();
    await app.inject({ method: "PUT", url: "/api/goals/settings", payload: { autoFundOnPayday: true } });
    const result = await autoFundAfterPayday();
    expect(result?.assigned).toEqual([{ goalId: second.id, amount: 30_000_000 }, { goalId: first.id, amount: 15_000_000 }]);
    const overview = await get();
    expect(overview.autoFundOnPayday).toBe(true);
    expect(overview.goals.find((goal: { id: number }) => goal.id === paused.id)).toMatchObject({ paused: true, setAside: 0, reachMonths: null });
  });

  it("starts a yearly goal again for next year once it's paid", async () => {
    const tax = (await post("/api/goals", { name: "Vehicle tax", targetAmount: 3_000_000, recurrence: "yearly", byDate: new Date(2026, 11, 15, 12).getTime(), setAside: 3_000_000 })).json();
    await post(`/api/goals/${tax.id}/parts`, { name: "PKB", amount: 3_000_000 });
    await patch(`/api/goal-parts/${(await app.inject({ method: "GET", url: `/api/goals/${tax.id}` })).json().parts[0].id}`, { paid: true });
    const next = (await post(`/api/goals/${tax.id}/complete`, { transactionId: 2 })).json();
    expect(next).toMatchObject({ status: "active", setAside: 0, recurrence: "yearly" });
    expect(new Date(next.byDate).getFullYear()).toBeGreaterThanOrEqual(2027);
    expect((await app.inject({ method: "GET", url: `/api/goals/${tax.id}` })).json().parts[0].paidAt).toBeNull();
    // What it took this year is kept as next year's guide.
    expect(next.typeData).toMatchObject({ lastYear: 3_000_000, lastPaidAt: expect.any(Number) });
    await post(`/api/goals/${tax.id}/allocations`, { amount: 2_500_000 });
    await post(`/api/goals/${tax.id}/spend`, { amount: 2_400_000 });
    const after = (await post(`/api/goals/${tax.id}/complete`, {})).json();
    expect(after.typeData.lastYear).toBe(2_500_000);
  });

  it("pays expenses in a goal's category out of it, and gives the money back if the expense goes", async () => {
    state.db.insert(schema.categories).values({ id: 5, name: "Travel" }).run();
    const trip = (await post("/api/goals", { name: "Trip", targetAmount: 10_000_000, setAside: 3_000_000 })).json();
    // An expense from before the category was chosen doesn't count.
    state.db.insert(schema.transactions).values({ id: 3, date: new Date(Date.now() - 86_400_000), description: "Old train", status: "posted" }).run();
    state.db.insert(schema.transactionCategoryAllocations).values({ transactionId: 3, categoryId: 5, amount: 500_000 }).run();
    await patch(`/api/goals/${trip.id}`, { categoryId: 5 });
    state.db.insert(schema.transactions).values({ id: 4, date: new Date(Date.now() + 60_000), description: "Ryokan", status: "posted" }).run();
    state.db.insert(schema.transactionCategoryAllocations).values({ transactionId: 4, categoryId: 5, amount: 1_200_000 }).run();
    expect((await get()).goals[0].setAside).toBe(1_800_000);
    // Looking again doesn't take it twice.
    expect((await get()).goals[0].setAside).toBe(1_800_000);
    state.db.update(schema.transactions).set({ status: "reversed" }).where(eq(schema.transactions.id, 4)).run();
    expect((await get()).goals[0].setAside).toBe(3_000_000);
    expect((await app.inject({ method: "GET", url: `/api/goals/${trip.id}` })).json().categoryName).toBe("Travel");
  });

  it("keeps a goal's type and that type's figures, and a part's due date", async () => {
    const house = (await post("/api/goals", { name: "House", targetAmount: 170_000_000, goalType: "house", typeData: { price: 850_000_000, dpShare: 20 } })).json();
    expect(house).toMatchObject({ goalType: "house", typeData: { price: 850_000_000, dpShare: 20 } });
    expect((await post("/api/goals", { name: "Bad", targetAmount: 1, goalType: "yacht" })).statusCode).toBe(400);
    const changed = (await patch(`/api/goals/${house.id}`, { typeData: { price: 900_000_000 } })).json();
    expect(changed.typeData).toEqual({ price: 900_000_000 });
    expect((await patch(`/api/goals/${house.id}`, { goalType: null })).json().goalType).toBeNull();
    const term = (await post(`/api/goals/${house.id}/parts`, { name: "Term 1", amount: 12_000_000, dueAt: new Date(2027, 0, 10).getTime() })).json();
    expect(term.dueAt).toBe(new Date(2027, 0, 10).getTime());
    expect((await patch(`/api/goal-parts/${term.id}`, { dueAt: null })).json().dueAt).toBeNull();
  });

  it("sums up each goal over a period for the monthly report", async () => {
    const { goalsForPeriod } = await import("../services/goals");
    const trip = (await post("/api/goals", { name: "Trip", targetAmount: 10_000_000, setAside: 4_000_000 })).json();
    await post(`/api/goals/${trip.id}/allocations`, { amount: -1_000_000 });
    await post(`/api/goals/${trip.id}/spend`, { amount: 500_000 });
    await post("/api/goals", { name: "Empty", targetAmount: 1 });
    const now = Date.now();
    expect(await goalsForPeriod(now - 86_400_000, now + 86_400_000)).toEqual([
      { name: "Trip", icon: null, kind: "spend", targetAmount: 10_000_000, putIn: 4_000_000, paid: 500_000, takenOut: 1_000_000, heldAtEnd: 2_500_000, finished: false },
    ]);
    // A period before the goal existed has nothing on it.
    expect(await goalsForPeriod(now - 10 * 86_400_000, now - 5 * 86_400_000)).toEqual([]);
  });

  it("queues a deleted goal's files for removal from storage", async () => {
    const goal = (await post("/api/goals", { name: "Phone", targetAmount: 1 })).json();
    state.db.insert(schema.goalAttachments).values({ goalId: goal.id, filename: "quote.pdf", r2Key: "goal-files/x/quote.pdf", mimetype: "application/pdf", fileSize: 10 }).run();
    expect((await app.inject({ method: "DELETE", url: `/api/goals/${goal.id}` })).statusCode).toBe(204);
    const queued = state.db.select().from(schema.storageDeletionOutbox).all();
    expect(queued.map((row: { r2Key: string; entityType: string }) => [row.r2Key, row.entityType])).toEqual([["goal-files/x/quote.pdf", "goal_attachment"]]);
  });
});
