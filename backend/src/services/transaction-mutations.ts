import { assertNotReallocated } from "./transaction-reallocations";
import { and, eq, inArray, or, sql } from "drizzle-orm";

import { invalidateOnTransactionMutation } from "../cache";
import { db } from "../db/client";
import {
  accounts,
  attachments,
  auditLogs,
  categories,
  loanPayments,
  loans,
  paylaterInstallments,
  reimbursementClaimSources,
  reimbursementClaims,
  reimbursementReceipts,
  salaryPeriods,
  storageDeletionOutbox,
  tags,
  transactionCategoryAllocations,
  transactionLines,
  transactions,
  transactionTags,
  wishlist,
} from "../db/schema";
import { validateJournalLines, type ValidatedJournalLine } from "./journal-validation";
import { getIntrinsicTransactionProtectionReasons, isGenericallyReversibleType } from "./transaction-mutation-policy";
import { getOrCreateAutoExpenseAccount, getOrCreateAutoIncomeAccount } from "./ledger";
import { bumpFinancialRevisionSync } from "./financial-revision";
import { assertJournalPeriodOpen, findPeriodForDate, periodContainsDate } from "./period-locking";

export class TransactionMutationError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = "TransactionMutationError";
  }
}

function auditSnapshot(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

function mutationFingerprint(rows: unknown): string {
  return JSON.stringify(rows);
}

function toMs(value: Date | number): number {
  return value instanceof Date ? value.getTime() : Number(value);
}

export async function findPeriodIdForDate(dateMs: number): Promise<number | null> {
  return (await findPeriodForDate(dateMs))?.id ?? null;
}

function findPeriodInCandidates(
  dateMs: number,
  candidates: Array<{ id: number; startDate: number; endDate: number; status: string }>,
): { id: number; status: string } | null {
  const containing = candidates
    .filter((period) => periodContainsDate(period, dateMs))
    .sort((a, b) => Number(b.startDate) - Number(a.startDate))[0];
  return containing ? { id: containing.id, status: containing.status } : null;
}

function assertGenericMutationAllowed(tx: any, executor: any): void {
  assertNotReallocated(tx.id, executor);
  const reasons = getIntrinsicTransactionProtectionReasons(tx);

  const incomingLink = executor
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.linkedTxId, tx.id))
    .limit(1)
    .all()[0];
  if (incomingLink) reasons.push("linked transaction chain");
  if (tx.reversalOfTxId != null) reasons.push(`reversal of transaction ${tx.reversalOfTxId}`);
  reasons.push(...workflowLinkReasons(tx, executor));

  if (reasons.length > 0) {
    throw new TransactionMutationError(
      `Transaction ${tx.id} is domain-owned (${reasons.join(", ")}); use the owning workflow to reverse or change it`,
      409,
    );
  }
}

/**
 * Checks for the generic reverse endpoint. Returns the posted child entries (such as a transfer's
 * fee) that must be reversed together with the transaction; refuses anything a workflow owns.
 */
export function assertGenericReversalAllowed(tx: any, executor: any): { childIds: number[] } {
  assertNotReallocated(tx.id, executor);
  const reasons: string[] = [];
  if (!isGenericallyReversibleType(tx.txType)) reasons.push(`type ${tx.txType}`);
  if (tx.subscriptionId != null) reasons.push("subscription occurrence");
  if (tx.reversalOfTxId != null) reasons.push(`reversal of transaction ${tx.reversalOfTxId}`);
  reasons.push(...workflowLinkReasons(tx, executor));

  const childIds: number[] = [];
  const children = executor
    .select({ id: transactions.id, txType: transactions.txType, status: transactions.status, subscriptionId: transactions.subscriptionId, reversalOfTxId: transactions.reversalOfTxId })
    .from(transactions)
    .where(eq(transactions.linkedTxId, tx.id))
    .all();
  for (const child of children) {
    if (child.status === "reversed") continue;
    const childReasons = [
      ...(isGenericallyReversibleType(child.txType) && child.subscriptionId == null && child.reversalOfTxId == null ? [] : [`linked ${child.txType} transaction ${child.id}`]),
      ...workflowLinkReasons(child, executor),
    ];
    if (child.status !== "posted" || childReasons.length > 0) reasons.push(...(childReasons.length ? childReasons : [`linked transaction ${child.id} is ${child.status}`]));
    else {
      assertNotReallocated(child.id, executor);
      childIds.push(child.id);
    }
  }

  if (reasons.length > 0) {
    throw new TransactionMutationError(
      `Transaction ${tx.id} is domain-owned (${reasons.join(", ")}); use the owning workflow to reverse or change it`,
      409,
    );
  }
  return { childIds };
}

/** Workflow records (loans, PayLater, wishlist, reimbursements) that own or reference a transaction. */
function workflowLinkReasons(tx: { id: number }, executor: any): string[] {
  const reasons: string[] = [];
  const loan = executor
    .select({ id: loans.id })
    .from(loans)
    .where(or(eq(loans.lendingTransactionId, tx.id), eq(loans.sourceTransactionId, tx.id)))
    .limit(1)
    .all()[0];
  if (loan) reasons.push(`loan ${loan.id}`);

  const loanPayment = executor
    .select({ id: loanPayments.id })
    .from(loanPayments)
    .where(eq(loanPayments.transactionId, tx.id))
    .limit(1)
    .all()[0];
  if (loanPayment) reasons.push(`loan payment ${loanPayment.id}`);

  const installment = executor
    .select({ id: paylaterInstallments.id })
    .from(paylaterInstallments)
    .where(
      or(
        eq(paylaterInstallments.recognitionTxId, tx.id),
        eq(paylaterInstallments.paidTxId, tx.id),
      ),
    )
    .limit(1)
    .all()[0];
  if (installment) reasons.push(`PayLater installment ${installment.id}`);

  const wishlistItem = executor
    .select({ id: wishlist.id })
    .from(wishlist)
    .where(eq(wishlist.fulfilledTransactionId, tx.id))
    .limit(1)
    .all()[0];
  if (wishlistItem) reasons.push(`wishlist item ${wishlistItem.id}`);

  const reimbursementSource = executor
    .select({ id: reimbursementClaimSources.id })
    .from(reimbursementClaimSources)
    .innerJoin(reimbursementClaims, eq(reimbursementClaimSources.claimId, reimbursementClaims.id))
    .where(or(
      and(eq(reimbursementClaimSources.sourceTransactionId, tx.id), inArray(reimbursementClaims.status, ["approved", "partially_paid", "settled", "written_off"])),
      eq(reimbursementClaimSources.recognitionTransactionId, tx.id),
    ))
    .limit(1)
    .all()[0];
  if (reimbursementSource) reasons.push(`reimbursement claim source ${reimbursementSource.id}`);

  const reimbursementWriteoff = executor
    .select({ id: reimbursementClaims.id })
    .from(reimbursementClaims)
    .where(eq(reimbursementClaims.writeoffTransactionId, tx.id))
    .limit(1)
    .all()[0];
  if (reimbursementWriteoff) reasons.push(`reimbursement claim write-off ${reimbursementWriteoff.id}`);

  const reimbursementReceipt = executor
    .select({ id: reimbursementReceipts.id })
    .from(reimbursementReceipts)
    .where(or(
      eq(reimbursementReceipts.transactionId, tx.id),
      eq(reimbursementReceipts.reversalTransactionId, tx.id),
    ))
    .limit(1)
    .all()[0];
  if (reimbursementReceipt) reasons.push(`reimbursement receipt ${reimbursementReceipt.id}`);
  return reasons;
}

export interface UpdateTransactionInput {
  date?: string;
  description?: string;
  reference?: string | null;
  notes?: string | null;
  place?: string | null;
  txType?: string;
  categoryId?: number | null;
  categoryAllocations?: Array<{ categoryId: number; amount: number }>;
  tagIds?: number[];
  lines?: ValidatedJournalLine[];
}

export async function updateTransactionAtomically(
  transactionId: number,
  input: UpdateTransactionInput,
): Promise<Record<string, unknown>> {
  const [current] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .limit(1);
  if (!current) throw new TransactionMutationError("Transaction not found", 404);

  const currentLines = await db
    .select()
    .from(transactionLines)
    .where(eq(transactionLines.transactionId, transactionId));
  const currentTags = await db
    .select({ tagId: transactionTags.tagId })
    .from(transactionTags)
    .where(eq(transactionTags.transactionId, transactionId));
  const currentAllocations = await db
    .select({ categoryId: transactionCategoryAllocations.categoryId, amount: transactionCategoryAllocations.amount })
    .from(transactionCategoryAllocations)
    .where(eq(transactionCategoryAllocations.transactionId, transactionId));

  const currentLineFingerprint = mutationFingerprint(currentLines.map((line) => ({
    id: line.id,
    accountId: line.accountId,
    debit: line.debit,
    credit: line.credit,
    description: line.description,
    cashFlowClass: line.cashFlowClass,
  })).sort((a, b) => a.id - b.id));
  const currentTagFingerprint = mutationFingerprint(currentTags.map((tag) => tag.tagId).sort((a, b) => a - b));
  const currentAllocationFingerprint = mutationFingerprint(currentAllocations
    .map((allocation) => ({ categoryId: allocation.categoryId, amount: allocation.amount }))
    .sort((a, b) => a.categoryId - b.categoryId));
  const currentHeaderFingerprint = mutationFingerprint({
    id: current.id,
    date: toMs(current.date),
    periodId: current.periodId,
    description: current.description,
    reference: current.reference,
    notes: current.notes,
    place: current.place,
    categoryId: current.categoryId,
    txType: current.txType,
    status: current.status,
  });

  let effectiveDate = toMs(current.date);
  if (input.date !== undefined) {
    effectiveDate = new Date(input.date).getTime();
    if (!Number.isFinite(effectiveDate)) {
      throw new TransactionMutationError("Invalid transaction date", 400);
    }
  }

  if (input.description !== undefined && input.description.trim().length === 0) {
    throw new TransactionMutationError("description cannot be empty", 400);
  }
  if (input.txType !== undefined && input.txType !== current.txType) {
    throw new TransactionMutationError("Transaction type cannot be changed through the generic editor", 409);
  }

  // Descriptive edits do not change the accounting identity of a journal and
  // remain safe even for domain-owned/closed-period entries. A date/time move
  // is also safe when it remains inside the journal's already-assigned period;
  // moving it to another period changes period totals and stays protected.
  const targetPeriod = input.date === undefined ? null : await findPeriodForDate(effectiveDate);
  const targetPeriodId = targetPeriod?.id ?? null;
  const dateChangesPeriod = input.date !== undefined && targetPeriodId !== current.periodId;
  const categoryChanges = input.categoryId !== undefined && input.categoryId !== current.categoryId;
  const hasProtectedAccountingChange = dateChangesPeriod
    || (input.txType !== undefined && input.txType !== current.txType)
    || categoryChanges
    || input.categoryAllocations !== undefined
    || input.lines !== undefined;
  // A draft is outside the ledger, so it may move between periods, closed ones included; posting
  // applies the lock. A posted journal may only move into an open period.
  const periodId = input.date === undefined || !dateChangesPeriod
    ? current.periodId
    : current.status === "draft"
      ? targetPeriodId
      : await assertJournalPeriodOpen(effectiveDate, null);
  const validatedLines = input.lines === undefined ? undefined : validateJournalLines(input.lines).lines;
  const effectiveLines = validatedLines ?? currentLines;
  const lineAccountIds = [...new Set(effectiveLines.map((line) => line.accountId))];
  const lineAccounts = await db
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .where(inArray(accounts.id, lineAccountIds));
  const accountTypeById = new Map(lineAccounts.map((account) => [account.id, account.type]));
  const netExpense = effectiveLines.reduce((sum, line) =>
    accountTypeById.get(line.accountId) === "expense" ? sum + line.debit - line.credit : sum, 0);
  if (validatedLines) {
    const accountIds = [...new Set(validatedLines.map((line) => line.accountId))];
    const validAccounts = await db
      .select({ id: accounts.id, liquidityClass: accounts.liquidityClass })
      .from(accounts)
      .where(and(inArray(accounts.id, accountIds), eq(accounts.isActive, true)));
    if (validAccounts.length !== accountIds.length) {
      throw new TransactionMutationError("Every journal line must reference an active account", 400);
    }
    const liquidityByAccountId = new Map(validAccounts.map((account) => [account.id, account.liquidityClass]));
    if (validatedLines.some((line) => liquidityByAccountId.get(line.accountId) === "cash_equivalent" && line.cashFlowClass == null)) {
      throw new TransactionMutationError("Every cash-equivalent journal line requires cashFlowClass", 400);
    }
  }

  if (input.categoryId != null) {
    const [category] = await db.select({ id: categories.id }).from(categories)
      .where(eq(categories.id, input.categoryId)).limit(1);
    if (!category) throw new TransactionMutationError("Category not found", 400);
    if (netExpense === 0) {
      throw new TransactionMutationError("An expense category can only be assigned to a journal with a net expense", 400);
    }
  }

  let nextAllocations: Array<{ categoryId: number; amount: number }> | undefined;
  if (input.categoryAllocations !== undefined) {
    nextAllocations = input.categoryAllocations.map((allocation) => ({
      categoryId: Number(allocation.categoryId),
      amount: Number(allocation.amount),
    }));
    if (nextAllocations.some((allocation) => !Number.isInteger(allocation.categoryId) || allocation.categoryId <= 0 || !Number.isSafeInteger(allocation.amount) || allocation.amount === 0)) {
      throw new TransactionMutationError("categoryAllocations must contain positive category IDs and non-zero integer amounts", 400);
    }
    if (new Set(nextAllocations.map((allocation) => allocation.categoryId)).size !== nextAllocations.length) {
      throw new TransactionMutationError("A category may appear only once per journal allocation", 400);
    }
    if (nextAllocations.length > 0) {
      const validCategories = await db.select({ id: categories.id }).from(categories)
        .where(inArray(categories.id, nextAllocations.map((allocation) => allocation.categoryId)));
      if (validCategories.length !== nextAllocations.length) {
        throw new TransactionMutationError("One or more allocation categories do not exist", 400);
      }
    }
    if (nextAllocations.reduce((sum, allocation) => sum + allocation.amount, 0) !== netExpense) {
      throw new TransactionMutationError("category allocations must equal the journal's net expense amount", 400);
    }
  } else if (input.categoryId !== undefined) {
    nextAllocations = input.categoryId == null ? [] : [{ categoryId: input.categoryId, amount: netExpense }];
  } else if (input.lines !== undefined) {
    if (currentAllocations.length > 1) {
      throw new TransactionMutationError("Changing journal lines with multiple category allocations requires categoryAllocations", 400);
    }
    nextAllocations = currentAllocations.length === 1 && netExpense !== 0
      ? [{ categoryId: currentAllocations[0].categoryId, amount: netExpense }]
      : [];
  }

  const tagIds = input.tagIds === undefined ? undefined : [...new Set(input.tagIds)];
  if (tagIds?.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new TransactionMutationError("tagIds must contain positive integers", 400);
  }
  if (tagIds?.length) {
    const validTags = await db.select({ id: tags.id }).from(tags).where(inArray(tags.id, tagIds));
    if (validTags.length !== tagIds.length) {
      throw new TransactionMutationError("One or more tags do not exist", 400);
    }
  }

  const updates: Record<string, unknown> = {
    periodId,
    ...(input.date !== undefined ? { date: new Date(effectiveDate) } : {}),
    ...(input.description !== undefined ? { description: input.description.trim() } : {}),
    ...(input.reference !== undefined ? { reference: input.reference } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.place !== undefined ? { place: input.place } : {}),
    ...(input.categoryId !== undefined
      ? { categoryId: input.categoryId }
      // An explicit empty/split allocation set is authoritative. Clear the
      // legacy category fallback so reporting cannot silently reintroduce it.
      : input.categoryAllocations !== undefined ? { categoryId: null } : {}),
  };

  const after = db.transaction((tx) => {
    const fresh = tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .limit(1)
      .all()[0];
    if (!fresh) throw new TransactionMutationError("Transaction not found", 404);
    if (hasProtectedAccountingChange) assertNotReallocated(transactionId, tx);
    const freshLines = tx.select().from(transactionLines)
      .where(eq(transactionLines.transactionId, transactionId)).all();
    const freshTags = tx.select({ tagId: transactionTags.tagId })
      .from(transactionTags).where(eq(transactionTags.transactionId, transactionId)).all();
    const freshAllocations = tx.select({ categoryId: transactionCategoryAllocations.categoryId, amount: transactionCategoryAllocations.amount })
      .from(transactionCategoryAllocations).where(eq(transactionCategoryAllocations.transactionId, transactionId)).all();
    const freshHeaderFingerprint = mutationFingerprint({
      id: fresh.id,
      date: toMs(fresh.date),
      periodId: fresh.periodId,
      description: fresh.description,
      reference: fresh.reference,
      notes: fresh.notes,
      place: fresh.place,
      categoryId: fresh.categoryId,
      txType: fresh.txType,
      status: fresh.status,
    });
    if (
      freshHeaderFingerprint !== currentHeaderFingerprint
      ||
      mutationFingerprint(freshLines.map((line: any) => ({
        id: line.id,
        accountId: line.accountId,
        debit: line.debit,
        credit: line.credit,
        description: line.description,
        cashFlowClass: line.cashFlowClass,
      })).sort((a: any, b: any) => a.id - b.id)) !== currentLineFingerprint
      || mutationFingerprint(freshTags.map((tag: any) => tag.tagId).sort((a: number, b: number) => a - b)) !== currentTagFingerprint
      || mutationFingerprint(freshAllocations.map((allocation: any) => ({ categoryId: allocation.categoryId, amount: allocation.amount })).sort((a: any, b: any) => a.categoryId - b.categoryId)) !== currentAllocationFingerprint
    ) {
      throw new TransactionMutationError("Transaction changed while editing; reload it and retry", 409);
    }
    if (hasProtectedAccountingChange) assertGenericMutationAllowed(fresh, tx);

    tx.update(transactions).set(updates).where(eq(transactions.id, transactionId)).run();
    if (validatedLines !== undefined) {
      tx.delete(transactionLines).where(eq(transactionLines.transactionId, transactionId)).run();
      tx.insert(transactionLines)
        .values(validatedLines.map((line) => ({
          transactionId,
          accountId: line.accountId,
          debit: line.debit,
          credit: line.credit,
          description: line.description ?? null,
          cashFlowClass: line.cashFlowClass ?? null,
        })))
        .run();
    }
    if (tagIds !== undefined) {
      tx.delete(transactionTags).where(eq(transactionTags.transactionId, transactionId)).run();
      if (tagIds.length > 0) {
        tx.insert(transactionTags)
          .values(tagIds.map((tagId) => ({ transactionId, tagId })))
          .run();
      }
    }
    if (nextAllocations !== undefined) {
      tx.delete(transactionCategoryAllocations).where(eq(transactionCategoryAllocations.transactionId, transactionId)).run();
      if (nextAllocations.length > 0) {
        tx.insert(transactionCategoryAllocations).values(nextAllocations.map((allocation) => ({
          transactionId,
          categoryId: allocation.categoryId,
          amount: allocation.amount,
        }))).run();
      }
    }

    const updated = tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .limit(1)
      .all()[0];
    const nextLines = tx
      .select()
      .from(transactionLines)
      .where(eq(transactionLines.transactionId, transactionId))
      .all();
    const nextTags = tx
      .select({ tagId: transactionTags.tagId })
      .from(transactionTags)
      .where(eq(transactionTags.transactionId, transactionId))
      .all();
    const persistedAllocations = tx
      .select({ categoryId: transactionCategoryAllocations.categoryId, amount: transactionCategoryAllocations.amount })
      .from(transactionCategoryAllocations)
      .where(eq(transactionCategoryAllocations.transactionId, transactionId))
      .all();
    tx.insert(auditLogs).values({
      entityType: "transaction",
      entityId: transactionId,
      action: "update",
      beforeSnapshot: auditSnapshot({ transaction: fresh, lines: freshLines, tags: freshTags, categoryAllocations: freshAllocations }),
      afterSnapshot: auditSnapshot({ transaction: updated, lines: nextLines, tags: nextTags, categoryAllocations: persistedAllocations }),
    }).run();
    bumpFinancialRevisionSync(tx);
    return { ...updated, lines: nextLines, tagIds: nextTags.map((tag) => tag.tagId), categoryAllocations: persistedAllocations };
  });

  const affectedAccountIds = [...new Set([
    ...currentLines.map((line) => line.accountId),
    ...(validatedLines ?? currentLines).map((line) => line.accountId),
  ])];
  const affectedPeriodIds = [...new Set([current.periodId, periodId].filter((id): id is number => id != null))];
  await invalidateOnTransactionMutation({ transactionId, affectedAccountIds, affectedPeriodIds, revisionBumped: true });
  return after;
}

export interface DeleteTransactionsResult {
  deletedCount: number;
  affectedAccountIds: number[];
  affectedPeriodIds: number[];
  outboxIds: number[];
}

export async function deleteTransactionsAtomically(ids: number[]): Promise<DeleteTransactionsResult> {
  const requestedIds = [...new Set(ids)];
  if (requestedIds.length === 0 || requestedIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new TransactionMutationError("Transaction IDs must be positive integers", 400);
  }
  if (requestedIds.length > 100) {
    throw new TransactionMutationError("At most 100 transactions may be deleted at once", 400);
  }

  const result = db.transaction((tx) => {
    const requested = tx.select().from(transactions).where(inArray(transactions.id, requestedIds)).all();
    if (requested.length !== requestedIds.length) {
      const found = new Set(requested.map((row) => row.id));
      const missing = requestedIds.filter((id) => !found.has(id));
      throw new TransactionMutationError(`Transaction not found: ${missing.join(", ")}`, 404);
    }
    // A draft never reached the ledger, so the protections that keep posted history consistent
    // (workflow types such as salary, linked chains) do not apply to it. Deleting a draft takes its
    // linked draft children, such as a transfer's fee, along so nothing is left pointing at it.
    const draftIds = requested.filter((row) => row.status === "draft").map((row) => row.id);
    const children = draftIds.length === 0 ? [] : tx.select().from(transactions)
      .where(and(inArray(transactions.linkedTxId, draftIds), eq(transactions.status, "draft")))
      .all()
      .filter((child) => !requestedIds.includes(child.id));
    const rows = [...requested, ...children];
    const uniqueIds = rows.map((row) => row.id);
    for (const row of rows) {
      if (row.status === "draft") assertDraftDeletionAllowed(row, tx);
      else assertGenericMutationAllowed(row, tx);
    }

    const lines = tx
      .select()
      .from(transactionLines)
      .where(inArray(transactionLines.transactionId, uniqueIds))
      .all();
    const tagRows = tx
      .select()
      .from(transactionTags)
      .where(inArray(transactionTags.transactionId, uniqueIds))
      .all();
    const attachmentRows = tx
      .select()
      .from(attachments)
      .where(inArray(attachments.transactionId, uniqueIds))
      .all();

    const outboxIds = attachmentRows.length === 0 ? [] : tx
      .insert(storageDeletionOutbox)
      .values(attachmentRows.map((attachment) => ({
        r2Key: attachment.r2Key,
        entityType: "attachment",
        entityId: attachment.id,
      })))
      .returning({ id: storageDeletionOutbox.id })
      .all()
      .map((row) => row.id);

    for (const row of rows) {
      tx.insert(auditLogs).values({
        entityType: "transaction",
        entityId: row.id,
        action: "delete",
        beforeSnapshot: auditSnapshot({
          transaction: row,
          lines: lines.filter((line) => line.transactionId === row.id),
          tags: tagRows.filter((tag) => tag.transactionId === row.id),
          attachments: attachmentRows.filter((attachment) => attachment.transactionId === row.id),
        }),
      }).run();
    }

    // Foreign-key cascades remove lines, tags and attachment metadata. Explicit
    // deletes retain correctness even on legacy databases with FK enforcement off.
    tx.delete(transactionTags).where(inArray(transactionTags.transactionId, uniqueIds)).run();
    tx.delete(attachments).where(inArray(attachments.transactionId, uniqueIds)).run();
    tx.delete(transactionLines).where(inArray(transactionLines.transactionId, uniqueIds)).run();
    tx.delete(transactions).where(inArray(transactions.id, uniqueIds)).run();

    bumpFinancialRevisionSync(tx);

    return {
      deletedCount: rows.length,
      affectedAccountIds: [...new Set(lines.map((line) => line.accountId))],
      affectedPeriodIds: [...new Set(rows.map((row) => row.periodId).filter((id): id is number => id != null))],
      outboxIds,
    };
  });

  await invalidateOnTransactionMutation({
    transactionId: requestedIds[0],
    affectedAccountIds: result.affectedAccountIds,
    affectedPeriodIds: result.affectedPeriodIds,
    revisionBumped: true,
  });
  return result;
}

/** A draft may be deleted unless something still points at it: a reallocation or a workflow record. */
function assertDraftDeletionAllowed(tx: any, executor: any): void {
  assertNotReallocated(tx.id, executor);
  const reasons = workflowLinkReasons(tx, executor);
  if (reasons.length > 0) {
    throw new TransactionMutationError(`Draft ${tx.id} is referenced (${reasons.join(", ")}); remove that link first`, 409);
  }
}

export interface ImportTransactionRow {
  date: string;
  amount: number;
  description: string;
  /** Optional explicit sign/type used by the CSV UI. Legacy imports infer
   * expense for positive values and income for negative values. Salary is income the salary
   * schedule recognises as that month's pay, so it will not post the month again. */
  type?: "expense" | "income" | "salary";
  accountId?: number;
  periodId?: number | null;
  categoryId?: number | null;
  notes?: string | null;
  place?: string | null;
  reference?: string | null;
  /** Tags for this row, on top of the import-wide tags. */
  tagIds?: number[];
}

export async function importTransactionsAtomically(input: {
  rows: ImportTransactionRow[];
  accountId?: number;
  defaultDescription?: string;
  tagIds?: number[];
  /** Drafts stay outside the ledger, so they may land in closed periods; posting re-checks. */
  status?: "posted" | "draft";
  batchId?: number | null;
}): Promise<Array<{ id: number; transactionId: number }>> {
  if (!Array.isArray(input.rows) || input.rows.length === 0 || input.rows.length > 1000) {
    throw new TransactionMutationError("Import must contain between 1 and 1000 rows", 400);
  }
  const isDraft = input.status === "draft";
  if (input.batchId != null && (!Number.isInteger(input.batchId) || input.batchId <= 0)) {
    throw new TransactionMutationError("batchId must be a positive integer", 400);
  }
  if (input.batchId != null && !isDraft) {
    throw new TransactionMutationError("Only drafts can be imported into a batch", 400);
  }
  const fallbackAccountId = input.accountId;
  if (fallbackAccountId != null && (!Number.isInteger(fallbackAccountId) || fallbackAccountId <= 0)) {
    throw new TransactionMutationError("Import account must be a positive integer", 400);
  }

  const requestedAccountIds = [...new Set(input.rows.map((row) => row.accountId ?? fallbackAccountId).filter((id): id is number => id != null))];
  if (requestedAccountIds.length === 0) {
    throw new TransactionMutationError("Each imported row needs an account, or a default import account is required", 400);
  }
  const wallets = await db
    .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive, liquidityClass: accounts.liquidityClass })
    .from(accounts)
    .where(inArray(accounts.id, requestedAccountIds));
  const walletById = new Map(wallets.map((wallet) => [wallet.id, wallet]));
  if (wallets.length !== requestedAccountIds.length || wallets.some((wallet) => !wallet.isActive || wallet.type !== "asset")) {
    throw new TransactionMutationError("Every import account must be an active asset account", 400);
  }

  const tagIds = [...new Set(input.tagIds ?? [])];
  const allTagIds = [...new Set([...tagIds, ...input.rows.flatMap((row) => row.tagIds ?? [])])];
  if (allTagIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new TransactionMutationError("tagIds must contain positive integers", 400);
  }
  if (allTagIds.length > 0) {
    const validTags = await db.select({ id: tags.id }).from(tags).where(inArray(tags.id, allTagIds));
    if (validTags.length !== allTagIds.length) {
      throw new TransactionMutationError("One or more tags do not exist", 400);
    }
  }

  const periods = await db
    .select({ id: salaryPeriods.id, startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate, status: salaryPeriods.status })
    .from(salaryPeriods);
  const requestedCategoryIds = [...new Set(input.rows.map((row) => row.categoryId).filter((id): id is number => id != null))];
  const categoryRows = requestedCategoryIds.length > 0
    ? await db.select({ id: categories.id, isActive: categories.isActive, reportingAccountId: categories.reportingAccountId }).from(categories).where(inArray(categories.id, requestedCategoryIds))
    : [];
  const categoryById = new Map(categoryRows.map((category) => [category.id, category]));
  if (categoryRows.length !== requestedCategoryIds.length || categoryRows.some((category) => !category.isActive)) {
    throw new TransactionMutationError("Every import category must be active and exist", 400);
  }
  const reportingAccountIds = [...new Set(categoryRows.map((category) => category.reportingAccountId).filter((id): id is number => id != null))];
  const reportingAccounts = reportingAccountIds.length > 0
    ? await db.select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive }).from(accounts).where(inArray(accounts.id, reportingAccountIds))
    : [];
  const reportingAccountById = new Map(reportingAccounts.map((account) => [account.id, account]));
  if (reportingAccounts.some((account) => !account.isActive || account.type !== "expense")) {
    throw new TransactionMutationError("Category reporting accounts must be active expense accounts", 400);
  }

  const normalizedRows = input.rows.map((row, index) => {
    const dateMs = new Date(row.date).getTime();
    if (!Number.isFinite(dateMs)) {
      throw new TransactionMutationError(`Row ${index + 1} has an invalid date`, 400);
    }
    if (!Number.isSafeInteger(row.amount) || row.amount === 0) {
      throw new TransactionMutationError(`Row ${index + 1} amount must be a non-zero integer rupiah value`, 400);
    }
    const description = (row.description || input.defaultDescription || "").trim();
    if (!description) {
      throw new TransactionMutationError(`Row ${index + 1} description is required`, 400);
    }
    const walletId = row.accountId ?? fallbackAccountId;
    if (walletId == null || !walletById.has(walletId)) {
      throw new TransactionMutationError(`Row ${index + 1} has no valid import account`, 400);
    }
    // The row's date decides its period; an explicit periodId may only confirm it, never move a
    // backdated row out of a closed period into an open one.
    const period = findPeriodInCandidates(dateMs, periods);
    if (row.periodId != null) {
      if (!periods.some((candidate) => candidate.id === row.periodId)) {
        throw new TransactionMutationError(`Row ${index + 1} references an unknown period`, 400);
      }
      if (period?.id !== row.periodId) {
        throw new TransactionMutationError(`Row ${index + 1} is dated outside the selected period`, 400);
      }
    }
    if (period?.status === "closed" && !isDraft) {
      throw new TransactionMutationError(`Period ${period.id} is closed; reopen it before importing transactions`, 409);
    }
    const signedAmount = row.type === "income" || row.type === "salary" ? -Math.abs(row.amount) : row.type === "expense" ? Math.abs(row.amount) : row.amount;
    const category = row.categoryId != null ? categoryById.get(row.categoryId) : undefined;
    if (row.categoryId != null && !category) {
      throw new TransactionMutationError(`Row ${index + 1} references an unknown category`, 400);
    }
    if (signedAmount < 0 && row.categoryId != null) {
      throw new TransactionMutationError(`Row ${index + 1} cannot assign an expense category to income`, 400);
    }
    const wallet = walletById.get(walletId)!;
    return {
      dateMs,
      amount: Math.abs(signedAmount),
      kind: signedAmount >= 0 ? "expense" as const : "income" as const,
      txType: row.type === "salary" ? "salary_income" : signedAmount >= 0 ? "simple_expense" : "simple_income",
      description,
      notes: row.notes ?? null,
      place: row.place?.trim() || null,
      reference: row.reference ?? null,
      wallet,
      category,
      reportingAccountId: category?.reportingAccountId != null ? reportingAccountById.get(category.reportingAccountId)?.id ?? null : null,
      periodId: period?.id ?? null,
      tagIds: [...new Set([...tagIds, ...(row.tagIds ?? [])])],
    };
  });

  const expenseAccount = normalizedRows.some((row) => row.kind === "expense")
    ? await getOrCreateAutoExpenseAccount(db)
    : null;
  const incomeAccount = normalizedRows.some((row) => row.kind === "income")
    ? await getOrCreateAutoIncomeAccount(db)
    : null;

  const imported = db.transaction((tx) => {
    const result = normalizedRows.map((row) => {
    const inserted = tx
      .insert(transactions)
      .values({
        date: new Date(row.dateMs),
        description: row.description,
        notes: row.notes,
        place: row.place,
        reference: row.reference,
        txType: row.txType,
        status: isDraft ? "draft" : "posted",
        batchId: isDraft ? input.batchId ?? null : null,
        periodId: row.periodId,
        categoryId: row.category?.id ?? null,
      })
      .returning({ id: transactions.id })
      .all()[0];
    if (!inserted) throw new Error("Failed to insert imported transaction");
    const counterpartyId = row.kind === "expense" ? row.reportingAccountId ?? expenseAccount!.id : incomeAccount!.id;
    const lines = row.kind === "expense"
      ? [
          { transactionId: inserted.id, accountId: counterpartyId, debit: row.amount, credit: 0 },
          { transactionId: inserted.id, accountId: row.wallet.id, debit: 0, credit: row.amount, cashFlowClass: row.wallet.liquidityClass === "cash_equivalent" ? "operating" : null },
        ]
      : [
          { transactionId: inserted.id, accountId: row.wallet.id, debit: row.amount, credit: 0, cashFlowClass: row.wallet.liquidityClass === "cash_equivalent" ? "operating" : null },
          { transactionId: inserted.id, accountId: counterpartyId, debit: 0, credit: row.amount },
        ];
    tx.insert(transactionLines).values(lines).run();
    if (row.category) {
      tx.insert(transactionCategoryAllocations).values({ transactionId: inserted.id, categoryId: row.category.id, amount: row.amount }).run();
    }
    if (row.tagIds.length > 0) {
      tx.insert(transactionTags)
        .values(row.tagIds.map((tagId) => ({ transactionId: inserted.id, tagId })))
        .run();
    }
    tx.insert(auditLogs).values({
      entityType: "transaction",
      entityId: inserted.id,
      action: "create",
      afterSnapshot: auditSnapshot({
        transaction: { id: inserted.id, ...row },
        lines,
        tagIds: row.tagIds,
        source: isDraft ? "draft_import" : "csv_import",
      }),
    }).run();
    return { id: inserted.id, transactionId: inserted.id };
    });
    // The import is one compound commit; a single revision invalidates all
    // derived facts without exposing partially imported state.
    bumpFinancialRevisionSync(tx);
    return result;
  });

  const affectedAccountIds = [...new Set([
    ...normalizedRows.map((row) => row.wallet.id),
    expenseAccount?.id,
    incomeAccount?.id,
    ...normalizedRows.map((row) => row.reportingAccountId),
  ])]
    .filter((id): id is number => id != null);
  const affectedPeriodIds = [...new Set(normalizedRows.map((row) => row.periodId).filter((id): id is number => id != null))];
  await invalidateOnTransactionMutation({
    transactionId: imported[0].transactionId,
    affectedAccountIds,
    affectedPeriodIds,
    revisionBumped: true,
  });
  return imported;
}
