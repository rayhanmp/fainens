import { and, eq } from "drizzle-orm";

import { auditLogs, transactionCategoryAllocations, transactionLines, transactions } from "../db/schema";
import { insertPreparedJournalEntrySync, prepareJournalEntry, type CategoryAllocationInput, type PreparedJournalEntry } from "./ledger";
import { findPeriodIdForDate } from "./transaction-mutations";

/**
 * A reversal is still a journal, but domain owners must update their own
 * occurrence/obligation state in the same SQLite transaction.  This helper
 * supplies the common immutable-journal part and leaves that ownership state
 * to the caller.
 */
export async function prepareDomainReversal(
  originalTransactionId: number,
  reason: string,
  dbLike: any,
): Promise<{ original: typeof transactions.$inferSelect; prepared: PreparedJournalEntry; periodId: number | null }> {
  const [original] = await dbLike.select().from(transactions)
    .where(eq(transactions.id, originalTransactionId)).limit(1);
  if (!original) throw new Error("Transaction not found");
  if (original.status !== "posted") throw new Error("Only a posted transaction can be corrected");
  const [existing] = await dbLike.select({ id: transactions.id }).from(transactions)
    .where(eq(transactions.reversalOfTxId, originalTransactionId)).limit(1);
  if (existing) throw new Error(`Transaction already has reversal ${existing.id}`);
  const lines = await dbLike.select().from(transactionLines)
    .where(eq(transactionLines.transactionId, originalTransactionId));
  if (lines.length < 2) throw new Error("Cannot reverse an incomplete journal");
  const allocations = await dbLike.select({
    categoryId: transactionCategoryAllocations.categoryId,
    amount: transactionCategoryAllocations.amount,
  }).from(transactionCategoryAllocations)
    .where(eq(transactionCategoryAllocations.transactionId, originalTransactionId));

  const reversalDate = Date.now();
  const periodId = await findPeriodIdForDate(reversalDate);
  const prepared = await prepareJournalEntry({
    date: reversalDate,
    description: `Correction reversal: ${original.description}`,
    reference: original.reference ? `REVERSAL:${original.reference}` : `REVERSAL:${original.id}`,
    notes: `Reason: ${reason}\nReverses posted transaction #${original.id}`,
    txType: "domain_reversal",
    periodId,
    reversalOfTxId: original.id,
    categoryId: original.categoryId,
    ...(allocations.length > 0 ? {
      categoryAllocations: allocations.map((allocation: CategoryAllocationInput) => ({
        categoryId: allocation.categoryId,
        amount: -allocation.amount,
      })),
    } : {}),
    lines: lines.map((line: typeof transactionLines.$inferSelect) => ({
      accountId: line.accountId,
      debit: line.credit,
      credit: line.debit,
      description: `Correction reversal of ${line.description ?? original.description}`,
      cashFlowClass: line.cashFlowClass,
    })),
  }, dbLike);
  return { original, prepared, periodId };
}

/** Insert the inverse journal and make the original immutable as reversed. */
export function insertDomainReversalSync(
  tx: any,
  originalTransactionId: number,
  prepared: PreparedJournalEntry,
  reason: string,
): number {
  const original = tx.select().from(transactions)
    .where(eq(transactions.id, originalTransactionId)).limit(1).all()[0];
  if (!original || original.status !== "posted") throw new Error("Transaction changed; retry correction");
  const [existing] = tx.select({ id: transactions.id }).from(transactions)
    .where(eq(transactions.reversalOfTxId, originalTransactionId)).limit(1).all();
  if (existing) throw new Error(`Transaction already has reversal ${existing.id}`);
  const reversalTransactionId = insertPreparedJournalEntrySync(tx, prepared);
  const updated = tx.update(transactions).set({ status: "reversed" })
    .where(and(eq(transactions.id, originalTransactionId), eq(transactions.status, "posted"))).run();
  if (updated.changes !== 1) throw new Error("Failed to mark original transaction reversed");
  tx.insert(auditLogs).values({
    entityType: "transaction",
    entityId: originalTransactionId,
    action: "correct",
    beforeSnapshot: Buffer.from(JSON.stringify(original)),
    afterSnapshot: Buffer.from(JSON.stringify({
      ...original,
      status: "reversed",
      reversalTransactionId,
      reason,
    })),
  }).run();
  return reversalTransactionId;
}
