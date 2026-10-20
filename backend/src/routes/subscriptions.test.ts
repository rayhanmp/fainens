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
vi.mock("../cache", () => ({ invalidateOnTransactionMutation: vi.fn(async () => {}) }));
vi.mock("../cache/invalidation", () => ({ invalidateOnTransactionMutation: vi.fn(async () => {}) }));

import subscriptionRoutes from "./subscriptions";

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

const balance = (accountId: number) => state.db.all(
  `SELECT coalesce(sum(l.debit - l.credit), 0) AS value FROM transaction_line l JOIN "transaction" t ON t.id = l.transaction_id WHERE l.account_id = ${accountId} AND t.status <> 'draft'`,
)[0].value as number;

const MAY_START = new Date(2026, 3, 24).getTime();
const MAY_END = new Date(2026, 4, 23, 23, 59, 59).getTime();
const DUE = new Date(2026, 4, 13, 12, 0).getTime();

describe("voiding a subscription occurrence", () => {
  let sqlite: InstanceType<typeof Database>;
  let app: ReturnType<typeof Fastify>;
  let renewalId: number;

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    createAllTables(sqlite);
    state.db = drizzle(sqlite);
    state.db.insert(schema.accounts).values([
      { id: 1, name: "GoPay", type: "asset", liquidityClass: "cash_equivalent", isActive: true },
      { id: 2, name: "Expense (Auto)", type: "expense", systemKey: "auto_expense", isActive: true },
    ]).run();
    state.db.insert(schema.categories).values({ id: 1, name: "Subscriptions", reportingAccountId: 2 }).run();
    state.db.insert(schema.salaryPeriods).values({ id: 5, name: "May 2026", startDate: MAY_START, endDate: MAY_END, status: "open" }).run();
    state.db.insert(schema.subscriptions).values({ id: 7, name: "Google One", linkedAccountId: 1, categoryId: 1, amount: 35_520, nextRenewalAt: new Date(2026, 5, 13) }).run();
    // A renewal the app posted although the plan had lapsed: nothing was charged.
    renewalId = state.db.insert(schema.transactions).values({
      date: new Date(DUE), description: "Subscription: Google One", txType: "subscription_renewal", status: "posted", periodId: 5, categoryId: 1, subscriptionId: 7,
    }).returning().all()[0].id;
    state.db.insert(schema.transactionLines).values([
      { transactionId: renewalId, accountId: 2, debit: 35_520, credit: 0 },
      { transactionId: renewalId, accountId: 1, debit: 0, credit: 35_520, cashFlowClass: "operating" },
    ]).run();
    state.db.insert(schema.recurringOccurrences).values({ jobType: "subscription", scheduleId: 7, occurrenceDate: new Date(DUE), status: "posted", transactionId: renewalId }).run();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate("authenticate", async () => {});
    await app.register(subscriptionRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    sqlite.close();
  });

  const voidIt = () => app.inject({ method: "POST", url: `/api/subscriptions/7/occurrences/${DUE}/void`, payload: { reason: "No charge on the GoPay statement" } });

  it("reverses the renewal on its own date and skips the occurrence", async () => {
    expect(balance(1)).toBe(-35_520);
    const response = await voidIt();
    expect(response.statusCode).toBe(201);
    const { reversalTransactionId } = response.json();

    const tx = (id: number) => state.db.select().from(schema.transactions).where(eq(schema.transactions.id, id)).all()[0];
    expect(tx(renewalId).status).toBe("reversed");
    expect(tx(reversalTransactionId)).toMatchObject({ status: "posted", txType: "domain_reversal", reversalOfTxId: renewalId, periodId: 5 });
    expect(new Date(tx(reversalTransactionId).date).getTime()).toBe(DUE);
    expect(balance(1)).toBe(0);

    const occurrence = state.db.select().from(schema.recurringOccurrences).all()[0];
    expect(occurrence).toMatchObject({ status: "skipped", transactionId: null });
    expect(occurrence.lastError).toMatch(/No charge on the GoPay statement/);
  });

  it("voids a renewal posted before occurrences were recorded, found by its reference", async () => {
    const legacyDue = new Date(2026, 3, 30, 12, 0).getTime();
    const legacyId = state.db.insert(schema.transactions).values({
      date: new Date(legacyDue), description: "Subscription: Google One", txType: "subscription_renewal", status: "posted", periodId: 5, categoryId: 1, reference: `sub:7:${legacyDue}`,
    }).returning().all()[0].id;
    // Old enough that its cash line has no cash-flow class either.
    state.db.insert(schema.transactionLines).values([
      { transactionId: legacyId, accountId: 2, debit: 35_520, credit: 0 },
      { transactionId: legacyId, accountId: 1, debit: 0, credit: 35_520 },
    ]).run();
    const response = await app.inject({ method: "POST", url: `/api/subscriptions/7/occurrences/${legacyDue}/void`, payload: { reason: "Plan had lapsed" } });
    expect(response.statusCode).toBe(201);
    expect(state.db.select().from(schema.transactions).where(eq(schema.transactions.id, legacyId)).all()[0].status).toBe("reversed");
    expect(balance(1)).toBe(-35_520); // only the other, still-posted renewal remains
    const recorded = state.db.select().from(schema.recurringOccurrences).all().find((row: { occurrenceDate: Date }) => new Date(row.occurrenceDate).getTime() === legacyDue);
    expect(recorded).toMatchObject({ status: "skipped", transactionId: null, scheduleId: 7 });
  });

  it("refuses an occurrence that is not posted", async () => {
    expect((await voidIt()).statusCode).toBe(201);
    const again = await voidIt();
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatch(/posted subscription occurrence/);
  });
});

describe("resolving subscription renewals one by one", () => {
  let sqlite: InstanceType<typeof Database>;
  let app: ReturnType<typeof Fastify>;
  const noonDaysFromToday = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(12, 0, 0, 0);
    return date.getTime();
  };
  const monthAfter = (ms: number) => {
    const date = new Date(ms);
    date.setMonth(date.getMonth() + 1);
    return date.getTime();
  };
  const dayOf = (ms: number) => new Date(ms).toDateString();
  const subscription = () => state.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, 7)).all()[0];
  const resolve = (items: unknown[]) => app.inject({ method: "POST", url: "/api/subscriptions/occurrences/resolve", payload: { items } });
  const DUE_DAYS_AGO = -10;

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    createAllTables(sqlite);
    state.db = drizzle(sqlite);
    state.db.insert(schema.accounts).values([
      { id: 1, name: "GoPay", type: "asset", liquidityClass: "cash_equivalent", isActive: true },
      { id: 2, name: "Expense (Auto)", type: "expense", systemKey: "auto-expense", isActive: true },
      { id: 3, name: "BNI", type: "asset", liquidityClass: "cash_equivalent", isActive: true },
      { id: 4, name: "GoPayLater", type: "liability", provider: "GoPayLater", isActive: true },
      { id: 5, name: "Food", type: "expense", isActive: true },
    ]).run();
    state.db.insert(schema.categories).values({ id: 1, name: "Subscriptions", reportingAccountId: 2 }).run();
    const due = noonDaysFromToday(DUE_DAYS_AGO);
    state.db.insert(schema.subscriptions).values({ id: 7, name: "Google One", linkedAccountId: 1, categoryId: 1, amount: 35_520, nextRenewalAt: new Date(due), billingDay: new Date(due).getDate() }).run();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate("authenticate", async () => {});
    await app.register(subscriptionRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    sqlite.close();
  });

  it("posts a late payment on the day it was paid and can restart the schedule from it", async () => {
    const due = noonDaysFromToday(DUE_DAYS_AGO);
    const paidAt = noonDaysFromToday(-2);
    const response = await resolve([{ subscriptionId: 7, dueAt: due, action: "post", amount: 36_000, paidAt, accountId: 3, reanchor: true }]);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ posted: 1, linked: 0, skipped: 0 });
    const [txId] = response.json().transactionIds;
    const tx = state.db.select().from(schema.transactions).where(eq(schema.transactions.id, txId)).all()[0];
    expect(new Date(tx.date).getTime()).toBe(paidAt);
    expect(tx).toMatchObject({ txType: "subscription_renewal", subscriptionId: 7, reference: `subscription:7:${due}` });
    expect(balance(3)).toBe(-36_000);
    expect(balance(1)).toBe(0);
    expect(dayOf(new Date(subscription().nextRenewalAt).getTime())).toBe(dayOf(monthAfter(paidAt)));
    expect(subscription().billingDay).toBe(new Date(paidAt).getDate());
  });

  it("keeps the original schedule after a late payment unless asked to move it", async () => {
    const due = noonDaysFromToday(DUE_DAYS_AGO);
    const response = await resolve([{ subscriptionId: 7, dueAt: due, action: "post", paidAt: noonDaysFromToday(-1) }]);
    expect(response.statusCode).toBe(200);
    expect(dayOf(new Date(subscription().nextRenewalAt).getTime())).toBe(dayOf(monthAfter(due)));
  });

  it("records a manual payment ahead of the due date, but only for the next renewal", async () => {
    const due = noonDaysFromToday(DUE_DAYS_AGO);
    expect((await resolve([{ subscriptionId: 7, dueAt: due, action: "skip" }])).statusCode).toBe(200);
    const upcoming = new Date(subscription().nextRenewalAt).getTime();
    const early = await resolve([{ subscriptionId: 7, dueAt: upcoming, action: "post", paidAt: noonDaysFromToday(0) }]);
    expect(early.statusCode).toBe(200);
    expect(balance(1)).toBe(-35_520);
    const afterThat = new Date(subscription().nextRenewalAt).getTime();
    expect(afterThat).toBeGreaterThan(upcoming);
    const future = await resolve([{ subscriptionId: 7, dueAt: afterThat, action: "post", paidAt: noonDaysFromToday(3) }]);
    expect(future.statusCode).toBe(409);
    expect(future.json().error).toMatch(/future/);
  });

  it("links an expense already entered by hand instead of posting a duplicate", async () => {
    const due = noonDaysFromToday(DUE_DAYS_AGO);
    const manualId = state.db.insert(schema.transactions).values({ date: new Date(noonDaysFromToday(-9)), description: "Google One storage", txType: "simple_expense", status: "posted", categoryId: 1 }).returning().all()[0].id;
    state.db.insert(schema.transactionLines).values([
      { transactionId: manualId, accountId: 2, debit: 35_520, credit: 0 },
      { transactionId: manualId, accountId: 1, debit: 0, credit: 35_520, cashFlowClass: "operating" },
    ]).run();

    const candidates = await app.inject({ method: "GET", url: `/api/subscriptions/7/occurrences/${due}/candidates` });
    expect(candidates.json().candidates.map((c: { transactionId: number }) => c.transactionId)).toEqual([manualId]);

    const linked = await resolve([{ subscriptionId: 7, dueAt: due, action: "link", transactionId: manualId }]);
    expect(linked.statusCode).toBe(200);
    expect(linked.json()).toMatchObject({ linked: 1, transactionIds: [manualId] });
    expect(balance(1)).toBe(-35_520);
    expect(state.db.select().from(schema.transactions).where(eq(schema.transactions.id, manualId)).all()[0].subscriptionId).toBe(7);

    const history = await app.inject({ method: "GET", url: "/api/subscriptions/7/history" });
    expect(history.json()).toMatchObject({ paidCount: 1, totalPaid: 35_520, entries: [{ dueAt: due, status: "linked", transaction: { id: manualId } }] });

    const unlinked = await app.inject({ method: "POST", url: `/api/subscriptions/7/occurrences/${due}/unlink` });
    expect(unlinked.statusCode).toBe(200);
    expect(state.db.select().from(schema.transactions).where(eq(schema.transactions.id, manualId)).all()[0].subscriptionId).toBeNull();
    expect(balance(1)).toBe(-35_520);
  });

  it("refuses to resolve renewals out of order", async () => {
    const response = await resolve([{ subscriptionId: 7, dueAt: monthAfter(noonDaysFromToday(DUE_DAYS_AGO)), action: "skip" }]);
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toMatch(/stale or leaves a gap/);
  });

  it("keeps PayLater and system accounts out of subscriptions", async () => {
    const base = { name: "Netflix", amount: 54_000, nextRenewalAt: noonDaysFromToday(5) };
    const paylater = await app.inject({ method: "POST", url: "/api/subscriptions", payload: { ...base, linkedAccountId: 4 } });
    expect(paylater.statusCode).toBe(400);
    expect(paylater.json().error).toMatch(/PayLater/);
    const expense = await app.inject({ method: "POST", url: "/api/subscriptions", payload: { ...base, linkedAccountId: 5 } });
    expect(expense.statusCode).toBe(400);
    const charge = await resolve([{ subscriptionId: 7, dueAt: noonDaysFromToday(DUE_DAYS_AGO), action: "post", accountId: 4 }]);
    expect(charge.statusCode).toBe(409);
  });

  it("stores custom intervals and foreign prices, and lists the cost per month", async () => {
    const created = await app.inject({ method: "POST", url: "/api/subscriptions", payload: {
      name: "ChatGPT Plus", linkedAccountId: 3, amount: 331_890, billingCycle: "weekly", intervalCount: 2,
      nextRenewalAt: noonDaysFromToday(3), currency: "usd", foreignAmount: 2_000, paymentMode: "manual",
    } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ billingCycle: "weekly", intervalCount: 2, currency: "USD", foreignAmount: 2_000, paymentMode: "manual", monthlyEquivalent: Math.round(331_890 * 26 / 12) });
    const missingPrice = await app.inject({ method: "POST", url: "/api/subscriptions", payload: { name: "X", linkedAccountId: 3, amount: 1_000, nextRenewalAt: noonDaysFromToday(3), currency: "EUR" } });
    expect(missingPrice.statusCode).toBe(400);
  });

  it("stops renewals after a cancelled subscription's last day", async () => {
    const cancelled = await app.inject({ method: "PATCH", url: "/api/subscriptions/7", payload: { status: "cancelled", endsAt: noonDaysFromToday(-20) } });
    expect(cancelled.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/api/subscriptions" });
    expect(list.json().renewalPreview.occurrences).toEqual([]);
    expect((await resolve([{ subscriptionId: 7, dueAt: noonDaysFromToday(DUE_DAYS_AGO), action: "post" }])).statusCode).toBe(409);
  });

  it("counts renewals posted before they carried a subscription id, by their reference", async () => {
    const paidAt = noonDaysFromToday(-40);
    const legacyId = state.db.insert(schema.transactions).values({
      date: new Date(paidAt), description: "Subscription: Google One", txType: "subscription_renewal", status: "posted", reference: `sub:7:${paidAt}`,
    }).returning().all()[0].id;
    state.db.insert(schema.transactionLines).values([
      { transactionId: legacyId, accountId: 2, debit: 35_520, credit: 0 },
      { transactionId: legacyId, accountId: 1, debit: 0, credit: 35_520 },
    ]).run();
    const list = (await app.inject({ method: "GET", url: "/api/subscriptions" })).json();
    const month = list.monthlyCharges.find((item: { items: Array<{ subscriptionId: number }> }) => item.items.some((entry) => entry.subscriptionId === 7));
    expect(month).toMatchObject({ total: 35_520, items: [{ subscriptionId: 7, amount: 35_520 }] });
    expect(list.subscriptions.find((item: { id: number }) => item.id === 7).lastPayment).toEqual({ date: paidAt, amount: 35_520 });
  });

  it("won't move the schedule back onto a renewal already recorded", async () => {
    const due = noonDaysFromToday(DUE_DAYS_AGO);
    expect((await resolve([{ subscriptionId: 7, dueAt: due, action: "skip" }])).statusCode).toBe(200);
    const back = await app.inject({ method: "PATCH", url: "/api/subscriptions/7", payload: { nextRenewalAt: due } });
    expect(back.statusCode).toBe(400);
  });
});
