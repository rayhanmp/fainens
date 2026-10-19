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
    expect(response.json()).toEqual({ posted: [first, second], failed: [], reopenedPeriodIds: [10], batchStatus: "posted", settlements: [], reversed: [] });
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

  const postIncome = (amount: number, date: string, walletAccountId = 1) => app.inject({
    method: "POST", url: "/api/transactions",
    payload: { kind: "income", amountCents: amount, description: "Salary", date, walletAccountId },
  });
  const MARCH_31_EVENING = new Date(2026, 2, 31, 23, 59, 59, 999).getTime();

  it("previews what the batch does to each account and settles one by keeping today's balance", async () => {
    expect((await postIncome(1_000_000, "2026-10-02T09:00:00+07:00")).statusCode).toBe(201);
    const batchId = await createBatch();
    await draftExpense(batchId);
    await draftExpense(batchId, { kind: "income", amountCents: 7_000_000, description: "Salary income - March 2026", categoryId: undefined, tagIds: undefined });

    const preview = await app.inject({ method: "GET", url: `/api/transaction-batches/${batchId}/settlement` });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().accounts).toEqual([expect.objectContaining({
      accountId: 1, accountName: "BNI", accountType: "asset", currentBalance: 1_000_000, batchDelta: 6_950_000, draftCount: 2, adjustments: [],
    })]);

    const response = await app.inject({
      method: "POST", url: `/api/transaction-batches/${batchId}/post`,
      payload: { settlements: [{ accountId: 1, mode: "keep_current", asOfDate: MARCH_31_EVENING }] },
    });
    expect(response.statusCode).toBe(200);
    const [settlement] = response.json().settlements;
    expect(settlement).toMatchObject({ accountId: 1, difference: -6_950_000 });
    expect(balance(1)).toBe(1_000_000);
    expect(txRow(settlement.transactionId)).toMatchObject({ status: "posted", txType: "balance_adjustment", periodId: 10, batchId });
    expect(periodStatus(10)).toBe("closed");

    const items = state.db.select().from(schema.reconciliationItems).all();
    expect(items).toEqual([expect.objectContaining({ accountId: 1, ledgerBalance: 6_950_000, actualBalance: 0, difference: -6_950_000, correctionTransactionId: settlement.transactionId })]);
    const session = state.db.select().from(schema.reconciliationSessions).all()[0];
    expect(session).toMatchObject({ kind: "adjustment", status: "adjusted" });

    const after = await app.inject({ method: "GET", url: `/api/transaction-batches/${batchId}/settlement` });
    expect(after.json().accounts).toEqual([]);
  });

  it("matches a statement's closing balance on one account and leaves the other to move", async () => {
    const batchId = await createBatch();
    await app.inject({
      method: "POST", url: "/api/transactions",
      payload: { kind: "transfer", amountCents: 200_000, description: "Top up GoPay", date: "2026-03-20T08:00:00+07:00", walletAccountId: 1, toWalletAccountId: 2, status: "draft", batchId },
    });
    await draftExpense(batchId, { amountCents: 30_000, description: "Kopi", date: "2026-03-21T08:00:00+07:00", walletAccountId: 2 });

    const at = await app.inject({ method: "GET", url: `/api/transaction-batches/${batchId}/balance-at?accountId=2&asOfDate=${MARCH_31_EVENING}` });
    expect(at.statusCode).toBe(200);
    expect(at.json()).toEqual({ postedBalance: 0, draftDelta: 170_000 });

    const response = await app.inject({
      method: "POST", url: `/api/transaction-batches/${batchId}/post`,
      payload: { settlements: [{ accountId: 2, mode: "match", asOfDate: MARCH_31_EVENING, actualBalance: 150_000 }] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().settlements).toEqual([expect.objectContaining({ accountId: 2, difference: -20_000 })]);
    expect(balance(2)).toBe(150_000);
    expect(balance(1)).toBe(-200_000);
  });

  it("records a matched statement balance without an adjustment, and refuses settling an account twice", async () => {
    const batchId = await createBatch();
    await draftExpense(batchId);
    const twice = await app.inject({
      method: "POST", url: `/api/transaction-batches/${batchId}/post`,
      payload: { settlements: [
        { accountId: 1, mode: "keep_current", asOfDate: MARCH_31_EVENING },
        { accountId: 1, mode: "match", asOfDate: MARCH_31_EVENING, actualBalance: 0 },
      ] },
    });
    expect(twice.statusCode).toBe(400);
    expect(balance(1)).toBe(0);

    const response = await app.inject({
      method: "POST", url: `/api/transaction-batches/${batchId}/post`,
      payload: { settlements: [{ accountId: 1, mode: "match", asOfDate: MARCH_31_EVENING, actualBalance: -50_000 }] },
    });
    expect(response.json().settlements).toEqual([{ accountId: 1, difference: 0, transactionId: null }]);
    expect(state.db.select().from(schema.reconciliationSessions).all()[0]).toMatchObject({ kind: "control", status: "reconciled" });
  });

  it("imports salary as the month's salary with notes and place, and keeps it salary through the entry form", async () => {
    const batchId = await createBatch();
    const imported = await app.inject({
      method: "POST", url: "/api/transactions/import-confirm",
      payload: {
        asDraft: true,
        batchId,
        rows: [
          { date: "2026-03-25T09:00:00+07:00", description: "Gaji Maret", amount: 7_554_552, type: "salary", accountId: 1, notes: "Net after PPh 21" },
          { date: "2026-03-26T12:30:00+07:00", description: "Kopi", amount: 25_000, type: "expense", accountId: 2, categoryId: 1, place: "Kopi Kenangan Kuningan" },
        ],
      },
    });
    expect(imported.statusCode).toBe(201);
    const [salaryId, coffeeId] = imported.json().transactions.map((row: { id: number }) => row.id) as number[];
    expect(txRow(salaryId)).toMatchObject({ txType: "salary_income", status: "draft", notes: "Net after PPh 21" });
    expect(txRow(coffeeId)).toMatchObject({ txType: "simple_expense", place: "Kopi Kenangan Kuningan" });
    expect(balance(1)).toBe(0);

    const rebuilt = await app.inject({
      method: "PUT", url: `/api/transactions/${salaryId}/draft`,
      payload: { kind: "income", amountCents: 7_600_000, description: "Gaji Maret", date: "2026-03-25T09:00:00+07:00", walletAccountId: 1 },
    });
    expect(rebuilt.statusCode).toBe(200);
    expect(txRow(salaryId)).toMatchObject({ txType: "salary_income", status: "draft" });

    const deleted = await app.inject({ method: "DELETE", url: `/api/transactions/${salaryId}` });
    expect(deleted.statusCode).toBeLessThan(300);
    expect(state.db.select().from(schema.transactions).where(eq(schema.transactions.id, salaryId)).all()).toHaveLength(0);
  });

  it("deletes a transfer draft together with its linked fee draft", async () => {
    const batchId = await createBatch();
    const created = await app.inject({
      method: "POST", url: "/api/transactions",
      payload: {
        kind: "transfer", amountCents: 200_000, description: "Top up GoPay", date: "2026-03-20T08:00:00+07:00",
        walletAccountId: 1, toWalletAccountId: 2, transferFee: { amountCents: 1_000, paidBy: "sender" }, status: "draft", batchId,
      },
    });
    expect(created.statusCode).toBe(201);
    const { transactionId, feeTransactionId } = created.json();
    expect(txRow(feeTransactionId)).toMatchObject({ status: "draft", batchId, linkedTxId: transactionId });

    const deleted = await app.inject({ method: "DELETE", url: `/api/transactions/${transactionId}` });
    expect(deleted.statusCode).toBeLessThan(300);
    expect(state.db.select().from(schema.transactions).all()).toHaveLength(0);
  });

  it("reverses replaced entries on their original dates, through a closed period, with a transfer's fee", async () => {
    // An old balance plug inside closed March, the kind a backfill replaces with real history.
    const plugDate = new Date(2026, 2, 20, 7, 0).getTime();
    const plug = state.db.insert(schema.transactions).values({
      date: new Date(plugDate), description: "Reconciliation: BNI", txType: "reconciliation_expense", status: "posted", periodId: 10,
    }).returning().all()[0];
    // Recorded before cash-flow classes existed: its cash line has none.
    state.db.insert(schema.transactionLines).values([
      { transactionId: plug.id, accountId: 3, debit: 90_000, credit: 0 },
      { transactionId: plug.id, accountId: 1, debit: 0, credit: 90_000 },
    ]).run();
    const legacyMove = state.db.insert(schema.transactions).values({
      date: new Date(plugDate), description: "GoPay Reconciliation", txType: "simple_transfer", status: "posted", periodId: 10,
    }).returning().all()[0];
    state.db.insert(schema.transactionLines).values([
      { transactionId: legacyMove.id, accountId: 2, debit: 5_000, credit: 0 },
      { transactionId: legacyMove.id, accountId: 1, debit: 0, credit: 5_000 },
    ]).run();
    const transfer = await app.inject({
      method: "POST", url: "/api/transactions",
      payload: { kind: "transfer", amountCents: 200_000, description: "Top up GoPay", date: "2026-10-05T08:00:00+07:00", walletAccountId: 1, toWalletAccountId: 2, transferFee: { amountCents: 1_000, paidBy: "sender" } },
    });
    expect(transfer.statusCode).toBe(201);
    const { transactionId: transferId, feeTransactionId } = transfer.json();
    expect(balance(1)).toBe(-90_000 - 5_000 - 200_000 - 1_000);

    const batchId = await createBatch("Rebuild");
    await draftExpense(batchId, { amountCents: 90_000, description: "Real March spending" });
    const response = await app.inject({
      method: "POST", url: `/api/transaction-batches/${batchId}/post`,
      payload: { reverseTransactionIds: [plug.id, legacyMove.id, transferId] },
    });
    expect(response.statusCode).toBe(200);
    const result = response.json();
    expect(result.reversed.map((item: { id: number }) => item.id).sort()).toEqual([plug.id, legacyMove.id, transferId, feeTransactionId].sort());
    // Missing classes are filled in the way the simple builders classify: spending is operating, cash to cash a transfer.
    const reversalOf = (id: number) => (result.reversed as Array<{ id: number; reversalId: number }>).find((item) => item.id === id)!.reversalId;
    const cashClass = (txId: number) => state.db.select().from(schema.transactionLines).all()
      .filter((line: typeof schema.transactionLines.$inferSelect) => line.transactionId === txId && line.accountId === 1)[0]?.cashFlowClass;
    expect(cashClass(reversalOf(plug.id))).toBe("operating");
    expect(cashClass(reversalOf(legacyMove.id))).toBe("transfer");
    for (const { id, reversalId } of result.reversed as Array<{ id: number; reversalId: number }>) {
      expect(txRow(id).status).toBe("reversed");
      expect(txRow(reversalId)).toMatchObject({ status: "posted", txType: "reversal", reversalOfTxId: id, batchId });
      expect(new Date(txRow(reversalId).date).getTime()).toBe(new Date(txRow(id).date).getTime());
    }
    expect(periodStatus(10)).toBe("closed");
    // The plug's Rp90.000 is replaced by the real draft; the transfer and its fee are gone.
    expect(balance(1)).toBe(-90_000);
    expect(balance(2)).toBe(0);
  });

  it("aligns a late reversal with the entry it reverses, but not across a closed period", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/transactions",
      payload: { kind: "expense", amountCents: 6_000, description: "Duplicate ride", date: "2026-10-03T09:00:00+07:00", walletAccountId: 1 },
    });
    const originalId = created.json().id as number;
    const reversed = await app.inject({ method: "POST", url: `/api/transactions/${originalId}/reverse`, payload: {} });
    expect(reversed.statusCode).toBe(201);
    const reversalId = reversed.json().id as number;
    expect(new Date(txRow(reversalId).date).getTime()).not.toBe(new Date(txRow(originalId).date).getTime());

    const aligned = await app.inject({ method: "POST", url: `/api/transactions/${reversalId}/align-reversal`, payload: {} });
    expect(aligned.statusCode).toBe(200);
    expect(new Date(txRow(reversalId).date).getTime()).toBe(new Date(txRow(originalId).date).getTime());
    expect(txRow(reversalId).periodId).toBe(11);

    // A reversal of an entry inside closed March stays where it is.
    const old = state.db.insert(schema.transactions).values({ date: new Date(2026, 2, 10), description: "Old", txType: "simple_expense", status: "reversed", periodId: 10 }).returning().all()[0];
    const late = state.db.insert(schema.transactions).values({ date: new Date(2026, 9, 10), description: "Reversal: Old", txType: "reversal", status: "posted", periodId: 11, reversalOfTxId: old.id }).returning().all()[0];
    const refused = await app.inject({ method: "POST", url: `/api/transactions/${late.id}/align-reversal`, payload: {} });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatch(/original's period is closed/);
    expect(await app.inject({ method: "POST", url: `/api/transactions/${originalId}/align-reversal`, payload: {} }).then((r: { statusCode: number }) => r.statusCode)).toBe(409);
  });

  it("refuses to reverse a workflow-owned entry", async () => {
    const loan = state.db.insert(schema.transactions).values({
      date: new Date(2026, 9, 3), description: "Loan to Aufar", txType: "loan_creation", status: "posted", periodId: 11,
    }).returning().all()[0];
    state.db.insert(schema.transactionLines).values([
      { transactionId: loan.id, accountId: 2, debit: 60_500, credit: 0 },
      { transactionId: loan.id, accountId: 1, debit: 0, credit: 60_500, cashFlowClass: "investing" },
    ]).run();
    const batchId = await createBatch();
    const response = await app.inject({ method: "POST", url: `/api/transaction-batches/${batchId}/post`, payload: { reverseTransactionIds: [loan.id] } });
    expect(response.statusCode).toBe(409);
    expect(txRow(loan.id).status).toBe("posted");
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
