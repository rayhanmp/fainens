import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, transactions, transactionLines, paylaterInstallments, auditLogs } from "../db/schema";
import {
  CreateJournalEntryInput,
  getOrCreateAutoExpenseAccount,
  insertPreparedJournalEntrySync,
  prepareJournalEntry,
} from "./ledger";
import { invalidateOnTransactionMutation } from "../cache/invalidation";
import { addMonthsClamped } from "./recurrence-calendar";

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
  paidCents: number;
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
  /** Optional installment allocation; omitted means oldest outstanding installments. */
  installmentIds?: number[];
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
    // Clamp against the original day-of-month, so a 31st-of-month plan is
    // Feb 28/29 then Mar 31 instead of drifting permanently to the 28th.
    const dueDateMs = addMonthsClamped(firstDueDateMs, i - 1);
    
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
      dueDate: dueDateMs,
      principalCents: installmentPrincipal,
      interestCents: installmentInterest,
      feeCents: installmentFee,
      totalCents: installmentPrincipal + installmentInterest + installmentFee,
    });
  }
  
  return schedule;
}

function assertPositiveSafeInteger(value: unknown, fieldName: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
}

function assertNonNegativeSafeInteger(value: unknown, fieldName: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
}

// Recognition: Buy item on installment (recognize expense and liability)
// Journal Entry:
//   Expense (Asset/Item)    Debit  $3,000
//   Accounts Payable - Paylater   Credit $3,000
export async function recognizePaylaterPurchase(
  input: PaylaterRecognitionInput
): Promise<{ transactionId: number; installments: InstallmentScheduleItem[] }> {
  assertPositiveSafeInteger(input.principalAmount, "principalAmount");
  assertNonNegativeSafeInteger(input.adminFeeCents ?? 0, "adminFeeCents");
  if (!Number.isFinite(input.interestRatePercent ?? 0) || (input.interestRatePercent ?? 0) < 0) {
    throw new Error("interestRatePercent must be a non-negative number");
  }
  if (![1, 3, 6, 12].includes(input.installmentMonths)) {
    throw new Error("installmentMonths must be 1, 3, 6, or 12");
  }
  if (!Number.isFinite(input.firstDueDate)) throw new Error("firstDueDate must be a valid timestamp");

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
        credit: input.principalAmount,
        description: `Paylater principal liability (${input.installmentMonths}x installment)`,
      },
    ],
  };

  const prepared = await prepareJournalEntry(journalEntry, db);
  const result = db.transaction((tx) => {
    const transactionId = insertPreparedJournalEntrySync(tx, prepared);
    tx.update(transactions).set({
      installmentMonths: input.installmentMonths,
      interestRatePercent: input.interestRatePercent ?? 0,
      adminFeeCents: input.adminFeeCents ?? 0,
      totalInstallments: input.installmentMonths,
    }).where(eq(transactions.id, transactionId)).run();

    tx.insert(paylaterInstallments).values(schedule.map((item) => ({
      recognitionTxId: transactionId,
      installmentNumber: item.installmentNumber,
      totalInstallments: item.totalInstallments,
      dueDate: new Date(item.dueDate),
      principalCents: item.principalCents,
      interestCents: item.interestCents,
      feeCents: item.feeCents,
      totalCents: item.totalCents,
      status: "pending",
    }))).run();
    tx.insert(auditLogs).values({
      entityType: "transaction",
      entityId: transactionId,
      action: "create",
      afterSnapshot: Buffer.from(JSON.stringify({
        type: "paylater_recognition",
        description: input.description,
        principalAmount: input.principalAmount,
        totalInterest,
        totalFees,
        totalLiability,
        installmentMonths: input.installmentMonths,
        paylaterLiabilityAccountId: input.paylaterLiabilityAccountId,
      })),
    }).run();
    return transactionId;
  });

  await invalidateOnTransactionMutation({
    transactionId: result,
    affectedAccountIds: prepared.accountIds,
    revisionBumped: true,
  });
  return { transactionId: result, installments: schedule };
}

// Interest Separation: Record interest separately from principal
// Journal Entry:
//   Interest Expense         Debit  $50
//   Accounts Payable - Paylater   Credit $50
export async function recordPaylaterInterest(
  input: PaylaterInterestInput
): Promise<{ transactionId: number }> {
  assertPositiveSafeInteger(input.interestAmount, "interestAmount");
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

  const prepared = await prepareJournalEntry(journalEntry, db);
  const result = db.transaction((tx) => {
    const transactionId = insertPreparedJournalEntrySync(tx, prepared);
    tx.insert(auditLogs).values({
      entityType: "transaction",
      entityId: transactionId,
      action: "create",
      afterSnapshot: Buffer.from(JSON.stringify({
        type: "paylater_interest",
        description: input.description,
        interestAmount: input.interestAmount,
        interestExpenseAccountId: input.interestExpenseAccountId,
        paylaterLiabilityAccountId: input.paylaterLiabilityAccountId,
        originalTxId: input.originalTxId,
      })),
    }).run();
    return transactionId;
  });
  await invalidateOnTransactionMutation({
    transactionId: result,
    affectedAccountIds: prepared.accountIds,
    revisionBumped: true,
  });
  return { transactionId: result };
}

// Settlement: Make a payment (reduce liability, reduce cash)
// This is an asset-liability swap - NO expense impact
// Journal Entry:
//   Accounts Payable - Paylater   Debit  $300
//   Bank Account (Asset)          Credit $300
export async function settlePaylaterPayment(
  input: PaylaterSettlementInput
): Promise<{ transactionId: number }> {
  assertPositiveSafeInteger(input.paymentAmount, "paymentAmount");
  if (input.installmentIds && (
    !Array.isArray(input.installmentIds) ||
    input.installmentIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    new Set(input.installmentIds).size !== input.installmentIds.length
  )) {
    throw new Error("installmentIds must contain unique positive integers");
  }
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

  const prepared = await prepareJournalEntry(journalEntry, db);
  const result = db.transaction((tx) => {
    const allocations: Array<{ id: number; amount: number; fullyPaid: boolean }> = [];
    if (input.originalTxId != null) {
      // A linked payment cannot reduce the selected obligation below zero.
      // This check is inside the write transaction so two concurrent payments
      // cannot both spend the same liability balance.
      const liabilityRows = tx.select({
        credit: transactionLines.credit,
        debit: transactionLines.debit,
      })
        .from(transactionLines)
        .where(and(
          eq(transactionLines.accountId, input.paylaterLiabilityAccountId),
          sql`${transactionLines.transactionId} = ${input.originalTxId} OR ${transactionLines.transactionId} IN (SELECT id FROM "transaction" WHERE linked_tx_id = ${input.originalTxId})`,
        ))
        .all();
      const outstanding = liabilityRows.reduce((sum, row) => sum + row.credit - row.debit, 0);
      if (input.paymentAmount > outstanding) {
        throw new Error(`Payment exceeds outstanding paylater liability (${outstanding})`);
      }

      const installments = tx.select().from(paylaterInstallments)
        .where(eq(paylaterInstallments.recognitionTxId, input.originalTxId))
        .orderBy(paylaterInstallments.installmentNumber)
        .all();
      const candidates = input.installmentIds
        ? installments.filter((item) => input.installmentIds!.includes(item.id))
        : installments.filter((item) => Number(item.paidCents ?? 0) < item.totalCents);
      if (input.installmentIds && candidates.length !== input.installmentIds.length) {
        throw new Error("One or more installments do not belong to the selected obligation");
      }
      let remaining = input.paymentAmount;
      for (const installment of candidates) {
        if (remaining <= 0) break;
        const paidCents = Number(installment.paidCents ?? 0);
        const open = Math.max(0, installment.totalCents - paidCents);
        if (open <= 0) continue;
        const amount = Math.min(open, remaining);
        allocations.push({ id: installment.id, amount, fullyPaid: paidCents + amount >= installment.totalCents });
        remaining -= amount;
      }
      // If a schedule exists, do not silently attach a payment to no
      // installment. Manual/legacy interest without a schedule remains valid.
      if (installments.length > 0 && remaining > 0) {
        throw new Error("Payment exceeds the outstanding installment schedule");
      }
    }
    const transactionId = insertPreparedJournalEntrySync(tx, prepared);
    for (const allocation of allocations) {
      const current = tx.select({ paidCents: paylaterInstallments.paidCents })
        .from(paylaterInstallments)
        .where(eq(paylaterInstallments.id, allocation.id)).limit(1).all()[0];
      if (!current) throw new Error("Installment disappeared during settlement");
      const nextPaid = Number(current.paidCents ?? 0) + allocation.amount;
      tx.update(paylaterInstallments).set({
        paidCents: nextPaid,
        status: allocation.fullyPaid ? "paid" : "pending",
        paidTxId: allocation.fullyPaid ? transactionId : null,
      }).where(eq(paylaterInstallments.id, allocation.id)).run();
    }
    tx.insert(auditLogs).values({
      entityType: "transaction",
      entityId: transactionId,
      action: "create",
      afterSnapshot: Buffer.from(JSON.stringify({
        type: "paylater_settlement",
        description: input.description,
        paymentAmount: input.paymentAmount,
        paylaterLiabilityAccountId: input.paylaterLiabilityAccountId,
        bankAccountId: input.bankAccountId,
        originalTxId: input.originalTxId,
        allocations,
      })),
    }).run();
    return transactionId;
  });
  await invalidateOnTransactionMutation({
    transactionId: result,
    affectedAccountIds: prepared.accountIds,
    revisionBumped: true,
  });
  return { transactionId: result };
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
    .where(and(eq(transactions.txType, "paylater_recognition"), sql`${transactions.status} <> 'draft'`))
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
    let paidInstallmentsTotal = 0;
    let pendingInstallments: typeof installments = [];
    let nextPendingDueDate: number | null = null;

    for (const inst of installments) {
      const paidCents = Math.min(inst.totalCents, Math.max(0, Number(inst.paidCents ?? 0)));
      if (paidCents >= inst.totalCents || inst.status === "paid") {
        paidInstallmentsTotal += inst.status === "paid" ? inst.totalCents : paidCents;
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
      .where(and(eq(transactions.linkedTxId, tx.id), sql`${transactions.status} <> 'draft'`));

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

    // Only posted journal entries are liabilities. Future interest/fees in the
    // schedule are forecasts and must not inflate the current balance sheet.
    // The old implementation summed pending installment totals here, making a
    // newly recognized principal appear to owe unearned interest immediately.
    const rawOutstanding = meta.principalCents + interestPostedCents - paymentsPostedCents;
    const outstandingCents = Math.max(0, rawOutstanding);
    
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
      interestPostedCents,
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
        paidCents: Number(inst.paidCents ?? 0),
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
        amountCents: Math.max(0, inst.totalCents - Number(inst.paidCents ?? 0)),
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
      .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
      .where(and(eq(transactionLines.accountId, account.id), sql`${transactions.status} <> 'draft'`));

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
