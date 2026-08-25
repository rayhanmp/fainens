import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

import { invalidateOnTransactionMutation } from "../cache";
import { db as defaultDb } from "../db/client";
import {
  accounts,
  auditLogs,
  recurringOccurrences,
  salarySettings,
  transactionLines,
  transactions,
} from "../db/schema";
import { estimatePayroll, getTERCategory } from "./indonesia-payroll";
import { getOrCreateAutoIncomeAccount, insertPreparedJournalEntrySync, prepareJournalEntry } from "./ledger";
import { monthlyOccurrenceDate } from "./recurrence-calendar";
import { findPeriodIdForDate } from "./transaction-mutations";
import { bumpFinancialRevisionSync } from "./financial-revision";
import { insertDomainReversalSync, prepareDomainReversal } from "./domain-reversal";

const SINGLETON_ID = 1;

export type SalaryPostingResult = {
  posted: boolean;
  transactionId?: number;
  netAmount?: number;
  occurrenceDate?: number;
  message?: string;
};

async function salaryContext(now = new Date(), requestedOccurrenceDate?: number) {
  const [settings] = await defaultDb.select().from(salarySettings)
    .where(eq(salarySettings.id, SINGLETON_ID)).limit(1);
  if (!settings) return { error: "Salary settings not configured" } as const;
  if (!settings.depositAccountId) return { error: "No deposit account configured" } as const;
  const [account] = await defaultDb
    .select({ id: accounts.id, name: accounts.name, type: accounts.type, isActive: accounts.isActive })
    .from(accounts).where(eq(accounts.id, settings.depositAccountId)).limit(1);
  if (!account || !account.isActive || account.type !== "asset") {
    return { error: "Deposit account must be an active asset account" } as const;
  }
  const occurrenceDate = requestedOccurrenceDate ?? monthlyOccurrenceDate(now.getFullYear(), now.getMonth(), settings.payrollDay);
  const payrollSettings = {
    ptkpCode: settings.ptkpCode,
    terCategory: (settings.terCategory as "A" | "B" | "C") || getTERCategory(settings.ptkpCode),
    jkkRiskGrade: settings.jkkRiskGrade / 10000,
    jkmRate: settings.jkmRate / 10000,
    bpjsKesehatanActive: settings.bpjsKesehatanActive,
    jpWageCap: settings.jpWageCap,
    bpjsKesWageCap: settings.bpjsKesWageCap,
    jhtWageCap: settings.jhtWageCap,
  };
  const payrollMonth = requestedOccurrenceDate == null ? now.getMonth() + 1 : new Date(requestedOccurrenceDate).getMonth() + 1;
  const payroll = estimatePayroll(settings.grossMonthly, settings.ptkpCode, payrollMonth, payrollSettings);
  return { settings, account, occurrenceDate, payroll } as const;
}

/**
 * Scheduler calls are detection-only. The route must pass confirmed=true;
 * occurrence uniqueness then makes retries and multiple instances harmless.
 */
export async function postSalaryIfPayrollDay(
  _dbLike: typeof defaultDb = defaultDb,
  confirmed = false,
  requestedOccurrenceDate?: number,
): Promise<SalaryPostingResult> {
  const now = new Date();
  const context = await salaryContext(now, requestedOccurrenceDate);
  if ("error" in context) return { posted: false, message: context.error };
  const { settings, account, occurrenceDate, payroll } = context;
  if (Date.now() < occurrenceDate) {
    return { posted: false, occurrenceDate, message: `Payroll occurrence is due on ${new Date(occurrenceDate).toLocaleDateString()}` };
  }
  if (payroll.estimatedNetMonthly <= 0) return { posted: false, message: "Net salary must be greater than 0" };

  const [existing] = await defaultDb
    .select({ id: recurringOccurrences.id, status: recurringOccurrences.status, transactionId: recurringOccurrences.transactionId })
    .from(recurringOccurrences)
    .where(and(
      eq(recurringOccurrences.jobType, "salary"),
      eq(recurringOccurrences.scheduleId, SINGLETON_ID),
      eq(recurringOccurrences.occurrenceDate, new Date(occurrenceDate)),
    )).limit(1);
  if (existing && existing.status !== "reversed") {
    return { posted: false, transactionId: existing.transactionId ?? undefined, occurrenceDate, message: "Salary occurrence already processed" };
  }
  const occurrence = new Date(occurrenceDate);
  const monthStart = new Date(occurrence.getFullYear(), occurrence.getMonth(), 1, 0, 0, 0, 0);
  const monthEnd = new Date(occurrence.getFullYear(), occurrence.getMonth() + 1, 0, 23, 59, 59, 999);
  const [legacySalary] = await defaultDb
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(
      eq(transactions.txType, "salary_income"),
      sql`${transactions.status} <> 'draft'`,
      gte(transactions.date, monthStart),
      lte(transactions.date, monthEnd),
    )).limit(1);
  if (legacySalary) {
    return {
      posted: false,
      transactionId: legacySalary.id,
      occurrenceDate,
      message: "A legacy salary transaction already exists for this month",
    };
  }
  if (!confirmed) {
    return { posted: false, occurrenceDate, netAmount: payroll.estimatedNetMonthly, message: "Salary occurrence is due and requires confirmation" };
  }

  const incomeAccount = await getOrCreateAutoIncomeAccount(defaultDb);
  const periodId = await findPeriodIdForDate(occurrenceDate);
  let transactionId: number;
  try {
    transactionId = defaultDb.transaction((tx) => {
      const occurrence = existing?.status === "reversed"
        ? (() => {
            const changed = tx.update(recurringOccurrences).set({
              status: "pending",
              transactionId: null,
              lastError: null,
              updatedAt: new Date(),
            }).where(and(eq(recurringOccurrences.id, existing.id), eq(recurringOccurrences.status, "reversed"))).run();
            if (changed.changes !== 1) throw new Error("Salary occurrence changed; retry posting");
            return { id: existing.id };
          })()
        : tx.insert(recurringOccurrences).values({
            jobType: "salary",
            scheduleId: SINGLETON_ID,
            occurrenceDate: new Date(occurrenceDate),
            status: "pending",
          }).returning({ id: recurringOccurrences.id }).all()[0];
      if (!occurrence) throw new Error("Failed to claim salary occurrence");
      const transaction = tx.insert(transactions).values({
        date: new Date(occurrenceDate),
        description: `Salary income - ${new Date(occurrenceDate).toLocaleDateString("en-ID", { month: "long", year: "numeric" })}`,
        notes: `Gross: ${settings.grossMonthly}, Net: ${payroll.estimatedNetMonthly}, PTKP: ${settings.ptkpCode}`,
        reference: `salary:${SINGLETON_ID}:${new Date(occurrenceDate).getFullYear()}-${String(new Date(occurrenceDate).getMonth() + 1).padStart(2, "0")}`,
        txType: "salary_income",
        periodId,
      }).returning({ id: transactions.id }).all()[0];
      if (!transaction) throw new Error("Failed to post salary transaction");
      const lines = [
        { transactionId: transaction.id, accountId: account.id, debit: payroll.estimatedNetMonthly, credit: 0 },
        { transactionId: transaction.id, accountId: incomeAccount.id, debit: 0, credit: payroll.estimatedNetMonthly },
      ];
      tx.insert(transactionLines).values(lines).run();
      tx.update(recurringOccurrences).set({
        status: "posted",
        transactionId: transaction.id,
        updatedAt: new Date(),
      }).where(eq(recurringOccurrences.id, occurrence.id)).run();
      tx.insert(auditLogs).values({
        entityType: "transaction",
        entityId: transaction.id,
        action: "create",
        afterSnapshot: Buffer.from(JSON.stringify({ occurrenceId: occurrence.id, transaction, lines })),
      }).run();
      bumpFinancialRevisionSync(tx);
      return transaction.id;
    });
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      return { posted: false, occurrenceDate, message: "Salary occurrence already processed" };
    }
    throw error;
  }
  await invalidateOnTransactionMutation({
    transactionId,
    affectedAccountIds: [account.id, incomeAccount.id],
    affectedPeriodIds: periodId == null ? undefined : [periodId],
    revisionBumped: true,
  });
  return {
    posted: true,
    transactionId,
    occurrenceDate,
    netAmount: payroll.estimatedNetMonthly,
    message: `Salary posted: ${payroll.estimatedNetMonthly}`,
  };
}

export type SalaryCatchUpOccurrence = {
  occurrenceDate: number;
  netAmount: number;
  status: "due" | "posted" | "skipped" | "legacy";
  transactionId?: number;
};

/**
 * Return the concrete salary months that became due after the last recorded
 * occurrence. A preview is read-only; it never claims or posts a month.
 */
export async function previewSalaryCatchUp(): Promise<{
  occurrences: SalaryCatchUpOccurrence[];
  truncated: boolean;
  message?: string;
}> {
  const now = new Date();
  const context = await salaryContext(now);
  if ("error" in context) return { occurrences: [], truncated: false, message: context.error };

  const [latest] = await defaultDb.select({ occurrenceDate: recurringOccurrences.occurrenceDate })
    .from(recurringOccurrences)
    .where(and(eq(recurringOccurrences.jobType, "salary"), eq(recurringOccurrences.scheduleId, SINGLETON_ID)))
    .orderBy(desc(recurringOccurrences.occurrenceDate))
    .limit(1);

  const currentMonth = new Date(context.occurrenceDate);
  const cursor = latest
    ? new Date(new Date(latest.occurrenceDate).getFullYear(), new Date(latest.occurrenceDate).getMonth() + 1, 1)
    : new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  const occurrences: SalaryCatchUpOccurrence[] = [];
  let truncated = false;
  for (let i = 0; i < 120 && cursor <= currentMonth; i += 1) {
    const occurrenceDate = monthlyOccurrenceDate(cursor.getFullYear(), cursor.getMonth(), context.settings.payrollDay);
    if (occurrenceDate > Date.now()) break;
    const [existing] = await defaultDb.select({ id: recurringOccurrences.id, status: recurringOccurrences.status, transactionId: recurringOccurrences.transactionId })
      .from(recurringOccurrences)
      .where(and(
        eq(recurringOccurrences.jobType, "salary"),
        eq(recurringOccurrences.scheduleId, SINGLETON_ID),
        eq(recurringOccurrences.occurrenceDate, new Date(occurrenceDate)),
      )).limit(1);
    const monthStart = new Date(new Date(occurrenceDate).getFullYear(), new Date(occurrenceDate).getMonth(), 1);
    const monthEnd = new Date(new Date(occurrenceDate).getFullYear(), new Date(occurrenceDate).getMonth() + 1, 0, 23, 59, 59, 999);
    const [legacySalary] = await defaultDb.select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.txType, "salary_income"), sql`${transactions.status} <> 'draft'`, gte(transactions.date, monthStart), lte(transactions.date, monthEnd)))
      .limit(1);
    const monthContext = await salaryContext(now, occurrenceDate);
    const status: SalaryCatchUpOccurrence["status"] = existing
      ? existing.status === "posted" ? "posted" : existing.status === "reversed" ? "due" : "skipped"
      : legacySalary ? "legacy" : "due";
    occurrences.push({
      occurrenceDate,
      netAmount: monthContext && !('error' in monthContext) ? monthContext.payroll.estimatedNetMonthly : 0,
      status,
      transactionId: existing?.transactionId ?? legacySalary?.id ?? undefined,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  if (cursor <= currentMonth) truncated = true;
  return { occurrences, truncated };
}

/**
 * Correct a posted salary occurrence without erasing it. The original is
 * reversed and a replacement salary journal is posted atomically; the durable
 * occurrence follows the replacement, preserving a complete audit chain.
 */
export async function correctSalaryOccurrence(input: {
  occurrenceDate: number;
  reason: string;
  effectiveDate?: number;
  netAmount?: number;
  depositAccountId?: number;
}): Promise<{ reversalTransactionId: number; replacementTransactionId: number }> {
  if (!Number.isSafeInteger(input.occurrenceDate) || input.occurrenceDate < 0) {
    throw new Error("occurrenceDate must be a valid timestamp");
  }
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) throw new Error("reason is required and must be at most 500 characters");
  const [occurrence] = await defaultDb.select().from(recurringOccurrences).where(and(
    eq(recurringOccurrences.jobType, "salary"),
    eq(recurringOccurrences.scheduleId, SINGLETON_ID),
    eq(recurringOccurrences.occurrenceDate, new Date(input.occurrenceDate)),
  )).limit(1);
  if (!occurrence?.transactionId || occurrence.status !== "posted") {
    throw new Error("A posted salary occurrence is required for correction");
  }
  const context = await salaryContext(new Date(), input.occurrenceDate);
  if ("error" in context) throw new Error(context.error);
  const depositAccountId = input.depositAccountId ?? context.account.id;
  const [depositAccount] = await defaultDb.select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive })
    .from(accounts).where(eq(accounts.id, depositAccountId)).limit(1);
  if (!depositAccount || !depositAccount.isActive || depositAccount.type !== "asset") {
    throw new Error("Replacement deposit account must be an active asset account");
  }
  const netAmount = input.netAmount ?? context.payroll.estimatedNetMonthly;
  if (!Number.isSafeInteger(netAmount) || netAmount <= 0) throw new Error("netAmount must be a positive integer rupiah value");
  const effectiveDate = input.effectiveDate ?? Date.now();
  if (!Number.isSafeInteger(effectiveDate) || effectiveDate < 0) throw new Error("effectiveDate must be a valid timestamp");

  const incomeAccount = await getOrCreateAutoIncomeAccount(defaultDb);
  const reversal = await prepareDomainReversal(occurrence.transactionId, reason, defaultDb);
  const replacementPeriodId = await findPeriodIdForDate(effectiveDate);
  const replacement = await prepareJournalEntry({
    date: effectiveDate,
    description: `Salary correction - ${new Date(input.occurrenceDate).toLocaleDateString("en-ID", { month: "long", year: "numeric" })}`,
    reference: `salary-correction:${SINGLETON_ID}:${input.occurrenceDate}`,
    notes: `Corrects salary occurrence ${input.occurrenceDate}. Reason: ${reason}`,
    txType: "salary_correction",
    periodId: replacementPeriodId,
    lines: [
      { accountId: depositAccount.id, debit: netAmount, credit: 0 },
      { accountId: incomeAccount.id, debit: 0, credit: netAmount },
    ],
  }, defaultDb);
  const result = defaultDb.transaction((tx) => {
    const current = tx.select().from(recurringOccurrences).where(eq(recurringOccurrences.id, occurrence.id)).limit(1).all()[0];
    if (!current || current.status !== "posted" || current.transactionId !== occurrence.transactionId) {
      throw new Error("Salary occurrence changed; retry correction");
    }
    const reversalTransactionId = insertDomainReversalSync(tx, occurrence.transactionId!, reversal.prepared, reason);
    const replacementTransactionId = insertPreparedJournalEntrySync(tx, replacement);
    tx.update(recurringOccurrences).set({
      status: "corrected",
      transactionId: replacementTransactionId,
      lastError: `Corrected from transaction ${occurrence.transactionId}: ${reason}`,
      updatedAt: new Date(),
    }).where(eq(recurringOccurrences.id, occurrence.id)).run();
    tx.insert(auditLogs).values({
      entityType: "recurring_occurrence",
      entityId: occurrence.id,
      action: "correct",
      beforeSnapshot: Buffer.from(JSON.stringify(current)),
      afterSnapshot: Buffer.from(JSON.stringify({ ...current, status: "corrected", transactionId: replacementTransactionId, reversalTransactionId, reason })),
    }).run();
    return { reversalTransactionId, replacementTransactionId };
  });
  await invalidateOnTransactionMutation({
    transactionId: result.replacementTransactionId,
    affectedAccountIds: [...new Set([...reversal.prepared.accountIds, ...replacement.accountIds])],
    affectedPeriodIds: [reversal.periodId, replacementPeriodId].filter((id): id is number => id != null),
    revisionBumped: true,
  });
  return result;
}

/** Record an explicit skip for a due salary month without creating a journal. */
export async function skipSalaryOccurrence(occurrenceDate: number): Promise<{ skipped: boolean; message: string }> {
  const context = await salaryContext(new Date(), occurrenceDate);
  if ("error" in context) return { skipped: false, message: context.error ?? "Salary settings not configured" };
  if (occurrenceDate > Date.now()) return { skipped: false, message: "Salary occurrence is not due yet" };
  try {
    defaultDb.transaction((tx) => {
      const existing = tx.select({ id: recurringOccurrences.id }).from(recurringOccurrences).where(and(
        eq(recurringOccurrences.jobType, "salary"),
        eq(recurringOccurrences.scheduleId, SINGLETON_ID),
        eq(recurringOccurrences.occurrenceDate, new Date(occurrenceDate)),
      )).limit(1).all()[0];
      if (existing) return;
      tx.insert(recurringOccurrences).values({
        jobType: "salary",
        scheduleId: SINGLETON_ID,
        occurrenceDate: new Date(occurrenceDate),
        status: "skipped",
        lastError: "Explicitly skipped during salary catch-up",
      }).run();
      bumpFinancialRevisionSync(tx);
    });
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      return { skipped: false, message: "Salary occurrence already processed" };
    }
    throw error;
  }
  return { skipped: true, message: "Salary occurrence skipped" };
}

export async function previewSalaryPosting(_dbLike: typeof defaultDb = defaultDb): Promise<{
  wouldPost: boolean;
  isPayrollDay: boolean;
  todayDay: number;
  payrollDay: number;
  grossMonthly: number;
  netMonthly: number;
  depositAccountId: number | null;
  depositAccountName: string | null;
  occurrenceDate?: number;
  message: string;
}> {
  const now = new Date();
  const context = await salaryContext(now);
  if ("error" in context) {
    return {
      wouldPost: false,
      isPayrollDay: false,
      todayDay: now.getDate(),
      payrollDay: 25,
      grossMonthly: 0,
      netMonthly: 0,
      depositAccountId: null,
      depositAccountName: null,
      message: context.error ?? "Salary settings are incomplete",
    };
  }
  const result = await postSalaryIfPayrollDay(defaultDb, false);
  return {
    wouldPost: result.message === "Salary occurrence is due and requires confirmation",
    isPayrollDay: now.getDate() === new Date(context.occurrenceDate).getDate(),
    todayDay: now.getDate(),
    payrollDay: context.settings.payrollDay,
    grossMonthly: context.settings.grossMonthly,
    netMonthly: context.payroll.estimatedNetMonthly,
    depositAccountId: context.settings.depositAccountId,
    depositAccountName: context.account.name,
    occurrenceDate: context.occurrenceDate,
    message: result.message ?? "Salary occurrence preview",
  };
}
