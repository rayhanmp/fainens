import { and, eq, inArray, or, sql } from "drizzle-orm";

import { invalidateOnTransactionMutation } from "../cache";
import { db } from "../db/client";
import {
  accounts,
  attachments,
  auditLogs,
  loanPayments,
  loans,
  paylaterInstallments,
  salaryPeriods,
  storageDeletionOutbox,
  tags,
  transactionLines,
  transactions,
  transactionTags,
  wishlist,
} from "../db/schema";
import { validateJournalLines, type ValidatedJournalLine } from "./journal-validation";
import { getIntrinsicTransactionProtectionReasons } from "./transaction-mutation-policy";
import { getOrCreateAutoExpenseAccount, getOrCreateAutoIncomeAccount } from "./ledger";
import { bumpFinancialRevisionSync } from "./financial-revision";
import { assertJournalPeriodOpen, findPeriodForDate, inclusivePeriodEnd } from "./period-locking";

export class TransactionMutationError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = "TransactionMutationError";
  }
}

function auditSnapshot(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
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
    .filter((period) => dateMs >= Number(period.startDate) && dateMs <= inclusivePeriodEnd(Number(period.endDate)))
    .sort((a, b) => Number(b.startDate) - Number(a.startDate))[0];
  return containing ? { id: containing.id, status: containing.status } : null;
}

function assertGenericMutationAllowed(tx: any, executor: any): void {
  const reasons = getIntrinsicTransactionProtectionReasons(tx);

  const incomingLink = executor
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.linkedTxId, tx.id))
    .limit(1)
    .all()[0];
  if (incomingLink) reasons.push("linked transaction chain");

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

  if (reasons.length > 0) {
    throw new TransactionMutationError(
      `Transaction ${tx.id} is domain-owned (${reasons.join(", ")}); use the owning workflow to reverse or change it`,
      409,
    );
  }
}

export interface UpdateTransactionInput {
  date?: string;
  description?: string;
  reference?: string | null;
  notes?: string | null;
  place?: string | null;
  txType?: string;
  categoryId?: number | null;
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

  const periodId = await assertJournalPeriodOpen(effectiveDate, null);
  const validatedLines = input.lines === undefined ? undefined : validateJournalLines(input.lines).lines;
  if (validatedLines) {
    const accountIds = [...new Set(validatedLines.map((line) => line.accountId))];
    const validAccounts = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(inArray(accounts.id, accountIds), eq(accounts.isActive, true)));
    if (validAccounts.length !== accountIds.length) {
      throw new TransactionMutationError("Every journal line must reference an active account", 400);
    }
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
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
  };

  const after = db.transaction((tx) => {
    const fresh = tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .limit(1)
      .all()[0];
    if (!fresh) throw new TransactionMutationError("Transaction not found", 404);
    assertGenericMutationAllowed(fresh, tx);

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
    tx.insert(auditLogs).values({
      entityType: "transaction",
      entityId: transactionId,
      action: "update",
      beforeSnapshot: auditSnapshot({ transaction: fresh, lines: currentLines, tags: currentTags }),
      afterSnapshot: auditSnapshot({ transaction: updated, lines: nextLines, tags: nextTags }),
    }).run();
    bumpFinancialRevisionSync(tx);
    return { ...updated, lines: nextLines, tagIds: nextTags.map((tag) => tag.tagId) };
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
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0 || uniqueIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new TransactionMutationError("Transaction IDs must be positive integers", 400);
  }
  if (uniqueIds.length > 100) {
    throw new TransactionMutationError("At most 100 transactions may be deleted at once", 400);
  }

  const result = db.transaction((tx) => {
    const rows = tx.select().from(transactions).where(inArray(transactions.id, uniqueIds)).all();
    if (rows.length !== uniqueIds.length) {
      const found = new Set(rows.map((row) => row.id));
      const missing = uniqueIds.filter((id) => !found.has(id));
      throw new TransactionMutationError(`Transaction not found: ${missing.join(", ")}`, 404);
    }
    for (const row of rows) assertGenericMutationAllowed(row, tx);

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
    transactionId: uniqueIds[0],
    affectedAccountIds: result.affectedAccountIds,
    affectedPeriodIds: result.affectedPeriodIds,
    revisionBumped: true,
  });
  return result;
}

export interface ImportTransactionRow {
  date: string;
  amount: number;
  description: string;
}

export async function importTransactionsAtomically(input: {
  rows: ImportTransactionRow[];
  accountId: number;
  defaultDescription: string;
  tagIds?: number[];
}): Promise<Array<{ id: number; transactionId: number }>> {
  if (!Array.isArray(input.rows) || input.rows.length === 0 || input.rows.length > 1000) {
    throw new TransactionMutationError("Import must contain between 1 and 1000 rows", 400);
  }
  const [wallet] = await db
    .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive })
    .from(accounts)
    .where(eq(accounts.id, input.accountId))
    .limit(1);
  if (!wallet || !wallet.isActive || wallet.type !== "asset") {
    throw new TransactionMutationError("Import account must be an active asset account", 400);
  }

  const tagIds = [...new Set(input.tagIds ?? [])];
  if (tagIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new TransactionMutationError("tagIds must contain positive integers", 400);
  }
  if (tagIds.length > 0) {
    const validTags = await db.select({ id: tags.id }).from(tags).where(inArray(tags.id, tagIds));
    if (validTags.length !== tagIds.length) {
      throw new TransactionMutationError("One or more tags do not exist", 400);
    }
  }

  const periods = await db
    .select({ id: salaryPeriods.id, startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate, status: salaryPeriods.status })
    .from(salaryPeriods);
  const normalizedRows = input.rows.map((row, index) => {
    const dateMs = new Date(row.date).getTime();
    if (!Number.isFinite(dateMs)) {
      throw new TransactionMutationError(`Row ${index + 1} has an invalid date`, 400);
    }
    if (!Number.isSafeInteger(row.amount) || row.amount === 0) {
      throw new TransactionMutationError(`Row ${index + 1} amount must be a non-zero integer rupiah value`, 400);
    }
    const description = (row.description || input.defaultDescription).trim();
    if (!description) {
      throw new TransactionMutationError(`Row ${index + 1} description is required`, 400);
    }
    const period = findPeriodInCandidates(dateMs, periods);
    if (period?.status === "closed") {
      throw new TransactionMutationError(`Period ${period.id} is closed; reopen it before importing transactions`, 409);
    }
    return {
      dateMs,
      amount: Math.abs(row.amount),
      kind: row.amount >= 0 ? "expense" as const : "income" as const,
      description,
      periodId: period?.id ?? null,
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
        txType: `simple_${row.kind}`,
        periodId: row.periodId,
      })
      .returning({ id: transactions.id })
      .all()[0];
    if (!inserted) throw new Error("Failed to insert imported transaction");
    const counterpartyId = row.kind === "expense" ? expenseAccount!.id : incomeAccount!.id;
    const lines = row.kind === "expense"
      ? [
          { transactionId: inserted.id, accountId: counterpartyId, debit: row.amount, credit: 0 },
          { transactionId: inserted.id, accountId: wallet.id, debit: 0, credit: row.amount },
        ]
      : [
          { transactionId: inserted.id, accountId: wallet.id, debit: row.amount, credit: 0 },
          { transactionId: inserted.id, accountId: counterpartyId, debit: 0, credit: row.amount },
        ];
    tx.insert(transactionLines).values(lines).run();
    if (tagIds.length > 0) {
      tx.insert(transactionTags)
        .values(tagIds.map((tagId) => ({ transactionId: inserted.id, tagId })))
        .run();
    }
    tx.insert(auditLogs).values({
      entityType: "transaction",
      entityId: inserted.id,
      action: "create",
      afterSnapshot: auditSnapshot({
        transaction: { id: inserted.id, ...row },
        lines,
        tagIds,
        source: "csv_import",
      }),
    }).run();
    return { id: inserted.id, transactionId: inserted.id };
    });
    // The import is one compound commit; a single revision invalidates all
    // derived facts without exposing partially imported state.
    bumpFinancialRevisionSync(tx);
    return result;
  });

  const affectedAccountIds = [wallet.id, expenseAccount?.id, incomeAccount?.id]
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
