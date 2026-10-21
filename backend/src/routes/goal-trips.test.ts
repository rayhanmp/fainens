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

import tripRoutes from "./goal-trips";
import { spendFromGoal } from "../services/goals";
import { remindersFor, tripBasics } from "../services/goal-trips";

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

const day = (month: number, date: number, hour = 12) => new Date(2027, month, date, hour).getTime();

describe("goal trips", () => {
  let sqlite: InstanceType<typeof Database>;
  let app: ReturnType<typeof Fastify>;
  const inject = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any });
  const parts = () => state.db.select().from(schema.goalParts).all().map((part: typeof schema.goalParts.$inferSelect) => [part.name, part.amount, part.paidAt !== null]);

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    createAllTables(sqlite);
    state.db = drizzle(sqlite, { schema });
    state.db.insert(schema.savingsGoals).values({ id: 1, name: "Japan", targetAmount: 40_000_000, goalType: "trip", typeData: JSON.stringify({ note: "kept" }) }).run();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate("authenticate", async () => {});
    await app.register(tripRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    sqlite.close();
  });

  it("keeps the trip in the goal's type data, and bookings in the breakdown at the trip's rate", async () => {
    const trip = (await inject("PUT", "/api/goals/1/trip", { places: ["Tokyo", "Kyoto"], startDate: day(2, 10), endDate: day(2, 16), currency: "JPY", rate: 105, dailyBudget: 600_000, climate: "cold" })).json();
    expect(trip.basics).toMatchObject({ places: ["Tokyo", "Kyoto"], currency: "JPY", rate: 105, dailyBudget: 600_000, climate: "cold" });
    const goal = state.db.select().from(schema.savingsGoals).where(eq(schema.savingsGoals.id, 1)).get();
    expect(JSON.parse(goal.typeData)).toMatchObject({ note: "kept", startDate: day(2, 10) });
    expect((await inject("PUT", "/api/goals/1/trip", { startDate: day(2, 20), endDate: day(2, 16) })).statusCode).toBe(400);

    const flight = (await inject("POST", "/api/goals/1/bookings", { kind: "flight", title: "CGK → HND", startAt: day(2, 10, 6), cost: 9_500_000, costCurrency: "IDR", details: { airline: "Garuda", number: "GA874" } })).json();
    const hotel = (await inject("POST", "/api/goals/1/bookings", { kind: "stay", title: "Shinjuku hotel", startAt: day(2, 10, 15), endAt: day(2, 13, 11), cost: 60_000, costCurrency: "JPY", cancelBy: day(2, 1) })).json();
    const pass = (await inject("POST", "/api/goals/1/bookings", { kind: "transport", title: "Suica", cost: 0 })).json();
    expect([flight.rupiah, hotel.rupiah, pass.rupiah]).toEqual([9_500_000, 6_300_000, 0]);
    expect(flight.details).toEqual({ airline: "Garuda", number: "GA874" });
    expect(parts()).toEqual([["CGK → HND", 9_500_000, false], ["Shinjuku hotel", 6_300_000, false]]);

    // Paying the flight from the goal ticks its booking off; a new rate only moves what's unpaid.
    state.db.insert(schema.goalAllocations).values({ goalId: 1, amount: 20_000_000, kind: "assign" }).run();
    await spendFromGoal(1, { amount: 9_400_000, transactionId: null, partId: flight.partId, note: null });
    await inject("PUT", "/api/goals/1/trip", { rate: 110 });
    await inject("PATCH", `/api/goal-bookings/${flight.id}`, { title: "Garuda to Haneda", cost: 12_000_000 });
    expect(parts()).toEqual([["Garuda to Haneda", 9_500_000, true], ["Shinjuku hotel", 6_600_000, false]]);
    const bookings = (await inject("GET", "/api/goals/1/trip")).json().bookings;
    expect(bookings.find((item: { id: number }) => item.id === flight.id)).toMatchObject({ paid: 9_400_000, paidAt: expect.any(Number) });

    // A paid booking's part stays when it's removed, as a record of the payment; an unpaid one goes.
    await inject("DELETE", `/api/goal-bookings/${flight.id}`);
    await inject("DELETE", `/api/goal-bookings/${hotel.id}`);
    expect(parts()).toEqual([["Garuda to Haneda", 9_500_000, true]]);
    // Rupiah again: foreign costs can't be counted until there's a rate.
    await inject("PUT", "/api/goals/1/trip", { currency: null });
    expect((await inject("GET", "/api/goals/1/trip")).json().basics).toMatchObject({ currency: null, rate: null });
  });

  it("plans days, moves plans between them, and packs per person", async () => {
    await inject("PUT", "/api/goals/1/trip", { currency: "JPY", rate: 100 });
    const temple = (await inject("POST", "/api/goals/1/plans", { day: "2027-03-11", time: "09:00", title: "Fushimi Inari", cost: 0, costCurrency: "JPY" })).json();
    const teamlab = (await inject("POST", "/api/goals/1/plans", { day: "2027-03-12", title: "teamLab", cost: 3_800, costCurrency: "JPY" })).json();
    const market = (await inject("POST", "/api/goals/1/plans", { day: "2027-03-12", title: "Nishiki market" })).json();
    expect(teamlab.rupiah).toBe(380_000);
    const moved = (await inject("PUT", "/api/goals/1/plans/order", { day: "2027-03-11", ids: [market.id, temple.id] })).json();
    expect(moved.map((plan: { title: string; day: string }) => `${plan.day} ${plan.title}`)).toEqual(["2027-03-11 Nishiki market", "2027-03-11 Fushimi Inari", "2027-03-12 teamLab"]);
    expect((await inject("POST", "/api/goals/1/plans", { day: "11 March", title: "x" })).statusCode).toBe(400);

    const rayhan = (await inject("POST", "/api/goals/1/travellers", { name: "Rayhan", passportExpiry: day(5, 1) })).json();
    const kid = (await inject("POST", "/api/goals/1/travellers", { name: "Kid", paying: false })).json();
    expect([rayhan.paying, kid.paying, rayhan.visaStatus]).toEqual([true, false, "not-needed"]);
    const items = (await inject("POST", "/api/goals/1/packing", { items: [{ text: "Coat", travellerId: rayhan.id }, { text: "Gloves", travellerId: kid.id }, { text: "Adapter" }] })).json();
    await inject("PATCH", `/api/goal-packing/${items[0].id}`, { done: true });
    await inject("DELETE", `/api/goal-travellers/${kid.id}`);
    const trip = (await inject("GET", "/api/goals/1/trip")).json();
    expect(trip.packing.map((item: { text: string; done: boolean }) => [item.text, item.done])).toEqual([["Coat", true], ["Adapter", false]]);
    expect(trip.travellers.map((traveller: { name: string }) => traveller.name)).toEqual(["Rayhan"]);
    expect((await inject("POST", "/api/goals/1/packing", { items: [{ text: "Hat", travellerId: kid.id }] })).statusCode).toBe(400);
  });

  it("counts what was spent on the trip's days, without renewals or bookings paid from the goal", async () => {
    await inject("PUT", "/api/goals/1/trip", { startDate: day(2, 10), endDate: day(2, 12) });
    state.db.insert(schema.categories).values([{ id: 1, name: "Food" }, { id: 2, name: "Transport" }, { id: 3, name: "Bills" }]).run();
    state.db.insert(schema.transactions).values([
      { id: 1, date: new Date(day(2, 10, 13)), description: "Ramen", status: "posted" },
      { id: 2, date: new Date(day(2, 12, 22)), description: "Train", status: "posted" },
      { id: 3, date: new Date(day(2, 11)), description: "Netflix", status: "posted", subscriptionId: 4 },
      { id: 4, date: new Date(day(2, 13, 1)), description: "After", status: "posted" },
      { id: 5, date: new Date(day(2, 11)), description: "Draft", status: "draft" },
      { id: 6, date: new Date(day(2, 11)), description: "Hotel paid there", status: "posted" },
    ]).run();
    state.db.insert(schema.transactionCategoryAllocations).values([
      { transactionId: 1, categoryId: 1, amount: 150_000 },
      { transactionId: 2, categoryId: 2, amount: 300_000 },
      { transactionId: 3, categoryId: 3, amount: 186_000 },
      { transactionId: 4, categoryId: 1, amount: 99_000 },
      { transactionId: 5, categoryId: 1, amount: 50_000 },
      { transactionId: 6, categoryId: 2, amount: 2_000_000 },
    ]).run();
    state.db.insert(schema.goalAllocations).values([{ goalId: 1, amount: 5_000_000, kind: "assign" }, { goalId: 1, amount: -2_000_000, kind: "spend", transactionId: 6 }]).run();
    const { spending } = (await inject("GET", "/api/goals/1/trip")).json();
    expect(spending).toEqual({
      total: 450_000,
      byDay: [{ day: "2027-03-10", total: 150_000 }, { day: "2027-03-12", total: 300_000 }],
      byCategory: [{ categoryId: 2, name: "Transport", total: 300_000 }, { categoryId: 1, name: "Food", total: 150_000 }],
    });
  });

  it("reminds about cancellation, payment, passports, visas and packing in time", () => {
    const basics = tripBasics({ startDate: day(2, 10), endDate: day(2, 16) });
    const trip = {
      goalId: 1,
      goalName: "Japan",
      basics,
      bookings: [
        { title: "Hotel", cancelBy: day(1, 26), partId: 4, paidAt: null, rupiah: 6_000_000 },
        { title: "Flight", cancelBy: null, partId: 5, paidAt: day(0, 1), rupiah: 9_000_000 },
      ],
      travellers: [
        { name: "Rayhan", passportExpiry: day(7, 1), visaStatus: "to-apply" },
        { name: "Sari", passportExpiry: day(11, 1), visaStatus: "approved" },
      ],
      unpacked: 4,
    };
    const kinds = (now: number) => remindersFor(trip, now).map((item) => `${item.kind}${item.name ? `:${item.name}` : ""}${item.count > 1 ? `×${item.count}` : ""}`);
    // Two months out: only the passport that runs out within six months of coming home.
    expect(kinds(day(0, 10))).toEqual(["passport:Rayhan"]);
    // 40 days out: the visa too.
    expect(kinds(day(0, 29))).toEqual(["passport:Rayhan", "visa:Rayhan"]);
    // 13 days out, two days before free cancellation ends: the unpaid hotel as well.
    expect(kinds(day(1, 24))).toEqual(["cancel:Hotel", "unpaid", "passport:Rayhan", "visa:Rayhan"]);
    // The day before leaving: and what's not packed.
    expect(kinds(day(2, 9))).toEqual(["unpaid", "passport:Rayhan", "visa:Rayhan", "packing×4"]);
    // Once it's over, nothing.
    expect(kinds(day(2, 18))).toEqual([]);
  });

  it("reminds about parts due, an emergency fund to refill, and a THR that went into no Lebaran goal", async () => {
    const now = Date.now();
    const days = (count: number) => new Date(now + count * 86_400_000);
    state.db.insert(schema.savingsGoals).values([
      { id: 2, name: "Wedding", targetAmount: 150_000_000 },
      { id: 3, name: "Fund", targetAmount: 30_000_000, goalType: "emergency", kind: "keep" },
      { id: 4, name: "Lebaran", targetAmount: 8_000_000, goalType: "lebaran" },
      { id: 5, name: "School", targetAmount: 20_000_000, goalType: "education" },
    ]).run();
    state.db.insert(schema.goalAllocations).values([
      { goalId: 2, amount: 40_000_000, kind: "assign" },
      { goalId: 3, amount: 30_000_000, kind: "assign", createdAt: days(-200) },
      { goalId: 3, amount: -4_000_000, kind: "release", note: "Car repair", createdAt: days(-5) },
      { goalId: 5, amount: 2_000_000, kind: "assign" },
    ]).run();
    state.db.insert(schema.goalParts).values([
      { goalId: 2, name: "Venue deposit", amount: 25_000_000, dueAt: days(10) },
      { goalId: 2, name: "Catering", amount: 60_000_000, dueAt: days(60) },
      { goalId: 2, name: "Paid already", amount: 5_000_000, dueAt: days(3), paidAt: days(-1) },
      // A fee the goal can't cover yet is reminded of a month ahead.
      { goalId: 5, name: "Term 2 fee", amount: 9_000_000, dueAt: days(25) },
    ]).run();
    state.db.insert(schema.accounts).values([{ id: 1, name: "BNI", type: "asset" }, { id: 9, name: "Salary", type: "revenue" }]).run();
    state.db.insert(schema.transactions).values({ id: 1, date: days(-2), description: "THR 2027", status: "posted" }).run();
    state.db.insert(schema.transactionLines).values([{ transactionId: 1, accountId: 1, debit: 9_000_000, credit: 0 }, { transactionId: 1, accountId: 9, debit: 0, credit: 9_000_000 }]).run();

    const reminders = (await inject("GET", "/api/goals/reminders")).json();
    const read = (list: Array<{ kind: string; goalName: string; name: string | null; amount: number | null; short: boolean }>) => list.map((item) => [item.kind, item.goalName, item.name, item.amount, item.short]);
    expect(read(reminders)).toEqual([
      ["part-due", "Wedding", "Venue deposit", 25_000_000, false],
      ["part-due", "School", "Term 2 fee", 9_000_000, true],
      ["refill", "Fund", "Car repair", 4_000_000, false],
      ["thr", "Lebaran", null, 9_000_000, false],
    ]);
    // Once some of the THR goes in, and the fund is full again, those stop.
    state.db.insert(schema.goalAllocations).values([{ goalId: 4, amount: 3_000_000, kind: "assign" }, { goalId: 3, amount: 4_000_000, kind: "assign" }]).run();
    expect((await inject("GET", "/api/goals/reminders")).json().map((item: { kind: string }) => item.kind)).toEqual(["part-due", "part-due"]);
  });

  it("plans the same trip again without its dates or bookings", async () => {
    await inject("PUT", "/api/goals/1/trip", { places: ["Seoul"], startDate: day(2, 10), endDate: day(2, 16), currency: "KRW", rate: 11.5, dailyBudget: 500_000 });
    const sari = (await inject("POST", "/api/goals/1/travellers", { name: "Sari", visaStatus: "approved", passportNumber: "X1234567" })).json();
    await inject("POST", "/api/goals/1/packing", { items: [{ text: "Charger", travellerId: sari.id }] });
    await inject("PATCH", `/api/goal-packing/${(await inject("GET", "/api/goals/1/trip")).json().packing[0].id}`, { done: true });
    await inject("POST", "/api/goals/1/bookings", { kind: "flight", title: "CGK → ICN", cost: 7_000_000, costCurrency: "IDR" });
    state.db.insert(schema.goalParts).values({ goalId: 1, name: "Food", amount: 3_000_000 }).run();
    state.db.insert(schema.goalNotePages).values({ goalId: 1, title: "Places to eat", content: "- Gwangjang market" }).run();

    const { id } = (await inject("POST", "/api/goals/1/trip/again")).json();
    const copy = state.db.select().from(schema.savingsGoals).where(eq(schema.savingsGoals.id, id)).get();
    expect([copy.name, copy.goalType, copy.targetAmount]).toEqual(["Japan again", "trip", 40_000_000]);
    const trip = (await inject("GET", `/api/goals/${id}/trip`)).json();
    expect(trip.basics).toMatchObject({ places: ["Seoul"], startDate: null, endDate: null, currency: "KRW", rate: 11.5, dailyBudget: 500_000 });
    expect(trip.travellers.map((traveller: { name: string; visaStatus: string; passportNumber: string }) => [traveller.name, traveller.visaStatus, traveller.passportNumber])).toEqual([["Sari", "to-apply", "X1234567"]]);
    expect(trip.packing.map((item: { text: string; done: boolean; travellerId: number }) => [item.text, item.done, item.travellerId])).toEqual([["Charger", false, trip.travellers[0].id]]);
    expect(trip.bookings).toEqual([]);
    expect(state.db.select().from(schema.goalParts).where(eq(schema.goalParts.goalId, id)).all().map((part: { name: string }) => part.name)).toEqual(["Food"]);
    expect(state.db.select().from(schema.goalNotePages).where(eq(schema.goalNotePages.goalId, id)).all().map((page: { title: string }) => page.title)).toEqual(["Places to eat"]);
  });
});
