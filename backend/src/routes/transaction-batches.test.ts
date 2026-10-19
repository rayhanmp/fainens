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
vi.mock("../services/storage-cleanup", () => ({ processStorageDeletionOutbox: vi.fn(async () => {}) }));

import transactionRoutes from "./transactions";
import transactionBatchRoutes from "./transaction-batches";

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

/** Ledger balance the way the app computes it: drafts never count. */
const balance = (accountId: number) => state.db.all(
  `SELECT coalesce(sum(l.debit - l.credit), 0) AS value FROM transaction_line l JOIN "transaction" t ON t.id = l.transaction_id WHERE l.account_id = ${accountId} AND t.status <> 'draft'`,
)[0].value as number;

const MARCH_START = new Date(2026, 2, 1).getTime();
const MARCH_END = new Date(2026, 2, 31).getTime();
const OCTOBER_START = new Date(2026, 9, 1).getTime();
const OCTOBER_END = new Date(2026, 9, 31).getTime();

describe("draft transactions and batches", () => {
  let sqlite: InstanceType<typeof Database>;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    createAllTables(sqlite);
    state.db = drizzle(sqlite);
    state.db.insert(schema.accounts).values([
      { id: 1, name: "BNI", type: "asset", liquidityClass: "cash_equivalent", isActive: true },
      { id: 2, name: "GoPay", type: "asset", liquidityClass: "cash_equivalent", isActive: true },
      { id: 3, name: "Food expense", type: "expense", isActive: true },
    ]).run();
    state.db.insert(schema.categories).values({ id: 1, name: "Food & Dining", reportingAccountId: 3 }).run();
    state.db.insert(schema.tags).values([{ id: 1, name: "backfill", color: "#000" }, { id: 2, name: "lunch", color: "#111" }]).run();
    state.db.insert(schema.salaryPeriods).values([
      { id: 10, name: "March 2026", startDate: MARCH_START, endDate: MARCH_END, status: "closed", closedAt: new Date(MARCH_END) },
      { id: 11, name: "October 2026", startDate: OCTOBER_START, endDate: OCTOBER_END, status: "open" },
    ]).run();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate("authenticate", async () => {});
    await app.register(transactionRoutes);
    await app.register(transactionBatchRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    sqlite.close();
  });

  const createBatch = async (name = "March backfill") => {
    const response = await app.inject({ method: "POST", url: "/api/transaction-batches", payload: { name } });
    expect(response.statusCode).toBe(201);
    return response.json().id as number;
  };

  const draftExpense = (batchId: number, overrides: Record<string, unknown> = {}) => app.inject({
    method: "POST",
    url: "/api/transactions",
    payload: {
      kind: "expense", amountCents: 50_000, description: "Warteg", date: "2026-03-10T12:00:00+07:00",
      walletAccountId: 1, categoryId: 1, tagIds: [2], status: "draft", batchId,
      ...overrides,
    },
  });

  const periodStatus = (id: number) => state.db.select({ status: schema.salaryPeriods.status })
    .from(schema.salaryPeriods).where(eq(schema.salaryPeriods.id, id)).all()[0].status as string;
  const txRow = (id: number) => state.db.select().from(schema.transactions).where(eq(schema.transactions.id, id)).all()[0];

  it("saves a draft in a closed period without touching balances, and lists it by batch", async () => {
    const batchId = await createBatch();
    const posted = await app.inject({
      method: "POST", url: "/api/transactions",
      payload: { kind: "expense", amountCents: 50_000, description: "Warteg", date: "2026-03-10T12:00:00+07:00", walletAccountId: 1 },
    });
    expect(posted.statusCode).toBe(400);
    expect(posted.json().error).toMatch(/closed/);

    const draft = await draftExpense(batchId);
    expect(draft.statusCode).toBe(201);
    const row = txRow(draft.json().id);
    expect(row.status).toBe("draft");
    expect(row.batchId).toBe(batchId);
    expect(row.periodId).toBe(10);
    expect(balance(1)).toBe(0);

    const list = await app.inject({ method: "GET", url: `/api/transactions?periodId=all&status=draft&batchId=${batchId}` });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((item: { id: number }) => item.id)).toEqual([draft.json().id]);
    const postedOnly = await app.inject({ method: "GET", url: "/api/transactions?periodId=all&status=posted" });
    expect(postedOnly.json().data).toHaveLength(0);

    const detail = await app.inject({ method: "GET", url: `/api/transaction-batches/${batchId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      draftCount: 1,
      postedCount: 0,
      accountImpact: [{ accountId: 1, accountName: "BNI", deltaCents: -50_000, draftCount: 1 }],
      periods: [{ periodId: 10, periodName: "March 2026", status: "closed", draftCount: 1 }],
    });
  });

  it("lets a draft be edited freely, including moving it between closed periods", async () => {
    const batchId = await createBatch();
    const { id } = (await draftExpense(batchId, { date: "2026-10-05T12:00:00+07:00" })).json();
    expect(txRow(id).periodId).toBe(11);

    const edited = await app.inject({
      method: "PUT", url: `/api/transactions/${id}`,
      payload: {
        date: "2026-03-12T09:00:00+07:00",
        description: "Warteg Bahari",
        tagIds: [1, 2],
        lines: [
          { accountId: 3, debit: 75_000, credit: 0 },
          { accountId: 1, debit: 0, credit: 75_000, cashFlowClass: "operating" },
        ],
      },
    });
    expect(edited.statusCode).toBe(200);
    const row = txRow(id);
    expect(row.status).toBe("draft");
    expect(row.periodId).toBe(10);
    expect(row.description).toBe("Warteg Bahari");
    const tagIds = state.db.select({ tagId: schema.transactionTags.tagId }).from(schema.transactionTags)
      .where(eq(schema.transactionTags.transactionId, id)).all().map((tag: { tagId: number }) => tag.tagId).sort();
    expect(tagIds).toEqual([1, 2]);
    expect(balance(1)).toBe(0);
  });

  it("posts a batch through a closed period, reopening and closing it inside one commit", async () => {
    const batchId = await createBatch();
    const first = (await draftExpense(batchId)).json().id as number;
    const second = (await draftExpense(batchId, { kind: "income", amountCents: 7_000_000, description: "Salary income - March 2026", categoryId: undefined, tagIds: undefined })).json().id as number;

    const response = await app.inject({ method: "POST", url: `/api/transaction-batches/${batchId}/post`, payload: {} });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ posted: [first, second], failed: [], reopenedPeriodIds: [10], batchStatus: "posted" });
    expect(txRow(first).status).toBe("posted");
    expect(txRow(second).status).toBe("posted");
    expect(periodStatus(10)).toBe("closed");
    expect(balance(1)).toBe(7_000_000 - 50_000);

    const actions = state.db.select({ entityType: schema.auditLogs.entityType, action: schema.auditLogs.action })
      .from(schema.auditLogs).all().map((row: { entityType: string; action: string }) => `${row.entityType}:${row.action}`);
    expect(actions).toEqual(expect.arrayContaining(["salary_period:reopen", "transaction:post", "salary_period:close"]));

    const batch = await app.inject({ method: "GET", url: `/api/transaction-batches/${batchId}` });
    expect(batch.json()).toMatchObject({ status: "posted", draftCount: 0, postedCount: 2, accountImpact: [] });
  });

  it("keeps a broken draft as a draft and posts the rest", async () => {
    const batchId = await createBatch();
    const good = (await draftExpense(batchId)).json().id as number;
    const broken = (await draftExpense(batchId, { description: "Half-entered" })).json().id as number;
    state.db.update(schema.transactionLines).set({ credit: 1 })
      .where(eq(schema.transactionLines.transactionId, broken)).run();

    const response = await app.inject({ method: "POST", url: `/api/transaction-batches/${batchId}/post`, payload: {} });
    expect(response.statusCode).toBe(200);
    expect(response.json().posted).toEqual([good]);
    expect(response.json().failed).toEqual([{ id: broken, error: expect.stringMatching(/balance/) }]);
    expect(response.json().batchStatus).toBe("open");
    expect(txRow(broken).status).toBe("draft");
    expect(periodStatus(10)).toBe("closed");
  });

  it("imports rows as drafts into a batch with per-row tags, then discards them", async () => {
    const batchId = await createBatch("Statement import");
    const imported = await app.inject({
      method: "POST", url: "/api/transactions/import-confirm",
      payload: {
        asDraft: true,
        batchId,
        rows: [
          { date: "2026-03-03", description: "Indomaret", amount: 25_000, type: "expense", accountId: 1, categoryId: 1, tagIds: [2] },
          { date: "2026-03-25", description: "Salary income - March 2026", amount: 7_000_000, type: "income", accountId: 1, tagIds: [1] },
        ],
      },
    });
    expect(imported.statusCode).toBe(201);
    const ids = imported.json().transactions.map((row: { id: number }) => row.id) as number[];
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(txRow(id)).toMatchObject({ status: "draft", batchId });
    const tagsOfFirst = state.db.select({ tagId: schema.transactionTags.tagId }).from(schema.transactionTags)
      .where(eq(schema.transactionTags.transactionId, ids[0])).all().map((tag: { tagId: number }) => tag.tagId);
    expect(tagsOfFirst).toEqual([2]);
    expect(balance(1)).toBe(0);

    const discarded = await app.inject({ method: "DELETE", url: `/api/transaction-batches/${batchId}` });
    expect(discarded.statusCode).toBe(200);
    expect(discarded.json()).toEqual({ success: true, deletedCount: 2 });
    expect(state.db.select().from(schema.transactions).all()).toHaveLength(0);
    expect(state.db.select().from(schema.transactionLines).all()).toHaveLength(0);
    const batch = await app.inject({ method: "GET", url: `/api/transaction-batches/${batchId}` });
    expect(batch.json().status).toBe("discarded");
    const again = await app.inject({ method: "POST", url: `/api/transaction-batches/${batchId}/post`, payload: {} });
    expect(again.statusCode).toBe(409);
  });

  it("rebuilds a draft from the entry form input, keeping its id and batch", async () => {
    const batchId = await createBatch();
    const { id } = (await draftExpense(batchId)).json();
    const rebuilt = await app.inject({
      method: "PUT", url: `/api/transactions/${id}/draft`,
      payload: {
        kind: "transfer", amountCents: 200_000, description: "Top up GoPay", date: "2026-03-20T08:00:00+07:00",
        walletAccountId: 1, toWalletAccountId: 2, tagIds: [1],
      },
    });
    expect(rebuilt.statusCode).toBe(200);
    expect(rebuilt.json().id).toBe(id);
    const row = txRow(id);
    expect(row).toMatchObject({ status: "draft", batchId, txType: "simple_transfer", description: "Top up GoPay", categoryId: null });
    const lines = state.db.select().from(schema.transactionLines).where(eq(schema.transactionLines.transactionId, id)).all();
    expect(lines.map((line: { accountId: number; debit: number; credit: number }) => [line.accountId, line.debit, line.credit]).sort()).toEqual([[1, 0, 200_000], [2, 200_000, 0]]);
    expect(state.db.select().from(schema.transactionCategoryAllocations).where(eq(schema.transactionCategoryAllocations.transactionId, id)).all()).toHaveLength(0);
    expect(balance(1)).toBe(0);

    const posted = await app.inject({ method: "POST", url: `/api/transaction-batches/${batchId}/post`, payload: {} });
    expect(posted.json().posted).toEqual([id]);
    const again = await app.inject({ method: "PUT", url: `/api/transactions/${id}/draft`, payload: { kind: "expense", amountCents: 1, description: "x", date: "2026-03-20T08:00:00+07:00", walletAccountId: 1 } });
    expect(again.statusCode).toBe(409);
  });

  it("refuses a posted journal in a batch and a draft import outside draft mode", async () => {
    const batchId = await createBatch();
    const response = await app.inject({
      method: "POST", url: "/api/transactions",
      payload: { kind: "expense", amountCents: 1_000, description: "Oops", date: "2026-10-05T12:00:00+07:00", walletAccountId: 1, batchId },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/draft/);
  });
});
