import { eq, and, or, ne, sql, desc } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, transactions, transactionLines, paylaterInstallments, paylaterSettlementAllocations, auditLogs } from "../db/schema";
import {
  CreateJournalEntryInput,
  JournalLineInput,
  getOrCreateAutoExpenseAccount,
  insertPreparedJournalEntrySync,
  prepareJournalEntry,
} from "./ledger";
import { invalidateOnTransactionMutation } from "../cache/invalidation";
import { addMonthsFromAnchor, DAY_MS, startOfLocalDay } from "../lib/calendar";
import { insertDomainReversalSync, prepareDomainReversal } from "./domain-reversal";

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

/** Whole calendar days (app time zone) from today to the due day: 0 on the due day, negative once overdue. */
function daysBetweenDueAndNow(dueMs: number): number {
  return Math.round((startOfLocalDay(dueMs) - startOfLocalDay(Date.now())) / DAY_MS);
}

/** An unpaid due date is overdue only from the calendar day after it. */
function isPastDue(dueMs: number): boolean {
  return startOfLocalDay(dueMs) < startOfLocalDay(Date.now());
}

interface ObligationInstallmentState {
  row: typeof paylaterInstallments.$inferSelect;
  paidCents: number;
  openCents: number;
  /** Unpaid interest + fee; a payment covers an installment's financing before its principal. */
  financingOpenCents: number;
}

interface ObligationState {
  /** Ledger balance of the obligation on its liability account (credit - debit), posted entries only. */
  liabilityOutstandingCents: number;
  installments: ObligationInstallmentState[];
  /** Cash applied to the schedule: allocation rows plus legacy settlements that predate them. */
  paymentsCents: number;
  scheduleOpenCents: number;
}

/**
 * Current state of one obligation. Synchronous so the same reads run inside a
 * settlement's write transaction and in the obligations listing.
 */
function loadObligationStateSync(executor: any, recognitionTxId: number, liabilityAccountId: number): ObligationState {
  // Reversed entries drop out together with their reversal, which is not linked to the obligation.
  const liabilityRows: Array<{ credit: number; debit: number }> = executor
    .select({ credit: transactionLines.credit, debit: transactionLines.debit })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
    .where(and(
      eq(transactionLines.accountId, liabilityAccountId),
      eq(transactions.status, "posted"),
      or(eq(transactions.id, recognitionTxId), eq(transactions.linkedTxId, recognitionTxId)),
    ))
    .all();
  const liabilityOutstandingCents = liabilityRows.reduce((sum, row) => sum + row.credit - row.debit, 0);

  const rows: Array<typeof paylaterInstallments.$inferSelect> = executor.select().from(paylaterInstallments)
    .where(and(
      eq(paylaterInstallments.recognitionTxId, recognitionTxId),
      ne(paylaterInstallments.status, "cancelled"),
    ))
    .orderBy(paylaterInstallments.installmentNumber)
    .all();
  if (rows.length === 0) {
    return { liabilityOutstandingCents, installments: [], paymentsCents: 0, scheduleOpenCents: 0 };
  }

  // Allocation rows of posted settlements are the source of truth for what each installment received.
  const allocationRows: Array<{ installmentId: number; settlementTxId: number; amountCents: number }> = executor
    .select({
      installmentId: paylaterSettlementAllocations.installmentId,
      settlementTxId: paylaterSettlementAllocations.settlementTxId,
      amountCents: paylaterSettlementAllocations.amountCents,
    })
    .from(paylaterSettlementAllocations)
    .innerJoin(paylaterInstallments, eq(paylaterSettlementAllocations.installmentId, paylaterInstallments.id))
    .innerJoin(transactions, eq(paylaterSettlementAllocations.settlementTxId, transactions.id))
    .where(and(eq(paylaterInstallments.recognitionTxId, recognitionTxId), eq(transactions.status, "posted")))
    .all();
  const allocatedByInstallment = new Map<number, number>();
  const allocatedSettlementIds = new Set<number>();
  for (const allocation of allocationRows) {
    allocatedByInstallment.set(allocation.installmentId, (allocatedByInstallment.get(allocation.installmentId) ?? 0) + allocation.amountCents);
    allocatedSettlementIds.add(allocation.settlementTxId);
  }

  // Settlements posted before allocation rows existed carry no installment
  // evidence; apply their cash oldest-first so the schedule still reflects it.
  const settlementRows: Array<{ id: number; credit: number; debit: number }> = executor
    .select({ id: transactions.id, credit: transactionLines.credit, debit: transactionLines.debit })
    .from(transactions)
    .innerJoin(transactionLines, eq(transactionLines.transactionId, transactions.id))
    .where(and(
      eq(transactions.linkedTxId, recognitionTxId),
      eq(transactions.txType, "paylater_settlement"),
      eq(transactions.status, "posted"),
      eq(transactionLines.accountId, liabilityAccountId),
    ))
    .all();
  const legacyPaymentsCents = settlementRows
    .filter((row) => !allocatedSettlementIds.has(row.id))
    .reduce((sum, row) => sum + row.debit - row.credit, 0);

  let legacyRemaining = Math.max(0, legacyPaymentsCents);
  let allocatedCents = 0;
  const installments = rows.map((row) => {
    const allocated = allocatedByInstallment.get(row.id) ?? 0;
    allocatedCents += allocated;
    const legacy = Math.min(legacyRemaining, Math.max(0, row.totalCents - allocated));
    legacyRemaining -= legacy;
    const paidCents = allocated + legacy;
    return {
      row,
      paidCents,
      openCents: Math.max(0, row.totalCents - paidCents),
      financingOpenCents: Math.max(0, row.interestCents + row.feeCents - paidCents),
    };
  });
  return {
    liabilityOutstandingCents,
    installments,
    paymentsCents: allocatedCents + legacyPaymentsCents,
    scheduleOpenCents: installments.reduce((sum, item) => sum + item.openCents, 0),
  };
}

/**
 * What can still be paid on an obligation. With a schedule that is the open
 * schedule (which for obligations recognised without their financing cost is
 * more than the ledger liability); nothing once the liability is cleared.
 */
function payableCents(state: ObligationState): number {
  if (state.liabilityOutstandingCents <= 0) return 0;
  return state.installments.length > 0 ? state.scheduleOpenCents : state.liabilityOutstandingCents;
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
  status: "pending" | "paid" | "overdue" | "cancelled";
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
    // Always from the first due date, so a 31st-of-month plan is Feb 28/29
    // then Mar 31 instead of drifting permanently to the 28th.
    const dueDateMs = addMonthsFromAnchor(firstDueDateMs, i - 1);
    
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
// The plan's interest and admin fee are fixed at purchase, so they are posted
// with the principal: paying the full schedule then clears the liability
// exactly, and reversing the recognition reverses the financing cost too.
// Journal Entry:
//   Expense (Asset/Item)          Debit  $3,000
//   Expense - PayLater interest   Debit  $90
//   Expense - PayLater admin fee  Debit  $10
//   Accounts Payable - Paylater   Credit $3,100
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
    .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive, liquidityClass: accounts.liquidityClass })
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

  const lines: JournalLineInput[] = [
    {
      accountId: expenseAccount.id,
      debit: input.principalAmount,
      credit: 0,
      description: "Principal amount",
    },
  ];
  if (totalInterest > 0) {
    lines.push({ accountId: expenseAccount.id, debit: totalInterest, credit: 0, description: "PayLater interest" });
  }
  if (totalFees > 0) {
    lines.push({ accountId: expenseAccount.id, debit: totalFees, credit: 0, description: "PayLater admin fee" });
  }
  lines.push({
    accountId: input.paylaterLiabilityAccountId,
    debit: 0,
    credit: totalLiability,
    description: `Paylater liability (${input.installmentMonths}x installment)`,
  });

  // Create journal entry
  const journalEntry: CreateJournalEntryInput = {
    date: input.date,
    description: input.description,
    reference: input.reference,
    notes: input.notes,
    txType: "paylater_recognition",
    categoryId: input.categoryId ?? null,
    lines,
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

interface PaylaterSettlementPlan {
  allocations: Array<{ id: number; amount: number; fullyPaid: boolean }>;
  /** Part of the payment posted to expense instead of reducing the liability. */
  financingExpenseCents: number;
}

/** Validate a payment against the obligation and split it over installments and journal lines. */
function planPaylaterSettlementSync(executor: any, input: PaylaterSettlementInput): PaylaterSettlementPlan {
  if (input.originalTxId == null) return { allocations: [], financingExpenseCents: 0 };
  const state = loadObligationStateSync(executor, input.originalTxId, input.paylaterLiabilityAccountId);
  const payable = payableCents(state);
  if (input.paymentAmount > payable) {
    throw new Error(`Payment exceeds outstanding paylater liability (${payable})`);
  }
  // Legacy obligation without a schedule: the ledger balance is the whole debt.
  if (state.installments.length === 0) return { allocations: [], financingExpenseCents: 0 };

  const candidates = input.installmentIds
    ? state.installments.filter((item) => input.installmentIds!.includes(item.row.id))
    : state.installments.filter((item) => item.openCents > 0);
  if (input.installmentIds && candidates.length !== input.installmentIds.length) {
    throw new Error("One or more installments do not belong to the selected obligation");
  }
  const allocations: PaylaterSettlementPlan["allocations"] = [];
  let remaining = input.paymentAmount;
  let financingPaidCents = 0;
  for (const installment of candidates) {
    if (remaining <= 0) break;
    if (installment.openCents <= 0) continue;
    const amount = Math.min(installment.openCents, remaining);
    allocations.push({ id: installment.row.id, amount, fullyPaid: amount >= installment.openCents });
    financingPaidCents += Math.min(amount, installment.financingOpenCents);
    remaining -= amount;
  }
  // Do not silently attach a payment to no installment.
  if (remaining > 0) {
    throw new Error("Payment exceeds the outstanding installment schedule");
  }

  // Obligations recognised before the financing cost was posted at purchase
  // owe more than their ledger liability. That uncovered part of the schedule
  // is expensed as it is paid: the paid installments' interest and fee, and
  // never less than what keeps the liability from going below zero. For
  // obligations recognised with their financing cost this is always zero.
  const liability = state.liabilityOutstandingCents;
  const unrecognisedCents = Math.max(0, state.scheduleOpenCents - liability);
  const financingExpenseCents = Math.min(unrecognisedCents, Math.max(financingPaidCents, input.paymentAmount - liability));
  return { allocations, financingExpenseCents };
}

// Settlement: Make a payment (reduce liability, reduce cash)
// This is an asset-liability swap - NO expense impact, except for financing
// cost an older recognition never posted (see planPaylaterSettlementSync).
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
    .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive, liquidityClass: accounts.liquidityClass })
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

  let recognitionCategoryId: number | null = null;
  if (input.originalTxId != null) {
    const [recognition] = await db.select({ categoryId: transactions.categoryId }).from(transactions)
      .where(eq(transactions.id, input.originalTxId)).limit(1);
    recognitionCategoryId = recognition?.categoryId ?? null;
  }

  // Planned against the current state so the journal can be prepared (async)
  // before the write; the write transaction plans again and refuses to post if
  // the journal no longer matches.
  const plan = planPaylaterSettlementSync(db, input);
  const financingExpenseCents = plan.financingExpenseCents;
  const liabilityDebit = input.paymentAmount - financingExpenseCents;
  const lines: JournalLineInput[] = [];
  if (liabilityDebit > 0) {
    lines.push({
      accountId: input.paylaterLiabilityAccountId,
      debit: liabilityDebit,
      credit: 0,
      description: "Paylater payment - liability reduction",
    });
  }
  if (financingExpenseCents > 0) {
    const expenseAccount = await getOrCreateAutoExpenseAccount(db);
    lines.push({
      accountId: expenseAccount.id,
      debit: financingExpenseCents,
      credit: 0,
      description: "PayLater interest and fees not recognised at purchase",
    });
  }
  lines.push({
    accountId: input.bankAccountId,
    debit: 0,
    credit: input.paymentAmount,
    description: "Payment from bank",
    cashFlowClass: bankAccount.liquidityClass === "cash_equivalent" ? "financing" as const : undefined,
  });

  // Create journal entry
  const journalEntry: CreateJournalEntryInput = {
    date: input.date,
    description: input.description,
    reference: input.reference,
    notes: input.notes,
    txType: "paylater_settlement",
    linkedTxId: input.originalTxId,
    // Financing expensed here belongs with the purchase, like the cost posted at recognition.
    categoryId: financingExpenseCents > 0 ? recognitionCategoryId : null,
    lines,
  };

  const prepared = await prepareJournalEntry(journalEntry, db);
  const result = db.transaction((tx) => {
    // Inside the write transaction so two concurrent payments cannot both
    // spend the same balance.
    const current = planPaylaterSettlementSync(tx, input);
    if (current.financingExpenseCents !== financingExpenseCents) {
      throw new Error("PayLater obligation changed; retry the payment");
    }
    const { allocations } = current;
    const transactionId = insertPreparedJournalEntrySync(tx, prepared);
    if (allocations.length > 0) {
      tx.insert(paylaterSettlementAllocations).values(allocations.map((allocation) => ({
        settlementTxId: transactionId,
        installmentId: allocation.id,
        amountCents: allocation.amount,
      }))).run();
    }
    // paidCents/status are kept for the reversal guards; reads derive payments from allocation rows.
    for (const allocation of allocations) {
      const installmentRow = tx.select({ paidCents: paylaterInstallments.paidCents })
        .from(paylaterInstallments)
        .where(eq(paylaterInstallments.id, allocation.id)).limit(1).all()[0];
      if (!installmentRow) throw new Error("Installment disappeared during settlement");
      const nextPaid = Number(installmentRow.paidCents ?? 0) + allocation.amount;
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
        financingExpenseCents,
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

/**
 * Reverse a PayLater event while restoring the installment subledger.  Old
 * settlements without allocation rows are deliberately refused: guessing a
 * partial-payment allocation would corrupt the obligation schedule.
 */
export async function reversePaylaterTransaction(input: {
  transactionId: number;
  reason: string;
}): Promise<{ reversalTransactionId: number }> {
  if (!Number.isSafeInteger(input.transactionId) || input.transactionId <= 0) throw new Error("Invalid transaction id");
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) throw new Error("reason is required and must be at most 500 characters");
  const [original] = await db.select().from(transactions).where(eq(transactions.id, input.transactionId)).limit(1);
  if (!original || !["paylater_recognition", "paylater_interest", "paylater_settlement"].includes(original.txType)) {
    throw new Error("A PayLater recognition, interest, or settlement transaction is required");
  }
  const reversal = await prepareDomainReversal(input.transactionId, reason, db);
  const result = db.transaction((tx) => {
    const current = tx.select().from(transactions).where(eq(transactions.id, input.transactionId)).limit(1).all()[0];
    if (!current || current.status !== "posted" || current.txType !== original.txType) {
      throw new Error("PayLater transaction changed; retry reversal");
    }
    if (current.txType === "paylater_recognition") {
      const descendants = tx.select({ id: transactions.id }).from(transactions).where(and(
        eq(transactions.linkedTxId, current.id),
        eq(transactions.status, "posted"),
      )).all();
      if (descendants.length > 0) {
        throw new Error("Reverse linked PayLater interest and settlements before reversing the recognition");
      }
      const installments = tx.select().from(paylaterInstallments)
        .where(eq(paylaterInstallments.recognitionTxId, current.id)).all();
      if (installments.some((installment: typeof paylaterInstallments.$inferSelect) => Number(installment.paidCents ?? 0) !== 0)) {
        throw new Error("Cannot reverse a recognition with paid installments");
      }
      // The inverse journal also takes back the interest and admin fee posted with the principal.
      const reversalTransactionId = insertDomainReversalSync(tx, current.id, reversal.prepared, reason);
      tx.update(paylaterInstallments).set({ status: "cancelled", paidTxId: null })
        .where(eq(paylaterInstallments.recognitionTxId, current.id)).run();
      tx.insert(auditLogs).values({
        entityType: "paylater_recognition",
        entityId: current.id,
        action: "reverse",
        beforeSnapshot: Buffer.from(JSON.stringify({ transaction: current, installments })),
        afterSnapshot: Buffer.from(JSON.stringify({ reversalTransactionId, reason, installmentsStatus: "cancelled" })),
      }).run();
      return { reversalTransactionId };
    }

    if (current.txType === "paylater_settlement") {
      const allocations = tx.select().from(paylaterSettlementAllocations)
        .where(eq(paylaterSettlementAllocations.settlementTxId, current.id)).all();
      const linkedRecognitionId = current.linkedTxId;
      const scheduleCount = linkedRecognitionId == null ? 0 : tx.select({ id: paylaterInstallments.id })
        .from(paylaterInstallments).where(eq(paylaterInstallments.recognitionTxId, linkedRecognitionId)).all().length;
      if (scheduleCount > 0 && allocations.length === 0) {
        throw new Error("This legacy settlement has no allocation evidence and cannot be safely reversed");
      }
      for (const allocation of allocations) {
        const installment = tx.select().from(paylaterInstallments)
          .where(eq(paylaterInstallments.id, allocation.installmentId)).limit(1).all()[0];
        if (!installment || Number(installment.paidCents ?? 0) < allocation.amountCents) {
          throw new Error("Installment allocation is inconsistent; cannot safely reverse this settlement");
        }
      }
      const reversalTransactionId = insertDomainReversalSync(tx, current.id, reversal.prepared, reason);
      for (const allocation of allocations) {
        const installment = tx.select().from(paylaterInstallments)
          .where(eq(paylaterInstallments.id, allocation.installmentId)).limit(1).all()[0];
        const nextPaid = Number(installment.paidCents ?? 0) - allocation.amountCents;
        tx.update(paylaterInstallments).set({
          paidCents: nextPaid,
          status: nextPaid >= installment.totalCents ? "paid" : "pending",
          paidTxId: null,
        }).where(eq(paylaterInstallments.id, installment.id)).run();
      }
      tx.insert(auditLogs).values({
        entityType: "paylater_settlement",
        entityId: current.id,
        action: "reverse",
        beforeSnapshot: Buffer.from(JSON.stringify({ transaction: current, allocations })),
        afterSnapshot: Buffer.from(JSON.stringify({ reversalTransactionId, reason })),
      }).run();
      return { reversalTransactionId };
    }

    const reversalTransactionId = insertDomainReversalSync(tx, current.id, reversal.prepared, reason);
    tx.insert(auditLogs).values({
      entityType: "paylater_interest",
      entityId: current.id,
      action: "reverse",
      beforeSnapshot: Buffer.from(JSON.stringify(current)),
      afterSnapshot: Buffer.from(JSON.stringify({ reversalTransactionId, reason })),
    }).run();
    return { reversalTransactionId };
  });
  await invalidateOnTransactionMutation({
    transactionId: result.reversalTransactionId,
    affectedAccountIds: reversal.prepared.accountIds,
    affectedPeriodIds: [reversal.originalPeriodId, reversal.periodId].filter((id): id is number => id != null),
    revisionBumped: true,
  });
  return result;
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
export async function getPaylaterObligations(query: { liabilityAccountId?: number; recognitionTxId?: number } = {}): Promise<PaylaterObligationsPayload> {
  const recognitionConditions = [
    eq(transactions.txType, "paylater_recognition"),
    eq(transactions.status, "posted"),
    query.recognitionTxId == null ? undefined : eq(transactions.id, query.recognitionTxId),
    query.liabilityAccountId == null ? undefined : sql`EXISTS (
      SELECT 1 FROM transaction_line obligation_line
      WHERE obligation_line.transaction_id = ${transactions.id}
        AND obligation_line.account_id = ${query.liabilityAccountId}
        AND obligation_line.credit > obligation_line.debit
    )`,
  ];
  const recognitions = await db
    .select()
    .from(transactions)
    .where(and(...recognitionConditions))
    .orderBy(desc(transactions.date));

  const obligations: PaylaterObligation[] = [];
  const scheduleItems: PaylaterScheduleItem[] = [];

  let totalOutstandingCents = 0;

  for (const tx of recognitions) {
    const meta = await recognitionLiabilityMeta(tx.id);
    if (!meta) continue;

    const dateRecognizedMs = tx.date instanceof Date ? tx.date.getTime() : (tx.date as number);
    
    const state = loadObligationStateSync(db, tx.id, meta.liabilityAccountId);
    const hasSchedule = state.installments.length > 0;

    const children = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.linkedTxId, tx.id), eq(transactions.status, "posted")));

    // With a schedule, the recognition credits principal plus the financing cost
    // posted at purchase (none for obligations recognised before that was done).
    const principalCents = hasSchedule
      ? state.installments.reduce((sum, item) => sum + item.row.principalCents, 0)
      : meta.principalCents;
    let interestPostedCents = Math.max(0, (await sumLiabilityCreditsForTx(tx.id)) - principalCents);
    let paymentsPostedCents = state.paymentsCents;

    for (const ch of children) {
      if (ch.txType === "paylater_interest") {
        interestPostedCents += await sumLiabilityCreditsForTx(ch.id);
      } else if (ch.txType === "paylater_settlement" && !hasSchedule) {
        paymentsPostedCents += await sumLiabilityDebitsForTx(ch.id);
      }
    }

    // Payments are read from allocation rows, never from installment flags,
    // so partial payments count exactly once. The open schedule is what is
    // still owed; for obligations recognised before the financing cost was
    // posted at purchase it includes that cost, which is expensed as it is paid.
    const outstandingCents = payableCents(state);
    const pendingInstallments = outstandingCents > 0 ? state.installments.filter((item) => item.openCents > 0) : [];

    totalOutstandingCents += outstandingCents;

    // Determine status based on next pending installment
    const dueDateMs = pendingInstallments[0]?.row.dueDate.getTime() ?? (tx.dueDate
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
      if (isPastDue(dueDateMs)) {
        status = "overdue";
      } else if (daysUntilDue <= 7) {
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
      principalCents,
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
      obligation.installments = state.installments.map(({ row: inst, paidCents, openCents }) => ({
        id: inst.id,
        installmentNumber: inst.installmentNumber,
        totalInstallments: inst.totalInstallments,
        dueDate: inst.dueDate.getTime(),
        principalCents: inst.principalCents,
        interestCents: inst.interestCents,
        feeCents: inst.feeCents,
        totalCents: inst.totalCents,
        paidCents,
        status: openCents <= 0 || outstandingCents <= 0 ? "paid" : isPastDue(inst.dueDate.getTime()) ? "overdue" : "pending",
        paidTxId: inst.paidTxId,
      }));
    }

    obligations.push(obligation);

    // Add pending installments to schedule
    for (const { row: inst, openCents } of pendingInstallments) {
      scheduleItems.push({
        dateMs: inst.dueDate.getTime(),
        kind: "installment",
        recognitionTxId: tx.id,
        transactionId: inst.id,
        description: `${tx.description} - Installment ${inst.installmentNumber}/${inst.totalInstallments}`,
        amountCents: openCents,
        liabilityAccountId: meta.liabilityAccountId,
        liabilityAccountName: meta.liabilityAccountName,
        installmentNumber: inst.installmentNumber,
      });
    }

    // Backward compatibility: add old-style schedule items
    if (!hasSchedule && outstandingCents > 0 && dueDateMs != null) {
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

  const todayStart = startOfLocalDay(Date.now());
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
