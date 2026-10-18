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

import transactionRoutes from "./transactions";

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
  `SELECT coalesce(sum(l.debit - l.credit), 0) AS value FROM transaction_line l JOIN "transaction" t ON t.id = l.transaction_id WHERE l.account_id = ${accountId}`,
)[0].value as number;

describe("ledger guards on transaction routes", () => {
  let sqlite: InstanceType<typeof Database>;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    createAllTables(sqlite);
    state.db = drizzle(sqlite);
    state.db.insert(schema.accounts).values([
      { id: 1, name: "BCA", type: "asset", liquidityClass: "cash_equivalent", isActive: true },
      { id: 2, name: "OVO", type: "asset", liquidityClass: "cash_equivalent", isActive: true },
      { id: 3, name: "Fees", type: "expense", isActive: true },
    ]).run();
    state.db.insert(schema.categories).values({ id: 1, name: "Transfer fees", reportingAccountId: 3 }).run();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate("authenticate", async () => {});
    await app.register(transactionRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    sqlite.close();
  });

  const transferWithFee = () => app.inject({
    method: "POST",
    url: "/api/transactions",
    payload: {
      kind: "transfer", amountCents: 100_000, description: "Top up", date: "2026-10-10T10:00:00+07:00",
      walletAccountId: 1, toWalletAccountId: 2,
      transferFee: { amountCents: 1_000, paidBy: "sender", categoryId: 1 },
    },
  });

  it("saves a transfer and its fee together, linked", async () => {
    const response = await transferWithFee();
    expect(response.statusCode).toBe(201);
    const { id, feeTransactionId } = response.json();
    const fee = state.db.select().from(schema.transactions).where(eq(schema.transactions.id, feeTransactionId)).all()[0];
    expect(fee.linkedTxId).toBe(id);
    expect(fee.notes).toMatch(new RegExp(`^Admin fee for transfer #${id}\\.`));
    expect([balance(1), balance(2), balance(3)]).toEqual([-101_000, 100_000, 1_000]);
  });

  it("refuses the whole transfer when the fee can't be posted", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/transactions",
      payload: {
        kind: "transfer", amountCents: 100_000, description: "Top up", date: "2026-10-10T10:00:00+07:00",
        walletAccountId: 1, toWalletAccountId: 2, transferFee: { amountCents: 1_000, paidBy: "sender", categoryId: 999 },
      },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(state.db.select().from(schema.transactions).all()).toHaveLength(0);
  });

  it("reverses a transfer together with its fee", async () => {
    const { id, feeTransactionId } = (await transferWithFee()).json();
    const response = await app.inject({ method: "POST", url: `/api/transactions/${id}/reverse` });
    expect(response.statusCode).toBe(201);
    expect(response.json().reversedLinkedTransactionIds).toEqual([feeTransactionId]);
    const statuses = state.db.select({ id: schema.transactions.id, status: schema.transactions.status }).from(schema.transactions).all();
    expect(statuses.filter((row: { status: string }) => row.status === "reversed").map((row: { id: number }) => row.id).sort()).toEqual([id, feeTransactionId].sort());
    expect([balance(1), balance(2), balance(3)]).toEqual([0, 0, 0]);
  });

  it("refuses to reverse a reversal or a workflow-owned entry", async () => {
    const { id } = (await transferWithFee()).json();
    const reversal = (await app.inject({ method: "POST", url: `/api/transactions/${id}/reverse` })).json();
    expect((await app.inject({ method: "POST", url: `/api/transactions/${reversal.id}/reverse` })).statusCode).toBe(409);

    state.db.insert(schema.transactions).values({ id: 50, date: new Date(), description: "Lend to Sam", txType: "loan_creation" }).run();
    state.db.insert(schema.transactionLines).values([
      { transactionId: 50, accountId: 2, debit: 0, credit: 5_000, cashFlowClass: "financing" },
      { transactionId: 50, accountId: 1, debit: 5_000, credit: 0, cashFlowClass: "financing" },
    ]).run();
    const loan = await app.inject({ method: "POST", url: "/api/transactions/50/reverse" });
    expect(loan.statusCode).toBe(409);
    expect(loan.json().error).toMatch(/loan_creation/);
  });

  it("locks a reversed transaction against edits and deletion", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/transactions",
      payload: { kind: "expense", amountCents: 50_000, description: "Lunch", date: "2026-10-10T12:00:00+07:00", walletAccountId: 1, categoryId: 1 },
    });
    const { id } = created.json();
    expect((await app.inject({ method: "POST", url: `/api/transactions/${id}/reverse` })).statusCode).toBe(201);
    const edit = await app.inject({
      method: "PUT",
      url: `/api/transactions/${id}`,
      payload: { lines: [{ accountId: 3, debit: 5_000_000, credit: 0 }, { accountId: 1, debit: 0, credit: 5_000_000, cashFlowClass: "operating" }] },
    });
    expect(edit.statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url: `/api/transactions/${id}` })).statusCode).toBe(409);
    expect(balance(1)).toBe(0);
  });
});
