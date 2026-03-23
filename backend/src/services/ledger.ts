import { and, eq, sql } from "drizzle-orm";

import { accounts, transactionLines, transactions } from "../db/schema";
import { db as defaultDb } from "../db/client";
import { invalidateAndRecomputeOnTransactionMutation } from "../cache/invalidation";

export type JournalLineInput = {
  accountId: number;
  debit: number; // cents
  credit: number; // cents
  description?: string;
};

export type CreateJournalEntryInput = {
  date: Date | number;
  /** Optional due date (ms epoch), e.g. next installment for paylater flows */
  dueDate?: number | null;
  description: string;
  reference?: string | null;
  notes?: string | null;
  /** Optional place/location where the transaction occurred */
  place?: string | null;
  txType?: string;
  periodId?: number | null;
  linkedTxId?: number | null;
  categoryId?: number | null;
  lines: JournalLineInput[];
  /** Transport location tracking (for GoRide, Grab, etc.) */
  originLat?: number | null;
  originLng?: number | null;
  originName?: string | null;
  destLat?: number | null;
  destLng?: number | null;
  destName?: string | null;
  distanceKm?: number | null;
};

function assertIntegerCents(value: unknown, fieldName: string): asserts value is number {
  if (!Number.isInteger(value)) {
    throw new Error(`${fieldName} must be a non-negative integer (cents)`);
  }
  const cents = value as number;
  if (cents < 0) {
    throw new Error(`${fieldName} must be a non-negative integer (cents)`);
  }
}

function normalBalanceSign(accountType: string): 1 | -1 {
  if (accountType === "asset") return 1;
  if (accountType === "expense") return 1;
  if (accountType === "liability") return -1;
  if (accountType === "equity") return -1;
  if (accountType === "revenue") return -1;
  throw new Error(`Unsupported account type: ${accountType}`);
}

const SYSTEM_KEYS = {
  autoIncome: "auto-income",
  autoExpense: "auto-expense",
} as const;

let autoIncomeAccountCache: { id: number } | null = null;
let autoExpenseAccountCache: { id: number } | null = null;

async function getOrCreateAutoIncomeAccount(dbLike: any): Promise<{ id: number }> {
  if (autoIncomeAccountCache) return autoIncomeAccountCache;

  const [existing] = await dbLike
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.systemKey, SYSTEM_KEYS.autoIncome))
    .limit(1);

  if (existing) {
    autoIncomeAccountCache = existing;
    return existing;
  }

  const [created] = await dbLike
    .insert(accounts)
    .values({
      name: "Income (Auto)",
      type: "revenue",
      isActive: true,
      systemKey: SYSTEM_KEYS.autoIncome,
    })
    .returning({ id: accounts.id });

  autoIncomeAccountCache = created;
  return created;
}

async function getOrCreateAutoExpenseAccount(dbLike: any): Promise<{ id: number }> {
  if (autoExpenseAccountCache) return autoExpenseAccountCache;

  const [existing] = await dbLike
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.systemKey, SYSTEM_KEYS.autoExpense))
    .limit(1);

  if (existing) {
    autoExpenseAccountCache = existing;
    return existing;
  }

  const [created] = await dbLike
    .insert(accounts)
    .values({
      name: "Expense (Auto)",
      type: "expense",
      isActive: true,
      systemKey: SYSTEM_KEYS.autoExpense,
    })
    .returning({ id: accounts.id });

  autoExpenseAccountCache = created;
  return created;
}

export type SimpleTransactionKind = "expense" | "income" | "transfer";

export type CreateSimpleTransactionInput = {
  kind: SimpleTransactionKind;
  amountCents: number;
  description: string;
  notes?: string | null;
  /** Optional place/location where the transaction occurred */
  place?: string | null;
  date: Date | number;
  periodId?: number | null;
  txType?: string;
  categoryId?: number | null;
  reference?: string | null;
  /** Primary wallet for expense/income */
  walletAccountId: number;
  /** For transfer: the other wallet */
  toWalletAccountId?: number;
  /** Link to parent transaction (e.g., transfer fee linked to transfer) */
  linkedTxId?: number | null;
  /** Transport location tracking (for GoRide, Grab, etc.) */
  originLat?: number | null;
  originLng?: number | null;
  originName?: string | null;
  destLat?: number | null;
  destLng?: number | null;
  destName?: string | null;
  distanceKm?: number | null;
};

/**
 * User-friendly posting: builds balanced journal lines from amount + kind.
 * Expense: Dr Expense (auto), Cr Asset (wallet)
 * Income: Dr Asset (wallet), Cr Revenue (auto)
 * Transfer: Dr to-wallet, Cr from-wallet
 */
export async function createSimpleTransaction(
  input: CreateSimpleTransactionInput,
  dbLike: any = defaultDb,
): Promise<{ transactionId: number; balancesByAccountId: Record<number, number> }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("amountCents must be a positive integer (cents)");
  }

  const [wallet] = await dbLike
    .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive })
    .from(accounts)
    .where(eq(accounts.id, input.walletAccountId))
    .limit(1);

  if (!wallet) throw new Error(`Wallet account not found: ${input.walletAccountId}`);
  if (!wallet.isActive) throw new Error("Wallet account is not active");
  if (wallet.type !== "asset") throw new Error("Wallet must be an asset account");

  const lines: JournalLineInput[] = [];

  if (input.kind === "expense") {
    const exp = await getOrCreateAutoExpenseAccount(dbLike);
    lines.push(
      { accountId: exp.id, debit: input.amountCents, credit: 0, description: input.description },
      { accountId: wallet.id, debit: 0, credit: input.amountCents, description: input.description },
    );
  } else if (input.kind === "income") {
    const inc = await getOrCreateAutoIncomeAccount(dbLike);
    lines.push(
      { accountId: wallet.id, debit: input.amountCents, credit: 0, description: input.description },
      { accountId: inc.id, debit: 0, credit: input.amountCents, description: input.description },
    );
  } else {
    const toId = input.toWalletAccountId;
    if (!toId) throw new Error("toWalletAccountId is required for transfer");
    const [toWallet] = await dbLike
      .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive })
      .from(accounts)
      .where(eq(accounts.id, toId))
      .limit(1);
    if (!toWallet) throw new Error(`Destination wallet not found: ${toId}`);
    if (!toWallet.isActive) throw new Error("Destination wallet is not active");
    if (toWallet.type !== "asset") throw new Error("Destination must be an asset account");
    if (toWallet.id === wallet.id) throw new Error("Cannot transfer to the same wallet");

    lines.push(
      { accountId: toWallet.id, debit: input.amountCents, credit: 0, description: input.description },
      { accountId: wallet.id, debit: 0, credit: input.amountCents, description: input.description },
    );
  }

  return createJournalEntry(
    {
      date: input.date,
      description: input.description,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      place: input.place ?? null,
      txType: input.txType ?? `simple_${input.kind}`,
      periodId: input.periodId ?? null,
      categoryId: input.categoryId ?? null,
      linkedTxId: input.linkedTxId ?? null,
      lines,
      // Transport location fields
      originLat: input.originLat ?? null,
      originLng: input.originLng ?? null,
      originName: input.originName ?? null,
      destLat: input.destLat ?? null,
      destLng: input.destLng ?? null,
      destName: input.destName ?? null,
      distanceKm: input.distanceKm ?? null,
    },
    dbLike,
  );
}

/** Expense for subscription/card charge: Dr Expense, Cr asset wallet OR Cr liability (e.g. credit card). */
export async function createSubscriptionRenewalExpense(
  input: {
    amountCents: number;
    description: string;
    notes?: string | null;
    date: Date | number;
    periodId?: number | null;
    categoryId?: number | null;
    payingAccountId: number;
    reference?: string | null;
  },
  dbLike: any = defaultDb,
): Promise<{ transactionId: number; balancesByAccountId: Record<number, number> }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("amountCents must be a positive integer");
  }

  const [acct] = await dbLike
    .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive })
    .from(accounts)
    .where(eq(accounts.id, input.payingAccountId))
    .limit(1);

  if (!acct) throw new Error(`Payment account not found: ${input.payingAccountId}`);
  if (!acct.isActive) throw new Error("Payment account is not active");

  if (acct.type === "asset") {
    return createSimpleTransaction(
      {
        kind: "expense",
        amountCents: input.amountCents,
        description: input.description,
        notes: input.notes ?? null,
        date: input.date,
        periodId: input.periodId ?? null,
        categoryId: input.categoryId ?? null,
        reference: input.reference ?? null,
        walletAccountId: acct.id,
        txType: "subscription_renewal",
      },
      dbLike,
    );
  }

  if (acct.type === "liability") {
    const exp = await getOrCreateAutoExpenseAccount(dbLike);
    return createJournalEntry(
      {
        date: input.date,
        description: input.description,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        txType: "subscription_renewal",
        periodId: input.periodId ?? null,
        categoryId: input.categoryId ?? null,
        lines: [
          { accountId: exp.id, debit: input.amountCents, credit: 0, description: input.description },
          { accountId: acct.id, debit: 0, credit: input.amountCents, description: input.description },
        ],
      },
      dbLike,
    );
  }

  throw new Error(
    `Subscription auto-pay requires an asset (wallet) or liability (card) account; got type "${acct.type}"`,
  );
}

export async function computeTrialBalanceTotals(dbLike: any = defaultDb) {
  const rows = await dbLike
    .select({
      debitTotal: sql<number>`coalesce(sum(${transactionLines.debit}), 0)`,
      creditTotal: sql<number>`coalesce(sum(${transactionLines.credit}), 0)`,
    })
    .from(transactionLines);

  const debitTotal = rows[0]?.debitTotal ?? 0;
  const creditTotal = rows[0]?.creditTotal ?? 0;
  return {
    debitTotal,
    creditTotal,
    isBalanced: debitTotal === creditTotal,
  };
}

export async function computeAccountBalance(
  accountId: number,
  dbLike: any = defaultDb,
): Promise<number> {
  const [account] = await dbLike.select({ type: accounts.type }).from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!account) throw new Error(`Account not found: ${accountId}`);

  const [sums] = await dbLike
    .select({
      debitSum: sql<number>`coalesce(sum(${transactionLines.debit}), 0)`,
      creditSum: sql<number>`coalesce(sum(${transactionLines.credit}), 0)`,
    })
    .from(transactionLines)
    .where(eq(transactionLines.accountId, accountId));

  const debitSum = sums?.debitSum ?? 0;
  const creditSum = sums?.creditSum ?? 0;

  const sign = normalBalanceSign(account.type);
  return sign === 1 ? debitSum - creditSum : creditSum - debitSum;
}

/** Balance including only transaction lines on or before `asOfInclusiveMs`. */
export async function computeAccountBalanceAsOf(
  accountId: number,
  asOfInclusiveMs: number,
  dbLike: any = defaultDb,
): Promise<number> {
  const [account] = await dbLike
    .select({ type: accounts.type })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!account) throw new Error(`Account not found: ${accountId}`);

  const [sums] = await dbLike
    .select({
      debitSum: sql<number>`coalesce(sum(${transactionLines.debit}), 0)`,
      creditSum: sql<number>`coalesce(sum(${transactionLines.credit}), 0)`,
    })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
    .where(
      and(eq(transactionLines.accountId, accountId), sql`${transactions.date} <= ${asOfInclusiveMs}`),
    );

  const debitSum = sums?.debitSum ?? 0;
  const creditSum = sums?.creditSum ?? 0;
  const sign = normalBalanceSign(account.type);
  return sign === 1 ? debitSum - creditSum : creditSum - debitSum;
}

/** No account hierarchy — same as direct balance */
export async function computeAccountBalanceRolledUp(
  accountId: number,
  dbLike: any = defaultDb,
): Promise<number> {
  return computeAccountBalance(accountId, dbLike);
}

export async function createJournalEntry(
  input: CreateJournalEntryInput,
  dbLike: any = defaultDb,
): Promise<{ transactionId: number; balancesByAccountId: Record<number, number> }> {
  if (!input.lines.length) throw new Error("Journal entry must include at least one line");

  const dateMs = typeof input.date === "number" ? input.date : input.date.getTime();
  if (!Number.isFinite(dateMs)) throw new Error("Invalid journal entry date");

  const validatedLines = input.lines.map((line) => {
    assertIntegerCents(line.debit, "debit");
    assertIntegerCents(line.credit, "credit");
    if (!Number.isInteger(line.accountId) || line.accountId <= 0) {
      throw new Error("accountId must be a positive integer");
    }
    return line;
  });

  let totalDebit = validatedLines.reduce((sum, l) => sum + l.debit, 0);
  let totalCredit = validatedLines.reduce((sum, l) => sum + l.credit, 0);

  if (totalDebit !== totalCredit) {
    const difference = totalDebit - totalCredit;
    if (difference > 0) {
      const autoIncomeAccount = await getOrCreateAutoIncomeAccount(dbLike);
      validatedLines.push({
        accountId: autoIncomeAccount.id,
        debit: 0,
        credit: difference,
        description: "Auto-balanced: Income",
      });
    } else if (difference < 0) {
      const autoExpenseAccount = await getOrCreateAutoExpenseAccount(dbLike);
      validatedLines.push({
        accountId: autoExpenseAccount.id,
        debit: -difference,
        credit: 0,
        description: "Auto-balanced: Expense",
      });
    }
    totalDebit = validatedLines.reduce((sum, l) => sum + l.debit, 0);
    totalCredit = validatedLines.reduce((sum, l) => sum + l.credit, 0);
  }

  if (totalDebit !== totalCredit) {
    throw new Error(`Journal entry is not balanced: debits=${totalDebit} credits=${totalCredit}`);
  }

  const accountIds = Array.from(new Set(validatedLines.map((l) => l.accountId)));
  for (const accountId of accountIds) {
    const rows = await dbLike
      .select({ isActive: accounts.isActive })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);
    const account = rows[0];
    if (!account) throw new Error(`Account not found: ${accountId}`);
    if (!account.isActive) throw new Error(`Account is not active: ${accountId}`);
  }

  const uniqueReferencedAccountIds = accountIds;

  const dueMs =
    input.dueDate == null || input.dueDate === undefined
      ? null
      : typeof input.dueDate === "number"
        ? input.dueDate
        : NaN;
  if (dueMs != null && !Number.isFinite(dueMs)) {
    throw new Error("Invalid due date");
  }

  const inserted = await dbLike
    .insert(transactions)
    .values({
      date: new Date(dateMs),
      dueDate: dueMs != null ? new Date(dueMs) : null,
      description: input.description,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      place: input.place ?? null,
      txType: input.txType ?? "manual",
      periodId: input.periodId ?? null,
      linkedTxId: input.linkedTxId ?? null,
      categoryId: input.categoryId ?? null,
      // Transport location fields
      originLat: input.originLat ?? null,
      originLng: input.originLng ?? null,
      originName: input.originName ?? null,
      destLat: input.destLat ?? null,
      destLng: input.destLng ?? null,
      destName: input.destName ?? null,
      distanceKm: input.distanceKm ?? null,
    })
    .returning({ id: transactions.id });

  const transactionId = inserted[0]?.id;
  if (!transactionId) throw new Error("Failed to create transaction row");

  await dbLike.insert(transactionLines).values(
    validatedLines.map((l) => ({
      transactionId,
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      description: l.description ?? null,
    })),
  );

  const lineSums = await dbLike
    .select({
      debitTotal: sql<number>`coalesce(sum(${transactionLines.debit}), 0)`,
      creditTotal: sql<number>`coalesce(sum(${transactionLines.credit}), 0)`,
    })
    .from(transactionLines)
    .where(eq(transactionLines.transactionId, transactionId));

  const d = lineSums[0]?.debitTotal ?? 0;
  const c = lineSums[0]?.creditTotal ?? 0;
  if (d !== c) {
    throw new Error(`Transaction lines not balanced: debits=${d} credits=${c}`);
  }

  const balancesByAccountId: Record<number, number> = {};
  for (const accountId of uniqueReferencedAccountIds) {
    balancesByAccountId[accountId] = await computeAccountBalance(accountId, dbLike);
  }

  const result = { transactionId, balancesByAccountId };

  invalidateAndRecomputeOnTransactionMutation({
    transactionId: result.transactionId,
    affectedAccountIds: uniqueReferencedAccountIds,
    affectedPeriodIds: input.periodId ? [input.periodId] : undefined,
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Cache invalidation failed:", err);
  });

  return result;
}
