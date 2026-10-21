import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, is, SQL } from "drizzle-orm";
import { getTableConfig, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
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
vi.mock("../services/transaction-parser", () => ({ parseNaturalLanguageTransaction: vi.fn() }));

import pendingRoutes, { resolvePendingSourceWallet, SOURCE_ACCOUNT_REQUIRED } from "./pending-transactions";
import { parseNaturalLanguageTransaction } from "../services/transaction-parser";

const parseMock = vi.mocked(parseNaturalLanguageTransaction);

function createTables(sqlite: InstanceType<typeof Database>) {
  const dialect = new SQLiteSyncDialect();
  for (const table of [schema.accounts, schema.categories, schema.tags, schema.transactions, schema.transactionLines,
    schema.transactionTags, schema.transactionCategoryAllocations, schema.transactionReallocations,
    schema.salaryPeriods, schema.auditLogs, schema.financialState, schema.pendingTransactions]) {
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
      return `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}${column.notNull ? " NOT NULL" : ""}${column.isUnique ? " UNIQUE" : ""}${defaultSql}`;
    });
    sqlite.exec(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
  }
}

const expense = {
  type: "expense",
  amount: 654_500,
  description: "SOGOGI RESERVE",
  category: "Food & Dining",
  date: "2026-09-12",
  confidence: 0.9,
};

describe("pending transaction routes", () => {
  let sqlite: InstanceType<typeof Database>;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    createTables(sqlite);
    state.db = drizzle(sqlite);
    state.db.insert(schema.accounts).values([
      { id: 1, name: "BCA", type: "asset", liquidityClass: "cash_equivalent", isActive: true },
      { id: 2, name: "BCA Syariah", type: "asset", liquidityClass: "cash_equivalent", isActive: true },
      { id: 3, name: "Dining expense", type: "expense", isActive: true },
    ]).run();
    state.db.insert(schema.categories).values({ id: 1, name: "Food & Dining", reportingAccountId: 3 }).run();
    parseMock.mockReset();

    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate("authenticate", async () => {});
    await app.register(pendingRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    sqlite.close();
    state.db = null;
  });

  function insertPending(parsed: Record<string, unknown>, overrides: Partial<typeof schema.pendingTransactions.$inferInsert> = {}): number {
    return state.db.insert(schema.pendingTransactions).values({
      rawMessage: "raw",
      parsedData: JSON.stringify(parsed),
      status: "pending",
      parseAttempts: 1,
      source: "web",
      ...overrides,
    }).returning({ id: schema.pendingTransactions.id }).all()[0].id;
  }

  function pendingStatus(id: number): string {
    return state.db.select().from(schema.pendingTransactions).where(eq(schema.pendingTransactions.id, id)).all()[0].status;
  }

  it("approves through the canonical ledger path with category account and allocation, once", async () => {
    const id = insertPending({ ...expense, fromAccount: "BCA", fromAccountId: 1, reference: "REF-1" });

    const first = await app.inject({ method: "POST", url: `/api/pending-transactions/${id}/approve` });
    expect(first.statusCode).toBe(200);
    const transactionId = first.json().transactionId;

    const [tx] = state.db.select().from(schema.transactions).all();
    expect(tx).toMatchObject({ id: transactionId, categoryId: 1, reference: "REF-1", txType: "simple_expense", status: "posted" });
    const lines = state.db.select().from(schema.transactionLines).all();
    expect(lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: 3, debit: 654_500, credit: 0 }),
      expect.objectContaining({ accountId: 1, debit: 0, credit: 654_500, cashFlowClass: "operating" }),
    ]));
    expect(state.db.select().from(schema.transactionCategoryAllocations).all())
      .toEqual([expect.objectContaining({ transactionId, categoryId: 1, amount: 654_500 })]);
    expect(state.db.select().from(schema.financialState).all()[0].revision).toBe(1);
    expect(pendingStatus(id)).toBe("approved");

    const second = await app.inject({ method: "POST", url: `/api/pending-transactions/${id}/approve` });
    expect(second.statusCode).toBe(409);
    expect(state.db.select().from(schema.transactions).all()).toHaveLength(1);
  });

  it("closes an item posted through the transaction form, once, linking the transaction", async () => {
    const id = insertPending({ ...expense, type: "transfer" });
    const posted = state.db.insert(schema.transactions).values({ date: new Date(), description: "Top up", status: "posted" }).returning({ id: schema.transactions.id }).all()[0].id;

    expect((await app.inject({ method: "POST", url: `/api/pending-transactions/${id}/resolve`, payload: { transactionId: 999 } })).statusCode).toBe(422);
    expect(pendingStatus(id)).toBe("pending");

    const first = await app.inject({ method: "POST", url: `/api/pending-transactions/${id}/resolve`, payload: { transactionId: posted } });
    expect(first.statusCode).toBe(200);
    expect(pendingStatus(id)).toBe("approved");
    const audit = state.db.select().from(schema.auditLogs).all().find((row: { entityId: number }) => row.entityId === id);
    expect(JSON.parse(Buffer.from(audit.afterSnapshot).toString())).toMatchObject({ transactionId: posted });

    expect((await app.inject({ method: "POST", url: `/api/pending-transactions/${id}/resolve`, payload: { transactionId: posted } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/api/pending-transactions/4242/resolve`, payload: { transactionId: posted } })).statusCode).toBe(404);
  });

  it("refuses to post into a closed period", async () => {
    state.db.insert(schema.salaryPeriods).values({
      name: "September", startDate: Date.parse("2026-09-01T00:00:00+07:00"), endDate: Date.parse("2026-09-30T00:00:00+07:00"), status: "closed",
    }).run();
    const id = insertPending({ ...expense, fromAccountId: 1 });

    const response = await app.inject({ method: "POST", url: `/api/pending-transactions/${id}/approve` });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toMatch(/closed/);
    expect(state.db.select().from(schema.transactions).all()).toHaveLength(0);
    expect(pendingStatus(id)).toBe("pending");
  });

  it("matches the wallet name exactly and refuses to guess", async () => {
    const exact = insertPending({ ...expense, category: "Others", fromAccount: "bca" });
    expect((await app.inject({ method: "POST", url: `/api/pending-transactions/${exact}/approve` })).statusCode).toBe(200);
    const walletLine = state.db.select().from(schema.transactionLines).all().find((line: any) => line.credit > 0);
    expect(walletLine.accountId).toBe(1);

    const unknown = insertPending({ ...expense, fromAccount: "BNI" });
    const unknownResponse = await app.inject({ method: "POST", url: `/api/pending-transactions/${unknown}/approve` });
    expect(unknownResponse.statusCode).toBe(422);
    expect(unknownResponse.json()).toMatchObject({ code: SOURCE_ACCOUNT_REQUIRED, error: expect.stringMatching(/choose the account/) });

    const unspecified = insertPending({ ...expense });
    const unspecifiedResponse = await app.inject({ method: "POST", url: `/api/pending-transactions/${unspecified}/approve` });
    expect(unspecifiedResponse.statusCode).toBe(422);
    expect(unspecifiedResponse.json().code).toBe(SOURCE_ACCOUNT_REQUIRED);
    expect(state.db.select().from(schema.transactions).all()).toHaveLength(1);
  });

  it("resolves wallets without substring matches", () => {
    const wallets = [{ id: 2, name: "BCA Syariah" }];
    expect(resolvePendingSourceWallet({ fromAccount: "BCA" }, wallets)).toHaveProperty("error");
    expect(resolvePendingSourceWallet({ fromAccount: "  bca   syariah " }, wallets)).toEqual({ wallet: wallets[0] });
    expect(resolvePendingSourceWallet({}, wallets)).toEqual({ wallet: wallets[0] });
    expect(resolvePendingSourceWallet({ fromAccountId: 99, fromAccount: "BCA Syariah" }, wallets)).toHaveProperty("error");
    expect(resolvePendingSourceWallet({ fromAccount: "Cash" }, [{ id: 1, name: "Cash" }, { id: 2, name: "cash" }])).toHaveProperty("error");
  });

  it("refuses to approve a transfer as an expense", async () => {
    const id = insertPending({ ...expense, type: "transfer", category: "Others", fromAccountId: 1, toAccount: "BCA Syariah" });
    const response = await app.inject({ method: "POST", url: `/api/pending-transactions/${id}/approve` });
    expect(response.statusCode).toBe(422);
    expect(state.db.select().from(schema.transactions).all()).toHaveLength(0);
  });

  it("refuses to reject an approved item", async () => {
    const approved = insertPending({ ...expense, fromAccountId: 1 }, { status: "approved" });
    const response = await app.inject({ method: "POST", url: `/api/pending-transactions/${approved}/reject` });
    expect(response.statusCode).toBe(409);
    expect(pendingStatus(approved)).toBe("approved");

    const open = insertPending({ ...expense, fromAccountId: 1 });
    expect((await app.inject({ method: "POST", url: `/api/pending-transactions/${open}/reject` })).statusCode).toBe(200);
    expect(pendingStatus(open)).toBe("rejected");
  });

  it("refuses to retry approved, rejected or structured Gmail items", async () => {
    const approved = insertPending({ ...expense, fromAccountId: 1 }, { status: "approved" });
    const rejected = insertPending({ ...expense }, { status: "rejected" });
    const gmail = insertPending({ ...expense, fromAccountId: 1, reference: "REF-9" }, { status: "failed", source: "gmail:bni" });
    for (const id of [approved, rejected, gmail]) {
      expect((await app.inject({ method: "POST", url: `/api/pending-transactions/${id}/retry` })).statusCode).toBe(409);
    }
    expect(parseMock).not.toHaveBeenCalled();
    expect(pendingStatus(approved)).toBe("approved");
    expect(pendingStatus(rejected)).toBe("rejected");
  });

  it("retries a failed item and keeps the account the user already chose", async () => {
    const id = insertPending({ ...expense, amount: 0, confidence: 0, fromAccountId: 1, fromAccount: "BCA" }, { status: "failed" });
    parseMock.mockResolvedValue({ type: "expense", amount: 25_000, description: "Kopi", category: "Food & Dining", confidence: 0.8 });

    const response = await app.inject({ method: "POST", url: `/api/pending-transactions/${id}/retry` });
    expect(response.statusCode).toBe(200);
    const row = state.db.select().from(schema.pendingTransactions).where(eq(schema.pendingTransactions.id, id)).all()[0];
    expect(row.status).toBe("pending");
    expect(JSON.parse(row.parsedData)).toMatchObject({ amount: 25_000, fromAccountId: 1, fromAccount: "BCA" });
  });
});
