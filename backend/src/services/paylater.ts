import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, transactions, transactionLines, paylaterInstallments } from "../db/schema";
import { createJournalEntry, CreateJournalEntryInput, getOrCreateAutoExpenseAccount } from "./ledger";
import { auditCreate } from "./audit";

async function assertPaylaterRecognitionId(originalTxId: number | undefined | null) {
  if (originalTxId == null) return;
  const [row] = await db
    .select({ txType: transactions.txType })
    .from(transactions)
    .where(eq(transactions.id, originalTxId))
    .limit(1);
  if (!row) throw new Error(`Linked transaction not found: ${originalTxId}`);
  if (row.txType !== "paylater_recognition") {
    throw new Error("originalTxId must reference a paylater recognition transaction");
  }
}

async function sumLiabilityCreditsForTx(txId: number): Promise<number> {
  const rows = await db
    .select({
      credit: transactionLines.credit,
      type: accounts.type,
    })
    .from(transactionLines)
    .innerJoin(accounts, eq(transactionLines.accountId, accounts.id))
    .where(eq(transactionLines.transactionId, txId));
  return rows.filter((r) => r.type === "liability").reduce((s, r) => s + r.credit, 0);
}

async function sumLiabilityDebitsForTx(txId: number): Promise<number> {
  const rows = await db
    .select({
      debit: transactionLines.debit,
      type: accounts.type,
    })
    .from(transactionLines)
    .innerJoin(accounts, eq(transactionLines.accountId, accounts.id))
    .where(eq(transactionLines.transactionId, txId));
  return rows.filter((r) => r.type === "liability").reduce((s, r) => s + r.debit, 0);
}

function startOfDayMs(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function daysBetweenDueAndNow(dueMs: number): number {
  return Math.round((startOfDayMs(dueMs) - startOfDayMs(Date.now())) / 86_400_000);
}

// Paylater workflow types
export interface PaylaterRecognitionInput {
  date: Date | number;
  description: string; // e.g., "iPhone 15 Pro - Installment Plan"
  principalAmount: number; // cents - the actual cost of the item
  paylaterLiabilityAccountId: number; // Accounts Payable - Paylater
  /** Optional category for reporting */
  categoryId?: number;
  /** Installment plan options */
  installmentMonths: 1 | 3 | 6 | 12; // Number of months for installment
  interestRatePercent?: number; // Annual interest rate (e.g., 12 for 12%)
  adminFeeCents?: number; // One-time admin fee in cents
  firstDueDate: number; // First installment due date (ms since epoch)
  reference?: string; // e.g., order number
  notes?: string;
}

export interface InstallmentScheduleItem {
  installmentNumber: number;
  totalInstallments: number;
  dueDate: number; // ms since epoch
  principalCents: number;
  interestCents: number;
  feeCents: number;
  totalCents: number;
}

export interface PaylaterInstallmentData {
  id: number;
  installmentNumber: number;
  totalInstallments: number;
  dueDate: number;
  principalCents: number;
  interestCents: number;
  feeCents: number;
  totalCents: number;
  status: "pending" | "paid" | "overdue";
  paidTxId: number | null;
}

export interface PaylaterInterestInput {
  date: Date | number;
  description: string; // e.g., "Monthly interest - SPayLater"
  interestAmount: number; // cents
  interestExpenseAccountId: number; // Interest Expense account
  paylaterLiabilityAccountId: number; // Same paylater liability account
  originalTxId?: number; // Link to original recognition transaction
  /** Due date for this interest charge (e.g. separate from principal schedule). */
  dueDate?: number | null;
  reference?: string;
  notes?: string;
}

export interface PaylaterSettlementInput {
  date: Date | number;
  description: string; // e.g., "SPayLater monthly payment"
  paymentAmount: number; // cents
  paylaterLiabilityAccountId: number; // Paylater liability account to reduce
  bankAccountId: number; // Bank/Cash asset account paying from
  originalTxId?: number; // Link to original recognition transaction
  reference?: string;
  notes?: string;
}

// Calculate installment schedule
export function calculateInstallmentSchedule(params: {
  principalCents: number;
  months: number;
  annualInterestRatePercent: number;
  adminFeeCents: number;
  firstDueDateMs: number;
}): InstallmentScheduleItem[] {
  const { principalCents, months, annualInterestRatePercent, adminFeeCents, firstDueDateMs } = params;
  
  // Simple interest calculation (not amortized)
  const monthlyInterestRate = annualInterestRatePercent / 100 / 12;
  const totalInterest = Math.round(principalCents * monthlyInterestRate * months);
  const totalAmount = principalCents + totalInterest + adminFeeCents;
  
  // Calculate monthly payment (principal + interest spread evenly)
  const principalPerMonth = Math.floor(principalCents / months);
  const interestPerMonth = Math.floor(totalInterest / months);
  
  // Handle rounding - add remainder to first installment
  const principalRemainder = principalCents - (principalPerMonth * months);
  const interestRemainder = totalInterest - (interestPerMonth * months);
  
  const schedule: InstallmentScheduleItem[] = [];
  
  for (let i = 1; i <= months; i++) {
    const dueDate = new Date(firstDueDateMs);
    dueDate.setMonth(dueDate.getMonth() + (i - 1));
    
    const isFirst = i === 1;
    const isLast = i === months;
    
    let installmentPrincipal = principalPerMonth;
    let installmentInterest = interestPerMonth;
    let installmentFee = 0;
    
    // Add remainders to first installment
    if (isFirst) {
      installmentPrincipal += principalRemainder;
      installmentInterest += interestRemainder;
      installmentFee = adminFeeCents;
    }
    
    // Adjust last installment to ensure totals match exactly
    if (isLast) {
      const currentTotal = schedule.reduce((sum, item) => sum + item.totalCents, 0);
      const remainingTotal = totalAmount - currentTotal;
      installmentPrincipal = remainingTotal - installmentInterest - installmentFee;
    }
    
    schedule.push({
      installmentNumber: i,
      totalInstallments: months,
      dueDate: dueDate.getTime(),
      principalCents: installmentPrincipal,
      interestCents: installmentInterest,
      feeCents: installmentFee,
      totalCents: installmentPrincipal + installmentInterest + installmentFee,
    });
  }
  
  return schedule;
}

// Recognition: Buy item on installment (recognize expense and liability)
// Journal Entry:
//   Expense (Asset/Item)    Debit  $3,000
//   Accounts Payable - Paylater   Credit $3,000
export async function recognizePaylaterPurchase(
  input: PaylaterRecognitionInput
): Promise<{ transactionId: number; installments: InstallmentScheduleItem[] }> {
  // Use auto-expense account (like regular expenses)
  const expenseAccount = await getOrCreateAutoExpenseAccount(db);

  const [liabilityAccount] = await db
    .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive })
    .from(accounts)
    .where(eq(accounts.id, input.paylaterLiabilityAccountId))
    .limit(1);

  if (!liabilityAccount) throw new Error(`Liability account not found: ${input.paylaterLiabilityAccountId}`);
  if (!liabilityAccount.isActive) throw new Error("Liability account is not active");
  if (liabilityAccount.type !== "liability") throw new Error("Account must be a liability account");

  // Calculate installment schedule
  const schedule = calculateInstallmentSchedule({
    principalCents: input.principalAmount,
    months: input.installmentMonths,
    annualInterestRatePercent: input.interestRatePercent ?? 0,
    adminFeeCents: input.adminFeeCents ?? 0,
    firstDueDateMs: input.firstDueDate,
  });

  // Calculate total liability (principal + interest + fees)
  const totalLiability = schedule.reduce((sum, item) => sum + item.totalCents, 0);
  const totalInterest = schedule.reduce((sum, item) => sum + item.interestCents, 0);
  const totalFees = schedule.reduce((sum, item) => sum + item.feeCents, 0);

  // Create journal entry
  const journalEntry: CreateJournalEntryInput = {
    date: input.date,
    description: input.description,
    reference: input.reference,
    notes: input.notes,
    txType: "paylater_recognition",
    categoryId: input.categoryId ?? null,
    lines: [
      {
        accountId: expenseAccount.id,
        debit: input.principalAmount,
        credit: 0,
        description: "Principal amount",
      },
      {
        accountId: input.paylaterLiabilityAccountId,
        debit: 0,
        credit: totalLiability,
        description: `Paylater liability (${input.installmentMonths}x installment)`,
      },
    ],
  };

  const result = await createJournalEntry(journalEntry);

  // Update transaction with installment metadata
  await db
    .update(transactions)
    .set({
      installmentMonths: input.installmentMonths,
      interestRatePercent: input.interestRatePercent ?? 0,
      adminFeeCents: input.adminFeeCents ?? 0,
      totalInstallments: input.installmentMonths,
    })
    .where(eq(transactions.id, result.transactionId));

  // Create installment schedule records
  for (const item of schedule) {
    await db.insert(paylaterInstallments).values({
      recognitionTxId: result.transactionId,
      installmentNumber: item.installmentNumber,
      totalInstallments: item.totalInstallments,
      dueDate: new Date(item.dueDate),
      principalCents: item.principalCents,
      interestCents: item.interestCents,
      feeCents: item.feeCents,
      totalCents: item.totalCents,
      status: "pending",
    });
  }

  // Audit log
  await auditCreate("transaction", result.transactionId, {
    type: "paylater_recognition",
    description: input.description,
    principalAmount: input.principalAmount,
    totalInterest,
    totalFees,
    totalLiability,
    installmentMonths: input.installmentMonths,
    paylaterLiabilityAccountId: input.paylaterLiabilityAccountId,
  });

  return { transactionId: result.transactionId, installments: schedule };
}

// Interest Separation: Record interest separately from principal
// Journal Entry:
//   Interest Expense         Debit  $50
//   Accounts Payable - Paylater   Credit $50
export async function recordPaylaterInterest(
  input: PaylaterInterestInput
): Promise<{ transactionId: number }> {
  // Validate accounts
  const [expenseAccount] = await db
    .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive })
    .from(accounts)
    .where(eq(accounts.id, input.interestExpenseAccountId))
    .limit(1);

  if (!expenseAccount) throw new Error(`Interest expense account not found: ${input.interestExpenseAccountId}`);
  if (!expenseAccount.isActive) throw new Error("Account is not active");
  if (expenseAccount.type !== "expense") throw new Error("Account must be an expense account");

  const [liabilityAccount] = await db
    .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive })
    .from(accounts)
    .where(eq(accounts.id, input.paylaterLiabilityAccountId))
    .limit(1);

  if (!liabilityAccount) throw new Error(`Paylater liability account not found: ${input.paylaterLiabilityAccountId}`);
  if (!liabilityAccount.isActive) throw new Error("Account is not active");
  if (liabilityAccount.type !== "liability") throw new Error("Account must be a liability account");

  await assertPaylaterRecognitionId(input.originalTxId);

  if (input.originalTxId != null) {
    const meta = await recognitionLiabilityMeta(input.originalTxId);
    if (meta && meta.liabilityAccountId !== input.paylaterLiabilityAccountId) {
      throw new Error(
        "paylaterLiabilityAccountId must match the liability account on the selected obligation",
      );
    }
  }

  // Create journal entry
  const journalEntry: CreateJournalEntryInput = {
    date: input.date,
    dueDate: input.dueDate ?? null,
    description: input.description,
    reference: input.reference,
    notes: input.notes,
    txType: "paylater_interest",
    linkedTxId: input.originalTxId,
    lines: [
      {
        accountId: input.interestExpenseAccountId,
        debit: input.interestAmount,
        credit: 0,
        description: "Interest charge",
      },
      {
        accountId: input.paylaterLiabilityAccountId,
        debit: 0,
        credit: input.interestAmount,
        description: "Added to paylater balance",
      },
    ],
  };

  const result = await createJournalEntry(journalEntry);

  // Audit log
  await auditCreate("transaction", result.transactionId, {
    type: "paylater_interest",
    description: input.description,
    interestAmount: input.interestAmount,
    interestExpenseAccountId: input.interestExpenseAccountId,
    paylaterLiabilityAccountId: input.paylaterLiabilityAccountId,
    originalTxId: input.originalTxId,
  });

  return { transactionId: result.transactionId };
}

// Settlement: Make a payment (reduce liability, reduce cash)
// This is an asset-liability swap - NO expense impact
// Journal Entry:
//   Accounts Payable - Paylater   Debit  $300
//   Bank Account (Asset)          Credit $300
export async function settlePaylaterPayment(
  input: PaylaterSettlementInput
): Promise<{ transactionId: number }> {
  // Validate accounts
  const [liabilityAccount] = await db
    .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive })
    .from(accounts)
    .where(eq(accounts.id, input.paylaterLiabilityAccountId))
    .limit(1);

  if (!liabilityAccount) throw new Error(`Paylater liability account not found: ${input.paylaterLiabilityAccountId}`);
  if (!liabilityAccount.isActive) throw new Error("Account is not active");
  if (liabilityAccount.type !== "liability") throw new Error("Account must be a liability account");

  const [bankAccount] = await db
    .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive })
    .from(accounts)
    .where(eq(accounts.id, input.bankAccountId))
    .limit(1);

  if (!bankAccount) throw new Error(`Bank account not found: ${input.bankAccountId}`);
  if (!bankAccount.isActive) throw new Error("Account is not active");
  if (bankAccount.type !== "asset") throw new Error("Account must be an asset account");

  await assertPaylaterRecognitionId(input.originalTxId);

  if (input.originalTxId != null) {
    const meta = await recognitionLiabilityMeta(input.originalTxId);
    if (meta && meta.liabilityAccountId !== input.paylaterLiabilityAccountId) {
      throw new Error(
        "paylaterLiabilityAccountId must match the liability account on the selected obligation",
      );
    }
  }

  // Create journal entry
  const journalEntry: CreateJournalEntryInput = {
    date: input.date,
    description: input.description,
    reference: input.reference,
    notes: input.notes,
    txType: "paylater_settlement",
    linkedTxId: input.originalTxId,
    lines: [
      {
        accountId: input.paylaterLiabilityAccountId,
        debit: input.paymentAmount,
        credit: 0,
        description: "Paylater payment - liability reduction",
      },
      {
        accountId: input.bankAccountId,
        debit: 0,
        credit: input.paymentAmount,
        description: "Payment from bank",
      },
    ],
  };

  const result = await createJournalEntry(journalEntry);

  // Audit log
  await auditCreate("transaction", result.transactionId, {
    type: "paylater_settlement",
    description: input.description,
    paymentAmount: input.paymentAmount,
    paylaterLiabilityAccountId: input.paylaterLiabilityAccountId,
    bankAccountId: input.bankAccountId,
    originalTxId: input.originalTxId,
  });

  return { transactionId: result.transactionId };
}

async function recognitionLiabilityMeta(txId: number): Promise<{
  principalCents: number;
  liabilityAccountId: number;
  liabilityAccountName: string;
} | null> {
  const rows = await db
    .select({
      credit: transactionLines.credit,
      accountId: transactionLines.accountId,
      accountName: accounts.name,
      type: accounts.type,
    })
    .from(transactionLines)
    .innerJoin(accounts, eq(transactionLines.accountId, accounts.id))
    .where(eq(transactionLines.transactionId, txId));
  const liabilityCredits = rows.filter((r) => r.type === "liability" && r.credit > 0);
  if (!liabilityCredits.length) return null;
  const top = liabilityCredits.reduce((a, b) => (a.credit >= b.credit ? a : b));
  return {
    principalCents: top.credit,
    liabilityAccountId: top.accountId,
    liabilityAccountName: top.accountName,
  };
}

async function liabilityAccountForTx(txId: number): Promise<{ id: number; name: string } | null> {
  const rows = await db
    .select({
      credit: transactionLines.credit,
      debit: transactionLines.debit,
      accountId: transactionLines.accountId,
      accountName: accounts.name,
      type: accounts.type,
    })
    .from(transactionLines)
    .innerJoin(accounts, eq(transactionLines.accountId, accounts.id))
    .where(eq(transactionLines.transactionId, txId));
  const liability = rows.filter((r) => r.type === "liability");
  if (!liability.length) return null;
  const moved = liability.reduce((a, b) =>
    a.credit + a.debit >= b.credit + b.debit ? a : b,
  );
  return { id: moved.accountId, name: moved.accountName };
}

export interface PaylaterObligation {
  recognitionTxId: number;
  description: string;
  dateRecognizedMs: number;
  liabilityAccountId: number;
  liabilityAccountName: string;
  principalCents: number;
  interestPostedCents: number;
  paymentsPostedCents: number;
  outstandingCents: number;
  dueDateMs: number | null;
  status: "paid" | "overdue" | "due_soon" | "current";
  daysUntilDue: number | null;
  /** Installment plan details */
  installmentMonths?: number;
  interestRatePercent?: number;
  adminFeeCents?: number;
  totalInstallments?: number;
  installments?: PaylaterInstallmentData[];
}

export interface PaylaterScheduleItem {
  dateMs: number;
  kind: "recognition" | "interest" | "installment";
  recognitionTxId: number;
  transactionId: number;
  description: string;
  amountCents: number;
  liabilityAccountId: number;
  liabilityAccountName: string;
  installmentNumber?: number;
}

export interface PaylaterProviderExposure {
  liabilityAccountId: number;
  liabilityAccountName: string;
  totalOutstandingCents: number;
  nextDueDateMs: number | null;
  daysUntilNextDue: number | null;
}

export interface PaylaterObligationsPayload {
  obligations: PaylaterObligation[];
  scheduleItems: PaylaterScheduleItem[];
  providerExposure: PaylaterProviderExposure[];
  totalOutstandingCents: number;
}

/** Per-obligation balances (each recognition is one installment plan root) + calendar schedule items. */
export async function getPaylaterObligations(): Promise<PaylaterObligationsPayload> {
  const recognitions = await db
    .select()
    .from(transactions)
    .where(eq(transactions.txType, "paylater_recognition"))
    .orderBy(desc(transactions.date));

  const obligations: PaylaterObligation[] = [];
  const scheduleItems: PaylaterScheduleItem[] = [];

  let totalOutstandingCents = 0;

  for (const tx of recognitions) {
    const meta = await recognitionLiabilityMeta(tx.id);
    if (!meta) continue;

    const dateRecognizedMs = tx.date instanceof Date ? tx.date.getTime() : (tx.date as number);
    
    // Fetch installments for this recognition
    const installments = await db
      .select()
      .from(paylaterInstallments)
      .where(eq(paylaterInstallments.recognitionTxId, tx.id))
      .orderBy(paylaterInstallments.installmentNumber);

    // Calculate totals from installments
    let totalInterestFromInstallments = 0;
    let totalFeesFromInstallments = 0;
    let paidInstallmentsTotal = 0;
    let pendingInstallments: typeof installments = [];
    let nextPendingDueDate: number | null = null;

    for (const inst of installments) {
      totalInterestFromInstallments += inst.interestCents;
      totalFeesFromInstallments += inst.feeCents;
      
      if (inst.status === "paid") {
        paidInstallmentsTotal += inst.totalCents;
      } else {
        pendingInstallments.push(inst);
        if (nextPendingDueDate === null || inst.dueDate.getTime() < nextPendingDueDate) {
          nextPendingDueDate = inst.dueDate.getTime();
        }
      }
    }

    // Also check for old-style settlements (without installments table)
    const children = await db
      .select()
      .from(transactions)
      .where(eq(transactions.linkedTxId, tx.id));

    let interestPostedCents = 0;
    let paymentsPostedCents = paidInstallmentsTotal;

    for (const ch of children) {
      if (ch.txType === "paylater_interest") {
        interestPostedCents += await sumLiabilityCreditsForTx(ch.id);
      } else if (ch.txType === "paylater_settlement") {
        // Only count settlements not already counted via installments
        const settlementAmount = await sumLiabilityDebitsForTx(ch.id);
        const alreadyCounted = installments.some(i => i.paidTxId === ch.id);
        if (!alreadyCounted) {
          paymentsPostedCents += settlementAmount;
        }
      }
    }

    // Calculate outstanding from pending installments or fallback to old method
    let outstandingCents = 0;
    if (pendingInstallments.length > 0) {
      outstandingCents = pendingInstallments.reduce((sum, inst) => sum + inst.totalCents, 0);
    } else {
      const rawOutstanding = meta.principalCents + interestPostedCents - paymentsPostedCents;
      outstandingCents = Math.max(0, rawOutstanding);
    }
    
    totalOutstandingCents += outstandingCents;

    // Determine status based on next pending installment
    const dueDateMs = nextPendingDueDate ?? (tx.dueDate
      ? tx.dueDate instanceof Date
        ? tx.dueDate.getTime()
        : (tx.dueDate as number)
      : null);

    let status: PaylaterObligation["status"] = "current";
    let daysUntilDue: number | null = null;

    if (outstandingCents <= 0) {
      status = "paid";
    } else if (dueDateMs != null) {
      daysUntilDue = daysBetweenDueAndNow(dueDateMs);
      if (startOfDayMs(dueDateMs) < startOfDayMs(Date.now())) {
        status = "overdue";
      } else if (daysUntilDue >= 0 && daysUntilDue <= 7) {
        status = "due_soon";
      } else {
        status = "current";
      }
    }

    const obligation: PaylaterObligation = {
      recognitionTxId: tx.id,
      description: tx.description,
      dateRecognizedMs,
      liabilityAccountId: meta.liabilityAccountId,
      liabilityAccountName: meta.liabilityAccountName,
      principalCents: meta.principalCents,
      interestPostedCents: totalInterestFromInstallments || interestPostedCents,
      paymentsPostedCents,
      outstandingCents,
      dueDateMs,
      status,
      daysUntilDue: outstandingCents > 0 && dueDateMs != null ? daysUntilDue : null,
    };

    // Add installment metadata if available
    if (tx.installmentMonths) {
      obligation.installmentMonths = tx.installmentMonths;
      obligation.interestRatePercent = tx.interestRatePercent ?? undefined;
      obligation.adminFeeCents = tx.adminFeeCents ?? undefined;
      obligation.totalInstallments = tx.totalInstallments ?? undefined;
      obligation.installments = installments.map(inst => ({
        id: inst.id,
        installmentNumber: inst.installmentNumber,
        totalInstallments: inst.totalInstallments,
        dueDate: inst.dueDate.getTime(),
        principalCents: inst.principalCents,
        interestCents: inst.interestCents,
        feeCents: inst.feeCents,
        totalCents: inst.totalCents,
        status: inst.status as "pending" | "paid" | "overdue",
        paidTxId: inst.paidTxId,
      }));
    }

    obligations.push(obligation);

    // Add pending installments to schedule
    for (const inst of pendingInstallments) {
      scheduleItems.push({
        dateMs: inst.dueDate.getTime(),
        kind: "installment",
        recognitionTxId: tx.id,
        transactionId: inst.id,
        description: `${tx.description} - Installment ${inst.installmentNumber}/${inst.totalInstallments}`,
        amountCents: inst.totalCents,
        liabilityAccountId: meta.liabilityAccountId,
        liabilityAccountName: meta.liabilityAccountName,
        installmentNumber: inst.installmentNumber,
      });
    }

    // Backward compatibility: add old-style schedule items
    if (pendingInstallments.length === 0 && outstandingCents > 0 && dueDateMs != null) {
      scheduleItems.push({
        dateMs: dueDateMs,
        kind: "recognition",
        recognitionTxId: tx.id,
        transactionId: tx.id,
        description: tx.description,
        amountCents: outstandingCents,
        liabilityAccountId: meta.liabilityAccountId,
        liabilityAccountName: meta.liabilityAccountName,
      });
    }

    for (const ch of children) {
      if (ch.txType !== "paylater_interest") continue;
      const chDue = ch.dueDate
        ? ch.dueDate instanceof Date
          ? ch.dueDate.getTime()
          : (ch.dueDate as number)
        : null;
      if (chDue == null) continue;
      const liab = await liabilityAccountForTx(ch.id);
      const amt = await sumLiabilityCreditsForTx(ch.id);
      if (amt <= 0) continue;
      scheduleItems.push({
        dateMs: chDue,
        kind: "interest",
        recognitionTxId: tx.id,
        transactionId: ch.id,
        description: ch.description,
        amountCents: amt,
        liabilityAccountId: liab?.id ?? meta.liabilityAccountId,
        liabilityAccountName: liab?.name ?? meta.liabilityAccountName,
      });
    }
  }

  scheduleItems.sort((a, b) => a.dateMs - b.dateMs);

  const exposureMap = new Map<number, PaylaterProviderExposure>();
  for (const ob of obligations) {
    if (ob.outstandingCents <= 0) continue;
    const prev = exposureMap.get(ob.liabilityAccountId);
    if (!prev) {
      exposureMap.set(ob.liabilityAccountId, {
        liabilityAccountId: ob.liabilityAccountId,
        liabilityAccountName: ob.liabilityAccountName,
        totalOutstandingCents: ob.outstandingCents,
        nextDueDateMs: ob.dueDateMs,
        daysUntilNextDue:
          ob.dueDateMs != null ? daysBetweenDueAndNow(ob.dueDateMs) : null,
      });
    } else {
      prev.totalOutstandingCents += ob.outstandingCents;
      if (ob.dueDateMs != null) {
        if (prev.nextDueDateMs == null || ob.dueDateMs < prev.nextDueDateMs) {
          prev.nextDueDateMs = ob.dueDateMs;
          prev.daysUntilNextDue = daysBetweenDueAndNow(ob.dueDateMs);
        }
      }
    }
  }

  const todayStart = startOfDayMs(Date.now());
  for (const si of scheduleItems) {
    if (si.dateMs < todayStart) continue;
    const exp = exposureMap.get(si.liabilityAccountId);
    if (!exp) continue;
    if (exp.nextDueDateMs == null || si.dateMs < exp.nextDueDateMs) {
      exp.nextDueDateMs = si.dateMs;
      exp.daysUntilNextDue = daysBetweenDueAndNow(si.dateMs);
    }
  }

  const providerExposure = Array.from(exposureMap.values()).sort(
    (a, b) => b.totalOutstandingCents - a.totalOutstandingCents,
  );

  return {
    obligations,
    scheduleItems,
    providerExposure,
    totalOutstandingCents,
  };
}

// Get paylater summary (outstanding paylater balances)
export interface PaylaterSummary {
  totalOutstanding: number;
  paylaterAccounts: Array<{
    accountId: number;
    accountName: string;
    balance: number; // positive = owed
  }>;
}

export async function getPaylaterSummary(): Promise<PaylaterSummary> {
  // Find all liability accounts with "paylater" in the name or code
  const paylaterAccounts = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(
      and(
        eq(accounts.type, "liability"),
        sql`(${accounts.name} LIKE '%paylater%' OR ${accounts.name} LIKE '%installment%' OR ${accounts.name} LIKE '%Paylater%')`,
      ),
    );

  if (paylaterAccounts.length === 0) {
    return { totalOutstanding: 0, paylaterAccounts: [] };
  }

  // Calculate balance for each
  const results: Array<{ accountId: number; accountName: string; balance: number }> = [];
  let totalOutstanding = 0;

  for (const account of paylaterAccounts) {
    // Get transaction lines for this account
    const lines = await db
      .select({
        debit: sql<number>`coalesce(sum(${transactionLines.debit}), 0)`,
        credit: sql<number>`coalesce(sum(${transactionLines.credit}), 0)`,
      })
      .from(transactionLines)
      .where(eq(transactionLines.accountId, account.id));

    const debit = lines[0]?.debit ?? 0;
    const credit = lines[0]?.credit ?? 0;
    // For liability: normal balance is credit, so balance = credit - debit
    const balance = credit - debit;

    if (balance > 0) {
      results.push({
        accountId: account.id,
        accountName: account.name,
        balance,
      });
      totalOutstanding += balance;
    }
  }

  return {
    totalOutstanding,
    paylaterAccounts: results,
  };
}
