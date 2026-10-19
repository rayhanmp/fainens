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
