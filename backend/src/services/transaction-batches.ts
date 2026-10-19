import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../db/client";
import {
  accounts,
  attachments,
  auditLogs,
  salaryPeriods,
  storageDeletionOutbox,
  transactionBatches,
  transactionCategoryAllocations,
  transactionLines,
  transactionTags,
  transactions,
} from "../db/schema";
import { invalidateOnTransactionMutation } from "../cache/invalidation";
import { bumpFinancialRevisionSync } from "./financial-revision";
import { prepareJournalEntry, type CreateJournalEntryInput } from "./ledger";
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
};

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

/**
 * Post a batch's drafts. Every draft is validated first; the valid ones post in one commit. A
 * closed period a draft falls in is reopened inside that commit and closed again once the drafts
 * are in, with both steps in the audit log, so a backfill never leaves a period open by accident.
 */
export async function postBatchDrafts(batchId: number, transactionIds?: number[]): Promise<PostBatchResult> {
  const [batch] = await db.select().from(transactionBatches).where(eq(transactionBatches.id, batchId)).limit(1);
  if (!batch) throw new TransactionMutationError("Batch not found", 404);
  if (batch.status === "discarded") throw new TransactionMutationError("This batch was discarded", 409);

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
    return { posted: [], failed: [], reopenedPeriodIds: [], batchStatus: batch.status };
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
    return { posted: [], failed, reopenedPeriodIds: [], batchStatus: batch.status };
  }

  const now = Date.now();
  const result = db.transaction((tx) => {
    const touchedPeriodIds = [...new Set(ready.map((item) => item.periodId).filter((id): id is number => id != null))];
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
    return { reopened, batchStatus };
  });

  await invalidateOnTransactionMutation({
    transactionId: ready[0].id,
    affectedAccountIds: [...new Set(ready.flatMap((item) => item.accountIds))],
    affectedPeriodIds: [...new Set(ready.map((item) => item.periodId).filter((id): id is number => id != null))],
    revisionBumped: true,
  });

  return { posted: ready.map((item) => item.id), failed, reopenedPeriodIds: result.reopened, batchStatus: result.batchStatus };
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
