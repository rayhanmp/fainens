import { and, eq, inArray, sql } from "drizzle-orm";

import { invalidateOnTransactionMutation } from "../cache/invalidation";
import { db } from "../db/client";
import {
  accounts,
  auditLogs,
  reconciliationItems,
  reconciliationSessions,
  salaryPeriods,
  transactionLines,
  transactions,
} from "../db/schema";
import { bumpFinancialRevisionSync } from "./financial-revision";
import {
  getOrCreateHistoricalRecoveryEquityAccount,
  insertPreparedJournalEntrySync,
  prepareJournalEntry,
  type JournalLineInput,
} from "./ledger";
import { calculateReconciliationItem } from "./reconciliation";

export type RecoveryBalanceInput = { accountId: number; actualBalance: number };

type ReconciliationAccount = {
  id: number;
  name: string;
  type: "asset" | "liability";
  liquidityClass: string;
};

type CalculatedRecoveryItem = RecoveryBalanceInput & {
  accountName: string;
  accountType: "asset" | "liability";
  liquidityClass: string;
  ledgerBalance: number;
  difference: number;
  status: "matched" | "needs_classification";
};

function assertRecoveryInputs(input: {
  balances: RecoveryBalanceInput[];
  asOfDate: number;
  acknowledgement: string;
  note?: string | null;
}): void {
  if (!Array.isArray(input.balances) || input.balances.length === 0) {
    throw new Error("balances array is required");
  }
  if (!Number.isSafeInteger(input.asOfDate) || input.asOfDate < 0 || input.asOfDate > Date.now()) {
    throw new Error("asOfDate must be a current or historical timestamp");
  }
  const ids = input.balances.map((item) => item.accountId);
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    throw new Error("Each recovery account must appear once with a positive integer ID");
  }
  if (input.balances.some((item) => !Number.isSafeInteger(item.actualBalance) || item.actualBalance < 0)) {
    throw new Error("Each actual balance must be a non-negative integer-rupiah amount");
  }
  if (input.acknowledgement.trim().length < 12 || input.acknowledgement.length > 500) {
    throw new Error("A concise acknowledgement of the untracked historical gap is required");
  }
  if (input.note != null && input.note.trim().length > 1_000) {
    throw new Error("note must be at most 1000 characters");
  }
}

function calculateItemsSync(
  executor: any,
  accountRows: ReconciliationAccount[],
  balancesByAccountId: Map<number, number>,
  asOfDate: number,
): CalculatedRecoveryItem[] {
  return accountRows.map((account) => {
    const sums = executor
      .select({
        debit: sql<number>`coalesce(sum(${transactionLines.debit}), 0)`,
        credit: sql<number>`coalesce(sum(${transactionLines.credit}), 0)`,
      })
      .from(transactionLines)
      .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
      .where(and(
        eq(transactionLines.accountId, account.id),
        sql`${transactions.date} <= ${asOfDate}`,
        sql`${transactions.status} <> 'draft'`,
      ))
      .all()[0];
    const calculated = calculateReconciliationItem({
      accountType: account.type,
      debit: Number(sums?.debit ?? 0),
      credit: Number(sums?.credit ?? 0),
      actualBalance: balancesByAccountId.get(account.id)!,
    });
    return {
      accountId: account.id,
      actualBalance: balancesByAccountId.get(account.id)!,
      accountName: account.name,
      accountType: account.type,
      liquidityClass: account.liquidityClass,
      ...calculated,
    };
  });
}

function adjustmentLines(items: CalculatedRecoveryItem[], equityAccountId: number): JournalLineInput[] {
  const lines: JournalLineInput[] = [];
  for (const item of items) {
    if (item.difference === 0) continue;
    const amount = Math.abs(item.difference);
    const debit = item.accountType === "asset" ? item.difference > 0 : item.difference < 0;
    lines.push({
      accountId: item.accountId,
      debit: debit ? amount : 0,
      credit: debit ? 0 : amount,
      description: "Historical recovery balance bridge",
      cashFlowClass: item.liquidityClass === "cash_equivalent" ? "recovery" : null,
    });
  }
  const debitTotal = lines.reduce((total, line) => total + line.debit, 0);
  const creditTotal = lines.reduce((total, line) => total + line.credit, 0);
  const difference = debitTotal - creditTotal;
  if (difference === 0) return [];
  lines.push({
    accountId: equityAccountId,
    debit: difference < 0 ? -difference : 0,
    credit: difference > 0 ? difference : 0,
    description: "Historical recovery balance bridge",
  });
  return lines;
}

/**
 * Posts a deliberately disclosed bridge from an incomplete historical ledger
 * to a user-confirmed current balance snapshot. It never invents income,
 * expense, or classified cash flow.
 */
export async function createRecoveryReconciliation(input: {
  balances: RecoveryBalanceInput[];
  asOfDate: number;
  acknowledgement: string;
  note?: string | null;
}): Promise<{ session: any; items: CalculatedRecoveryItem[]; recoveryTransactionId: number | null }> {
  assertRecoveryInputs(input);
  const activeAccounts = (await db
    .select({ id: accounts.id, name: accounts.name, type: accounts.type, liquidityClass: accounts.liquidityClass })
    .from(accounts)
    .where(and(eq(accounts.isActive, true), inArray(accounts.type, ["asset", "liability"])))) as ReconciliationAccount[];
  const suppliedIds = new Set(input.balances.map((item) => item.accountId));
  if (activeAccounts.length === 0) throw new Error("Create at least one active asset or liability account first");
  if (suppliedIds.size !== activeAccounts.length || activeAccounts.some((account) => !suppliedIds.has(account.id))) {
    throw new Error("A recovery reconciliation requires actual balances for every active asset and liability account");
  }

  const balancesByAccountId = new Map(input.balances.map((item) => [item.accountId, item.actualBalance]));
  const initialItems = calculateItemsSync(db, activeAccounts, balancesByAccountId, input.asOfDate);
  const equityAccount = await getOrCreateHistoricalRecoveryEquityAccount();
  const lines = adjustmentLines(initialItems, equityAccount.id);
  const prepared = lines.length === 0 ? null : await prepareJournalEntry({
    date: input.asOfDate,
    description: "Historical recovery reconciliation",
    notes: input.note?.trim() || input.acknowledgement.trim(),
    txType: "historical_recovery_adjustment",
    lines,
  });

  const result = db.transaction((tx) => {
    // The amounts were prepared outside the synchronous SQLite transaction.
    // Refuse to post if a competing writer changed the ledger meanwhile.
    const currentItems = calculateItemsSync(tx, activeAccounts, balancesByAccountId, input.asOfDate);
    if (currentItems.some((item, index) => item.ledgerBalance !== initialItems[index].ledgerBalance)) {
      throw new Error("Ledger changed while preparing recovery reconciliation; review and retry");
    }
    const recoveryTransactionId = prepared == null ? null : insertPreparedJournalEntrySync(tx, prepared);
    const allMatched = currentItems.every((item) => item.difference === 0);
    const session = tx.insert(reconciliationSessions).values({
      asOfDate: new Date(input.asOfDate),
      status: allMatched ? "reconciled" : "recovered",
      kind: "recovery",
      note: input.note?.trim() || input.acknowledgement.trim(),
    }).returning().all()[0];
    if (!session) throw new Error("Failed to create recovery reconciliation session");
    tx.insert(reconciliationItems).values(currentItems.map((item) => ({
      sessionId: session.id,
      accountId: item.accountId,
      ledgerBalance: item.ledgerBalance,
      actualBalance: item.actualBalance,
      difference: item.difference,
      status: item.status,
      correctionTransactionId: item.difference === 0 ? null : recoveryTransactionId,
    }))).run();

    if (prepared?.periodId != null) {
      const period = tx.select().from(salaryPeriods).where(eq(salaryPeriods.id, prepared.periodId)).limit(1).all()[0];
      if (period?.coverageStatus === "skipped") {
        const updated = tx.update(salaryPeriods)
          .set({ coverageStatus: "partial", coverageReason: "recovery_reconciliation" })
          .where(eq(salaryPeriods.id, period.id)).returning().all()[0];
        tx.insert(auditLogs).values({
          entityType: "salary_period",
          entityId: period.id,
          action: "mark_partial_from_recovery",
          beforeSnapshot: Buffer.from(JSON.stringify(period)),
          afterSnapshot: Buffer.from(JSON.stringify(updated)),
        }).run();
      }
    }
    tx.insert(auditLogs).values({
      entityType: "reconciliation_session",
      entityId: session.id,
      action: "create_recovery",
      afterSnapshot: Buffer.from(JSON.stringify({
        session,
        acknowledgement: input.acknowledgement.trim(),
        items: currentItems,
        recoveryTransactionId,
      })),
    }).run();
    if (prepared == null) bumpFinancialRevisionSync(tx);
    return { session, items: currentItems, recoveryTransactionId };
  });

  if (prepared != null && result.recoveryTransactionId != null) {
    await invalidateOnTransactionMutation({
      transactionId: result.recoveryTransactionId,
      affectedAccountIds: prepared.accountIds,
      affectedPeriodIds: prepared.periodId != null ? [prepared.periodId] : undefined,
    });
  }
  return result;
}
