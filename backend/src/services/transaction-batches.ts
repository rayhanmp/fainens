import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import { db } from "../db/client";
import {
  accounts,
  attachments,
  auditLogs,
  reconciliationItems,
  reconciliationSessions,
  salaryPeriods,
  storageDeletionOutbox,
  transactionBatches,
  transactionCategoryAllocations,
  transactionLines,
  transactionTags,
  transactions,
} from "../db/schema";
import { invalidateOnTransactionMutation } from "../cache/invalidation";
import { buildBalanceAdjustmentLines } from "./balance-adjustments";
import { bumpFinancialRevisionSync } from "./financial-revision";
import {
  computeAccountBalance,
  computeAccountBalanceAsOf,
  getOrCreateBalanceAdjustmentEquityAccount,
  insertPreparedJournalEntrySync,
  prepareJournalEntry,
  type CreateJournalEntryInput,
  type PreparedJournalEntry,
} from "./ledger";
import { periodContainsDate, type PeriodState } from "./period-locking";
import { TransactionMutationError } from "./transaction-mutations";

/**
 * Rebuild a draft from scratch: header, lines, tags and allocations are replaced with what the
 * input describes, the way a fresh save would create them, while the id, batch and attachments
 * stay. This is how the full entry form edits a draft without re-implementing journal building.
 */
export async function replaceDraft(transactionId: number, input: CreateJournalEntryInput): Promise<{ transactionId: number }> {
  const [current] = await db.select().from(transactions).where(eq(transactions.id, transactionId)).limit(1);
  if (!current) throw new TransactionMutationError("Transaction not found", 404);
  if (current.status !== "draft") throw new TransactionMutationError("Only a draft can be rebuilt; posted journals are corrected by reversal", 409);

  const prepared = await prepareJournalEntry({ ...input, status: "draft", batchId: current.batchId ?? null }, db);
  const { date, dueDate, description, reference, notes, place, txType, periodId, categoryId, originLat, originLng, originName, destLat, destLng, destName, distanceKm } = prepared.transactionValues as Record<string, unknown>;

  db.transaction((tx) => {
    const fresh = tx.select({ status: transactions.status }).from(transactions).where(eq(transactions.id, transactionId)).limit(1).all()[0];
    if (!fresh || fresh.status !== "draft") throw new TransactionMutationError("Draft changed while editing; reload it and retry", 409);
    tx.update(transactions)
      .set({ date, dueDate, description, reference, notes, place, txType, periodId, categoryId, originLat, originLng, originName, destLat, destLng, destName, distanceKm })
      .where(eq(transactions.id, transactionId))
      .run();
    tx.delete(transactionLines).where(eq(transactionLines.transactionId, transactionId)).run();
    tx.insert(transactionLines).values(prepared.validatedLines.map((line) => ({
      transactionId,
      accountId: line.accountId,
      debit: line.debit,
      credit: line.credit,
      description: line.description ?? null,
      cashFlowClass: line.cashFlowClass ?? null,
    }))).run();
    tx.delete(transactionTags).where(eq(transactionTags.transactionId, transactionId)).run();
    if (prepared.tagIds.length > 0) {
      tx.insert(transactionTags).values(prepared.tagIds.map((tagId) => ({ transactionId, tagId }))).run();
    }
    tx.delete(transactionCategoryAllocations).where(eq(transactionCategoryAllocations.transactionId, transactionId)).run();
    if (prepared.categoryAllocations.length > 0) {
      tx.insert(transactionCategoryAllocations).values(prepared.categoryAllocations.map((allocation) => ({
        transactionId, categoryId: allocation.categoryId, amount: allocation.amount,
      }))).run();
    }
    tx.insert(auditLogs).values({
      entityType: "transaction",
      entityId: transactionId,
      action: "update",
      beforeSnapshot: Buffer.from(JSON.stringify(current)),
      afterSnapshot: Buffer.from(JSON.stringify({ transaction: prepared.transactionValues, lines: prepared.validatedLines, tagIds: prepared.tagIds, source: "draft_rebuild" })),
    }).run();
    bumpFinancialRevisionSync(tx);
  });

  await invalidateOnTransactionMutation({ transactionId, affectedAccountIds: prepared.accountIds, affectedPeriodIds: [], revisionBumped: true });
  return { transactionId };
}

export type BatchSummary = {
  id: number;
  name: string;
  source: string;
  status: string;
  note: string | null;
  createdAt: number;
  postedAt: number | null;
  draftCount: number;
  postedCount: number;
};

export type BatchDetail = BatchSummary & {
  /** What posting the remaining drafts would do to each asset account's balance. */
  accountImpact: Array<{ accountId: number; accountName: string; deltaCents: number; draftCount: number }>;
  /** Periods the remaining drafts fall in, with whether posting would have to reopen them. */
  periods: Array<{ periodId: number | null; periodName: string | null; status: string | null; draftCount: number }>;
  /** Earliest and latest draft dates, ms since epoch. */
  dateRange: { from: number; to: number } | null;
};

export type PostBatchResult = {
  posted: number[];
  failed: Array<{ id: number; error: string }>;
  /** Closed periods that were reopened for the posting and closed again afterwards. */
  reopenedPeriodIds: number[];
  batchStatus: string;
  /** Balance adjustments posted with the batch, one per settled account. */
  settlements: Array<{ accountId: number; difference: number; transactionId: number | null }>;
};

/**
 * How an account's balance is squared up when a backfill posts:
 * - keep_current: the account's balance today was already right (an opening balance or an earlier
 *   reconciliation absorbed the missing months), so an adjustment of the opposite amount is posted
 *   on `asOfDate`, leaving every balance after that date unchanged.
 * - match: the balance on `asOfDate` must equal `actualBalance` (a statement's closing balance);
 *   the gap after posting is adjusted on that date.
 * Accounts without a settlement simply move by what the batch adds.
 */
export type BatchSettlementInput =
  | { accountId: number; mode: "keep_current"; asOfDate: number }
  | { accountId: number; mode: "match"; asOfDate: number; actualBalance: number };

export type BatchSettlementAccount = {
  accountId: number;
  accountName: string;
  accountType: "asset" | "liability";
  /** Posted balance today. */
  currentBalance: number;
  /** What posting every remaining draft adds to the balance (positive raises it). */
  batchDelta: number;
  draftCount: number;
  firstDraftDate: number;
  lastDraftDate: number;
  /** Earlier opening balances and adjustments on this account, newest first: where a gap may have been absorbed. */
  adjustments: Array<{ sessionId: number; kind: string; asOfDate: number; difference: number }>;
};

type BalanceAccountType = "asset" | "liability";
const balanceTerms = (type: BalanceAccountType, debit: number, credit: number) => (type === "asset" ? debit - credit : credit - debit);

const toMs = (value: Date | number | null | undefined) => value == null ? null : value instanceof Date ? value.getTime() : Number(value);

function mapBatch(row: typeof transactionBatches.$inferSelect, counts: { draftCount: number; postedCount: number }): BatchSummary {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    status: row.status,
    note: row.note ?? null,
    createdAt: toMs(row.createdAt) ?? 0,
    postedAt: toMs(row.postedAt),
    ...counts,
  };
}

async function countsByBatch(batchIds: number[]): Promise<Map<number, { draftCount: number; postedCount: number }>> {
  const counts = new Map<number, { draftCount: number; postedCount: number }>();
  if (batchIds.length === 0) return counts;
  const rows = await db
    .select({ batchId: transactions.batchId, status: transactions.status, count: sql<number>`count(*)` })
    .from(transactions)
    .where(inArray(transactions.batchId, batchIds))
    .groupBy(transactions.batchId, transactions.status);
  for (const row of rows) {
    const current = counts.get(Number(row.batchId)) ?? { draftCount: 0, postedCount: 0 };
    if (row.status === "draft") current.draftCount += Number(row.count);
    else if (row.status === "posted") current.postedCount += Number(row.count);
    counts.set(Number(row.batchId), current);
  }
  return counts;
}

export async function createBatch(input: { name: string; source?: string; note?: string | null }): Promise<BatchSummary> {
  const name = input.name.trim();
  if (!name) throw new TransactionMutationError("Batch name is required", 400);
  const [row] = await db.insert(transactionBatches).values({
    name,
    source: input.source?.trim() || "backfill",
    note: input.note?.trim() || null,
  }).returning();
  if (!row) throw new Error("Failed to create batch");
  return mapBatch(row, { draftCount: 0, postedCount: 0 });
}

export async function listBatches(): Promise<BatchSummary[]> {
  const rows = await db.select().from(transactionBatches).orderBy(desc(transactionBatches.createdAt), desc(transactionBatches.id));
  const counts = await countsByBatch(rows.map((row) => row.id));
  return rows.map((row) => mapBatch(row, counts.get(row.id) ?? { draftCount: 0, postedCount: 0 }));
}

export async function getBatch(batchId: number): Promise<BatchDetail> {
  const [row] = await db.select().from(transactionBatches).where(eq(transactionBatches.id, batchId)).limit(1);
  if (!row) throw new TransactionMutationError("Batch not found", 404);
  const counts = (await countsByBatch([batchId])).get(batchId) ?? { draftCount: 0, postedCount: 0 };

  const drafts = await db
    .select({ id: transactions.id, date: transactions.date, periodId: transactions.periodId })
    .from(transactions)
    .where(and(eq(transactions.batchId, batchId), eq(transactions.status, "draft")));
  const draftIds = drafts.map((draft) => draft.id);

  const impactRows = draftIds.length === 0 ? [] : await db
    .select({
      accountId: transactionLines.accountId,
      accountName: accounts.name,
      deltaCents: sql<number>`coalesce(sum(${transactionLines.debit} - ${transactionLines.credit}), 0)`,
      draftCount: sql<number>`count(distinct ${transactionLines.transactionId})`,
    })
    .from(transactionLines)
    .innerJoin(accounts, eq(accounts.id, transactionLines.accountId))
    .where(and(inArray(transactionLines.transactionId, draftIds), eq(accounts.type, "asset")))
    .groupBy(transactionLines.accountId, accounts.name);

  const periods = await db
    .select({ id: salaryPeriods.id, name: salaryPeriods.name, startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate, status: salaryPeriods.status })
    .from(salaryPeriods);
  const periodCounts = new Map<number | null, number>();
  for (const draft of drafts) {
    const dateMs = toMs(draft.date) ?? 0;
    const period = periods.find((candidate) => periodContainsDate(candidate as PeriodState, dateMs));
    const key = period?.id ?? null;
    periodCounts.set(key, (periodCounts.get(key) ?? 0) + 1);
  }
  const dates = drafts.map((draft) => toMs(draft.date) ?? 0);

  return {
    ...mapBatch(row, counts),
    accountImpact: impactRows.map((impact) => ({
      accountId: Number(impact.accountId),
      accountName: String(impact.accountName),
      deltaCents: Number(impact.deltaCents),
      draftCount: Number(impact.draftCount),
    })),
    periods: [...periodCounts.entries()].map(([periodId, draftCount]) => {
      const period = periodId == null ? null : periods.find((candidate) => candidate.id === periodId) ?? null;
      return { periodId, periodName: period?.name ?? null, status: period?.status ?? null, draftCount };
    }),
    dateRange: dates.length ? { from: Math.min(...dates), to: Math.max(...dates) } : null,
  };
}

async function batchDraftLines(batchId: number, accountId?: number) {
  return db
    .select({
      transactionId: transactionLines.transactionId,
      accountId: transactionLines.accountId,
      debit: transactionLines.debit,
      credit: transactionLines.credit,
      date: transactions.date,
      accountName: accounts.name,
      accountType: accounts.type,
    })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactions.id, transactionLines.transactionId))
    .innerJoin(accounts, eq(accounts.id, transactionLines.accountId))
    .where(and(
      eq(transactions.batchId, batchId),
      eq(transactions.status, "draft"),
      inArray(accounts.type, ["asset", "liability"]),
      isNull(accounts.systemKey),
      ...(accountId != null ? [eq(transactionLines.accountId, accountId)] : []),
    ));
}

/** Per account the batch touches: today's balance, what posting adds, and the earlier adjustments that may explain a gap. */
export async function getBatchSettlement(batchId: number): Promise<{ accounts: BatchSettlementAccount[] }> {
  const [batch] = await db.select({ id: transactionBatches.id }).from(transactionBatches).where(eq(transactionBatches.id, batchId)).limit(1);
  if (!batch) throw new TransactionMutationError("Batch not found", 404);

  const lines = await batchDraftLines(batchId);
  const byAccount = new Map<number, { name: string; type: BalanceAccountType; delta: number; drafts: Set<number>; first: number; last: number }>();
  for (const line of lines) {
    const type = line.accountType as BalanceAccountType;
    const dateMs = toMs(line.date) ?? 0;
    const current = byAccount.get(line.accountId) ?? { name: line.accountName, type, delta: 0, drafts: new Set<number>(), first: dateMs, last: dateMs };
    current.delta += balanceTerms(type, line.debit, line.credit);
    current.drafts.add(line.transactionId);
    current.first = Math.min(current.first, dateMs);
    current.last = Math.max(current.last, dateMs);
    byAccount.set(line.accountId, current);
  }
  const accountIds = [...byAccount.keys()];
  const adjustmentRows = accountIds.length === 0 ? [] : await db
    .select({
      sessionId: reconciliationSessions.id,
      kind: reconciliationSessions.kind,
      asOfDate: reconciliationSessions.asOfDate,
      accountId: reconciliationItems.accountId,
      difference: reconciliationItems.difference,
    })
    .from(reconciliationItems)
    .innerJoin(reconciliationSessions, eq(reconciliationSessions.id, reconciliationItems.sessionId))
    .where(and(
      inArray(reconciliationItems.accountId, accountIds),
      eq(reconciliationSessions.lifecycleStatus, "active"),
      inArray(reconciliationSessions.kind, ["opening_balance", "adjustment", "recovery"]),
      ne(reconciliationItems.difference, 0),
    ))
    .orderBy(desc(reconciliationSessions.asOfDate));

  const result: BatchSettlementAccount[] = [];
  for (const [accountId, item] of byAccount) {
    result.push({
      accountId,
      accountName: item.name,
      accountType: item.type,
      currentBalance: await computeAccountBalance(accountId, db),
      batchDelta: item.delta,
      draftCount: item.drafts.size,
      firstDraftDate: item.first,
      lastDraftDate: item.last,
      adjustments: adjustmentRows
        .filter((row) => row.accountId === accountId)
        .slice(0, 5)
        .map((row) => ({ sessionId: row.sessionId, kind: row.kind, asOfDate: toMs(row.asOfDate) ?? 0, difference: row.difference })),
    });
  }
  result.sort((a, b) => a.accountName.localeCompare(b.accountName));
  return { accounts: result };
}

/** The balance on a date before posting, and what the batch's drafts on or before that date add to it. */
export async function getBatchBalanceAt(batchId: number, accountId: number, asOfDate: number): Promise<{ postedBalance: number; draftDelta: number }> {
  const [batch] = await db.select({ id: transactionBatches.id }).from(transactionBatches).where(eq(transactionBatches.id, batchId)).limit(1);
  if (!batch) throw new TransactionMutationError("Batch not found", 404);
  const [account] = await db.select({ type: accounts.type }).from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!account) throw new TransactionMutationError("Account not found", 404);
  if (account.type !== "asset" && account.type !== "liability") throw new TransactionMutationError("Only asset and liability balances can be settled", 400);
  const lines = await batchDraftLines(batchId, accountId);
  const draftDelta = lines
    .filter((line) => (toMs(line.date) ?? 0) <= asOfDate)
    .reduce((sum, line) => sum + balanceTerms(account.type as BalanceAccountType, line.debit, line.credit), 0);
  return { postedBalance: await computeAccountBalanceAsOf(accountId, asOfDate, db), draftDelta };
}

function postedBalanceAsOfSync(tx: any, accountId: number, type: BalanceAccountType, asOfDate: number): number {
  const sums = tx
    .select({
      debit: sql<number>`coalesce(sum(${transactionLines.debit}), 0)`,
      credit: sql<number>`coalesce(sum(${transactionLines.credit}), 0)`,
    })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
    .where(and(
      eq(transactionLines.accountId, accountId),
      sql`${transactions.date} <= ${asOfDate}`,
      sql`${transactions.status} <> 'draft'`,
    ))
    .all()[0];
  return balanceTerms(type, Number(sums?.debit ?? 0), Number(sums?.credit ?? 0));
}

type PreparedSettlement = {
  input: BatchSettlementInput;
  accountName: string;
  accountType: BalanceAccountType;
  /** Balance on asOfDate once the drafts are posted, before the adjustment. */
  expectedBalance: number;
  difference: number;
  journal: PreparedJournalEntry | null;
};

function validateSettlements(settlements: BatchSettlementInput[]): void {
  const seen = new Set<number>();
  const now = Date.now();
  for (const settlement of settlements) {
    if (!Number.isInteger(settlement.accountId) || settlement.accountId <= 0) throw new TransactionMutationError("Settlement accountId must be a positive integer", 400);
    if (seen.has(settlement.accountId)) throw new TransactionMutationError("Each account can be settled once per posting", 400);
    seen.add(settlement.accountId);
    if (settlement.mode !== "keep_current" && settlement.mode !== "match") throw new TransactionMutationError("Unknown settlement mode", 400);
    if (!Number.isSafeInteger(settlement.asOfDate) || settlement.asOfDate < 0 || settlement.asOfDate > now) {
      throw new TransactionMutationError("Settlement date must be today or earlier", 400);
    }
    if (settlement.mode === "match" && !Number.isSafeInteger(settlement.actualBalance)) {
      throw new TransactionMutationError("Settlement balance must be a whole-rupiah amount", 400);
    }
  }
}

/**
 * Work out each settlement's adjustment against the drafts about to post, and prepare its journal.
 * The journal is prepared like a draft so a closed period does not refuse it here; the posting
 * commit reopens that period alongside the drafts' and inserts it as posted.
 */
async function prepareSettlements(
  batch: { id: number; name: string },
  settlements: BatchSettlementInput[],
  readyLines: Array<{ accountId: number; debit: number; credit: number; dateMs: number }>,
): Promise<PreparedSettlement[]> {
  if (settlements.length === 0) return [];
  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name, type: accounts.type, liquidityClass: accounts.liquidityClass, isActive: accounts.isActive, systemKey: accounts.systemKey })
    .from(accounts)
    .where(inArray(accounts.id, settlements.map((settlement) => settlement.accountId)));
  const equity = await getOrCreateBalanceAdjustmentEquityAccount(db);
  const prepared: PreparedSettlement[] = [];
  for (const settlement of settlements) {
    const account = accountRows.find((row) => row.id === settlement.accountId);
    if (!account) throw new TransactionMutationError(`Account ${settlement.accountId} not found`, 404);
    if (!account.isActive || account.systemKey || (account.type !== "asset" && account.type !== "liability")) {
      throw new TransactionMutationError(`${account.name} cannot be settled; only active asset and liability accounts can`, 400);
    }
    const type = account.type as BalanceAccountType;
    const accountLines = readyLines.filter((line) => line.accountId === account.id);
    const draftsUpToDate = accountLines
      .filter((line) => line.dateMs <= settlement.asOfDate)
      .reduce((sum, line) => sum + balanceTerms(type, line.debit, line.credit), 0);
    const expectedBalance = await computeAccountBalanceAsOf(account.id, settlement.asOfDate, db) + draftsUpToDate;
    const difference = settlement.mode === "keep_current"
      ? -accountLines.reduce((sum, line) => sum + balanceTerms(type, line.debit, line.credit), 0)
      : settlement.actualBalance - expectedBalance;
    let journal: PreparedJournalEntry | null = null;
    if (difference !== 0) {
      const draftLike = await prepareJournalEntry({
        date: settlement.asOfDate,
        description: `Backfill settlement · ${account.name}`,
        notes: settlement.mode === "keep_current"
          ? `Keeps ${account.name}'s balance after this date unchanged by batch "${batch.name}"`
          : `Matches ${account.name} to ${settlement.actualBalance} after batch "${batch.name}"`,
        txType: "balance_adjustment",
        lines: buildBalanceAdjustmentLines([{
          accountId: account.id,
          accountName: account.name,
          accountType: type,
          liquidityClass: account.liquidityClass,
          difference,
        }], equity.id),
        status: "draft",
        batchId: batch.id,
      }, db);
      journal = { ...draftLike, transactionValues: { ...draftLike.transactionValues, status: "posted" } };
    }
    prepared.push({ input: settlement, accountName: account.name, accountType: type, expectedBalance, difference, journal });
  }
  return prepared;
}

/**
 * Post a batch's drafts. Every draft is validated first; the valid ones post in one commit. A
 * closed period a draft falls in is reopened inside that commit and closed again once the drafts
 * are in, with both steps in the audit log, so a backfill never leaves a period open by accident.
 */
export async function postBatchDrafts(batchId: number, transactionIds?: number[], settlements: BatchSettlementInput[] = []): Promise<PostBatchResult> {
  const [batch] = await db.select().from(transactionBatches).where(eq(transactionBatches.id, batchId)).limit(1);
  if (!batch) throw new TransactionMutationError("Batch not found", 404);
  if (batch.status === "discarded") throw new TransactionMutationError("This batch was discarded", 409);
  validateSettlements(settlements);

  const requested = transactionIds == null ? null : [...new Set(transactionIds)];
  if (requested?.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new TransactionMutationError("transactionIds must contain positive integers", 400);
  }
  const drafts = await db
    .select()
    .from(transactions)
    .where(and(
      eq(transactions.batchId, batchId),
      eq(transactions.status, "draft"),
      ...(requested ? [inArray(transactions.id, requested)] : []),
    ));
  if (requested && drafts.length !== requested.length) {
    const found = new Set(drafts.map((draft) => draft.id));
    throw new TransactionMutationError(`Not a draft in this batch: ${requested.filter((id) => !found.has(id)).join(", ")}`, 404);
  }
  if (drafts.length === 0) {
    return { posted: [], failed: [], reopenedPeriodIds: [], batchStatus: batch.status, settlements: [] };
  }

  const draftIds = drafts.map((draft) => draft.id);
  const lines = await db.select().from(transactionLines).where(inArray(transactionLines.transactionId, draftIds));
  const linesByTransaction = new Map<number, typeof lines>();
  for (const line of lines) {
    const list = linesByTransaction.get(line.transactionId) ?? [];
    list.push(line);
    linesByTransaction.set(line.transactionId, list);
  }
  const accountIds = [...new Set(lines.map((line) => line.accountId))];
  const accountRows = accountIds.length === 0 ? [] : await db
    .select({ id: accounts.id, isActive: accounts.isActive })
    .from(accounts)
    .where(inArray(accounts.id, accountIds));
  const accountById = new Map(accountRows.map((account) => [account.id, account]));
  const periods = await db
    .select({ id: salaryPeriods.id, name: salaryPeriods.name, startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate, status: salaryPeriods.status })
    .from(salaryPeriods);

  const failed: PostBatchResult["failed"] = [];
  const ready: Array<{ id: number; periodId: number | null; accountIds: number[] }> = [];
  for (const draft of drafts) {
    const draftLines = linesByTransaction.get(draft.id) ?? [];
    const problems: string[] = [];
    if (draftLines.length < 2) problems.push("needs at least two journal lines");
    const totalDebit = draftLines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredit = draftLines.reduce((sum, line) => sum + line.credit, 0);
    if (totalDebit !== totalCredit) problems.push("debits and credits do not balance");
    if (totalDebit === 0) problems.push("amount is zero");
    for (const line of draftLines) {
      const account = accountById.get(line.accountId);
      if (!account) problems.push(`account ${line.accountId} does not exist`);
      else if (!account.isActive) problems.push(`account ${line.accountId} is inactive`);
    }
    if (!draft.description || !String(draft.description).trim()) problems.push("description is empty");
    const dateMs = toMs(draft.date) ?? NaN;
    if (!Number.isFinite(dateMs)) problems.push("date is invalid");
    if (problems.length > 0) {
      failed.push({ id: draft.id, error: problems.join("; ") });
      continue;
    }
    const period = periods.find((candidate) => periodContainsDate(candidate as PeriodState, dateMs));
    ready.push({ id: draft.id, periodId: period?.id ?? null, accountIds: [...new Set(draftLines.map((line) => line.accountId))] });
  }

  if (ready.length === 0) {
    return { posted: [], failed, reopenedPeriodIds: [], batchStatus: batch.status, settlements: [] };
  }

  const draftDateById = new Map(drafts.map((draft) => [draft.id, toMs(draft.date) ?? 0]));
  const readyLines = ready.flatMap((item) => (linesByTransaction.get(item.id) ?? []).map((line) => ({
    accountId: line.accountId,
    debit: line.debit,
    credit: line.credit,
    dateMs: draftDateById.get(item.id) ?? 0,
  })));
  const preparedSettlements = await prepareSettlements(batch, settlements, readyLines);

  const now = Date.now();
  const result = db.transaction((tx) => {
    const touchedPeriodIds = [...new Set([
      ...ready.map((item) => item.periodId),
      ...preparedSettlements.map((settlement) => settlement.journal?.periodId ?? null),
    ].filter((id): id is number => id != null))];
    const periodRows = touchedPeriodIds.length === 0 ? [] : tx
      .select().from(salaryPeriods).where(inArray(salaryPeriods.id, touchedPeriodIds)).all();
    const reopened: number[] = [];
    for (const period of periodRows) {
      if (period.status !== "closed") continue;
      const updated = tx.update(salaryPeriods)
        .set({ status: "open", reopenedAt: new Date(now) })
        .where(and(eq(salaryPeriods.id, period.id), eq(salaryPeriods.status, "closed")))
        .returning().all()[0];
      if (!updated) throw new TransactionMutationError("Period changed while posting; retry", 409);
      tx.insert(auditLogs).values({
        entityType: "salary_period",
        entityId: period.id,
        action: "reopen",
        beforeSnapshot: Buffer.from(JSON.stringify(period)),
        afterSnapshot: Buffer.from(JSON.stringify({ ...updated, reason: `batch ${batchId} posting` })),
      }).run();
      reopened.push(period.id);
    }

    for (const item of ready) {
      const fresh = tx.select().from(transactions).where(eq(transactions.id, item.id)).limit(1).all()[0];
      if (!fresh || fresh.status !== "draft") throw new TransactionMutationError(`Draft ${item.id} changed while posting; retry`, 409);
      tx.update(transactions)
        .set({ status: "posted", periodId: item.periodId })
        .where(and(eq(transactions.id, item.id), eq(transactions.status, "draft")))
        .run();
      tx.insert(auditLogs).values({
        entityType: "transaction",
        entityId: item.id,
        action: "post",
        beforeSnapshot: Buffer.from(JSON.stringify(fresh)),
        afterSnapshot: Buffer.from(JSON.stringify({ ...fresh, status: "posted", periodId: item.periodId, batchId })),
      }).run();
    }

    const settled: PostBatchResult["settlements"] = [];
    for (const settlement of preparedSettlements) {
      // The drafts are in now, so the posted balance on the date must be exactly what was planned.
      const balance = postedBalanceAsOfSync(tx, settlement.input.accountId, settlement.accountType, settlement.input.asOfDate);
      if (balance !== settlement.expectedBalance) {
        throw new TransactionMutationError(`${settlement.accountName}'s balance changed while posting; review the settlement and retry`, 409);
      }
      const transactionId = settlement.journal ? insertPreparedJournalEntrySync(tx, settlement.journal) : null;
      const session = tx.insert(reconciliationSessions).values({
        asOfDate: new Date(settlement.input.asOfDate),
        status: transactionId == null ? "reconciled" : "adjusted",
        kind: transactionId == null ? "control" : "adjustment",
        note: `Backfill batch "${batch.name}": ${settlement.input.mode === "keep_current" ? "kept today's balance" : "matched a statement balance"}`,
      }).returning().all()[0];
      if (!session) throw new Error("Failed to record the settlement");
      const item = {
        sessionId: session.id,
        accountId: settlement.input.accountId,
        ledgerBalance: settlement.expectedBalance,
        actualBalance: settlement.expectedBalance + settlement.difference,
        difference: settlement.difference,
        status: transactionId == null ? "matched" : "adjusted",
        correctionTransactionId: transactionId,
      };
      tx.insert(reconciliationItems).values(item).run();
      tx.insert(auditLogs).values({
        entityType: "reconciliation_session",
        entityId: session.id,
        action: "create",
        afterSnapshot: Buffer.from(JSON.stringify({ session, item, transactionId, batchId, mode: settlement.input.mode })),
      }).run();
      settled.push({ accountId: settlement.input.accountId, difference: settlement.difference, transactionId });
    }

    for (const periodId of reopened) {
      const period = tx.select().from(salaryPeriods).where(eq(salaryPeriods.id, periodId)).limit(1).all()[0];
      const updated = tx.update(salaryPeriods)
        .set({ status: "closed", closedAt: new Date(now), reopenedAt: null })
        .where(and(eq(salaryPeriods.id, periodId), eq(salaryPeriods.status, "open")))
        .returning().all()[0];
      if (!updated) throw new TransactionMutationError("Period changed while posting; retry", 409);
      tx.insert(auditLogs).values({
        entityType: "salary_period",
        entityId: periodId,
        action: "close",
        beforeSnapshot: Buffer.from(JSON.stringify(period)),
        afterSnapshot: Buffer.from(JSON.stringify({ ...updated, reason: `batch ${batchId} posted` })),
      }).run();
    }

    const remaining = tx
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(and(eq(transactions.batchId, batchId), eq(transactions.status, "draft")))
      .all()[0];
    const batchStatus = Number(remaining?.count ?? 0) === 0 ? "posted" : "open";
    tx.update(transactionBatches)
      .set({ status: batchStatus, postedAt: batchStatus === "posted" ? new Date(now) : null })
      .where(eq(transactionBatches.id, batchId))
      .run();
    bumpFinancialRevisionSync(tx);
    return { reopened, batchStatus, settled, touchedPeriodIds };
  });

  await invalidateOnTransactionMutation({
    transactionId: ready[0].id,
    affectedAccountIds: [...new Set([
      ...ready.flatMap((item) => item.accountIds),
      ...preparedSettlements.flatMap((settlement) => settlement.journal?.accountIds ?? []),
    ])],
    affectedPeriodIds: result.touchedPeriodIds,
    revisionBumped: true,
  });

  return {
    posted: ready.map((item) => item.id),
    failed,
    reopenedPeriodIds: result.reopened,
    batchStatus: result.batchStatus,
    settlements: result.settled,
  };
}

/** Delete every remaining draft in the batch and mark it discarded. Posted rows keep their history. */
export async function discardBatch(batchId: number): Promise<{ deletedCount: number; outboxIds: number[] }> {
  const [batch] = await db.select().from(transactionBatches).where(eq(transactionBatches.id, batchId)).limit(1);
  if (!batch) throw new TransactionMutationError("Batch not found", 404);

  const result = db.transaction((tx) => {
    const drafts = tx
      .select({ id: transactions.id, periodId: transactions.periodId })
      .from(transactions)
      .where(and(eq(transactions.batchId, batchId), eq(transactions.status, "draft")))
      .all();
    const ids = drafts.map((draft) => draft.id);
    let outboxIds: number[] = [];
    let affectedAccountIds: number[] = [];
    if (ids.length > 0) {
      const lines = tx.select({ accountId: transactionLines.accountId }).from(transactionLines)
        .where(inArray(transactionLines.transactionId, ids)).all();
      affectedAccountIds = [...new Set(lines.map((line) => line.accountId))];
      const attachmentRows = tx.select().from(attachments).where(inArray(attachments.transactionId, ids)).all();
      outboxIds = attachmentRows.length === 0 ? [] : tx
        .insert(storageDeletionOutbox)
        .values(attachmentRows.map((attachment) => ({ r2Key: attachment.r2Key, entityType: "attachment", entityId: attachment.id })))
        .returning({ id: storageDeletionOutbox.id })
        .all()
        .map((row) => row.id);
      tx.delete(transactionTags).where(inArray(transactionTags.transactionId, ids)).run();
      tx.delete(transactionCategoryAllocations).where(inArray(transactionCategoryAllocations.transactionId, ids)).run();
      tx.delete(attachments).where(inArray(attachments.transactionId, ids)).run();
      tx.delete(transactionLines).where(inArray(transactionLines.transactionId, ids)).run();
      tx.delete(transactions).where(inArray(transactions.id, ids)).run();
      tx.insert(auditLogs).values({
        entityType: "transaction_batch",
        entityId: batchId,
        action: "discard",
        beforeSnapshot: Buffer.from(JSON.stringify({ draftIds: ids })),
      }).run();
    }
    tx.update(transactionBatches).set({ status: "discarded" }).where(eq(transactionBatches.id, batchId)).run();
    bumpFinancialRevisionSync(tx);
    return { deletedCount: ids.length, outboxIds, affectedAccountIds, firstId: ids[0] };
  });

  if (result.deletedCount > 0) {
    await invalidateOnTransactionMutation({
      transactionId: result.firstId!,
      affectedAccountIds: result.affectedAccountIds,
      affectedPeriodIds: [],
      revisionBumped: true,
    });
  }
  return { deletedCount: result.deletedCount, outboxIds: result.outboxIds };
}
