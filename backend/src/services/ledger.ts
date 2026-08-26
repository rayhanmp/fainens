import { and, eq, sql } from "drizzle-orm";

import { accounts, auditLogs, categories, tags, transactionCategoryAllocations, transactionLines, transactions, transactionTags } from "../db/schema";
import { db as defaultDb } from "../db/client";
import { invalidateOnTransactionMutation } from "../cache/invalidation";
import { validateJournalLines } from "./journal-validation";
import { bumpFinancialRevisionSync } from "./financial-revision";
import {
  assertJournalPeriodOpen,
  assertPreparedJournalPeriodOpenSync,
} from "./period-locking";

export type JournalLineInput = {
  accountId: number;
  debit: number; // cents
  credit: number; // cents
  description?: string;
  cashFlowClass?: "operating" | "investing" | "financing" | "transfer" | "recovery" | null;
};

export type CategoryAllocationInput = { categoryId: number; amount: number };

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
  reversalOfTxId?: number | null;
  periodId?: number | null;
  linkedTxId?: number | null;
  categoryId?: number | null;
  /** Signed net-expense amounts. Required for new multi-category expense journals. */
  categoryAllocations?: CategoryAllocationInput[];
  lines: JournalLineInput[];
  /** Transport location tracking (for GoRide, Grab, etc.) */
  originLat?: number | null;
  originLng?: number | null;
  originName?: string | null;
  destLat?: number | null;
  destLng?: number | null;
  destName?: string | null;
  distanceKm?: number | null;
  /** Optional subscription this transaction pays for (advances subscription renewal) */
  subscriptionId?: number | null;
  tagIds?: number[];
};

/**
 * Normalized journal data ready for insertion.  Validation that needs async
 * Drizzle reads happens before a domain transaction starts; the actual insert
 * is deliberately synchronous so it can be used inside better-sqlite3's
 * transaction callback.
 */
export type PreparedJournalEntry = {
  dateMs: number;
  periodId: number | null;
  validatedLines: JournalLineInput[];
  totalDebit: number;
  totalCredit: number;
  accountIds: number[];
  tagIds: number[];
  categoryAllocations: CategoryAllocationInput[];
  transactionValues: Record<string, unknown>;
};

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
  historicalRecoveryEquity: "historical-recovery-equity",
} as const;

async function getOrCreateSystemAccount(
  systemKey: string,
  name: string,
  type: "revenue" | "expense" | "equity",
  dbLike: any,
): Promise<{ id: number }> {
  const [existing] = await dbLike
    .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive, liquidityClass: accounts.liquidityClass })
    .from(accounts)
    .where(eq(accounts.systemKey, systemKey))
    .limit(1);
  if (existing) {
    if (!existing.isActive || existing.type !== type) {
      throw new Error(`System account ${systemKey} must be an active ${type} account`);
    }
    return { id: existing.id };
  }

  try {
    const [created] = await dbLike
      .insert(accounts)
      .values({ name, type, isActive: true, systemKey })
      .returning({ id: accounts.id });
    if (!created) throw new Error(`Failed to create system account ${systemKey}`);
    return created;
  } catch (error) {
    // Another writer may have won the unique(system_key) race. Re-select in
    // the current executor instead of retaining an ID from another DB/tx.
    const [winner] = await dbLike
      .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive })
      .from(accounts)
      .where(eq(accounts.systemKey, systemKey))
      .limit(1);
    if (!winner) throw error;
    if (!winner.isActive || winner.type !== type) {
      throw new Error(`System account ${systemKey} must be an active ${type} account`);
    }
    return { id: winner.id };
  }
}

export async function getOrCreateAutoIncomeAccount(dbLike: any = defaultDb): Promise<{ id: number }> {
  return getOrCreateSystemAccount(SYSTEM_KEYS.autoIncome, "Income (Auto)", "revenue", dbLike);
}

export async function getOrCreateAutoExpenseAccount(dbLike: any = defaultDb): Promise<{ id: number }> {
  return getOrCreateSystemAccount(SYSTEM_KEYS.autoExpense, "Expense (Auto)", "expense", dbLike);
}

/**
 * Counterpart for a user-approved return-after-absence balance bridge. It is
 * equity deliberately: unknown historical movement is neither income nor an
 * expense and must not contaminate cash-flow or budget reporting.
 */
export async function getOrCreateHistoricalRecoveryEquityAccount(dbLike: any = defaultDb): Promise<{ id: number }> {
  return getOrCreateSystemAccount(
    SYSTEM_KEYS.historicalRecoveryEquity,
    "Historical recovery adjustment",
    "equity",
    dbLike,
  );
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
  categoryAllocations?: CategoryAllocationInput[];
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
  /** Optional subscription this transaction pays for (advances subscription renewal) */
  subscriptionId?: number | null;
  tagIds?: number[];
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
    .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive, liquidityClass: accounts.liquidityClass })
    .from(accounts)
    .where(eq(accounts.id, input.walletAccountId))
    .limit(1);

  if (!wallet) throw new Error(`Wallet account not found: ${input.walletAccountId}`);
  if (!wallet.isActive) throw new Error("Wallet account is not active");
  if (wallet.type !== "asset") throw new Error("Wallet must be an asset account");

  const lines: JournalLineInput[] = [];

  if (input.kind === "expense") {
    let exp = await getOrCreateAutoExpenseAccount(dbLike);
    if (input.categoryId != null) {
      const [category] = await dbLike.select({ reportingAccountId: categories.reportingAccountId })
        .from(categories).where(eq(categories.id, input.categoryId)).limit(1);
      if (!category) throw new Error(`Category not found: ${input.categoryId}`);
      if (category.reportingAccountId != null) {
        const [reportingAccount] = await dbLike.select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive })
          .from(accounts).where(eq(accounts.id, category.reportingAccountId)).limit(1);
        if (!reportingAccount || !reportingAccount.isActive || reportingAccount.type !== "expense") {
          throw new Error("Category reporting account must be an active expense account");
        }
        exp = { id: reportingAccount.id };
      }
    }
    lines.push(
      { accountId: exp.id, debit: input.amountCents, credit: 0, description: input.description },
      { accountId: wallet.id, debit: 0, credit: input.amountCents, description: input.description, cashFlowClass: wallet.liquidityClass === "cash_equivalent" ? "operating" : undefined },
    );
  } else if (input.kind === "income") {
    const inc = await getOrCreateAutoIncomeAccount(dbLike);
    lines.push(
      { accountId: wallet.id, debit: input.amountCents, credit: 0, description: input.description, cashFlowClass: wallet.liquidityClass === "cash_equivalent" ? "operating" : undefined },
      { accountId: inc.id, debit: 0, credit: input.amountCents, description: input.description },
    );
  } else {
    const toId = input.toWalletAccountId;
    if (!toId) throw new Error("toWalletAccountId is required for transfer");
    const [toWallet] = await dbLike
      .select({ id: accounts.id, type: accounts.type, isActive: accounts.isActive, liquidityClass: accounts.liquidityClass })
      .from(accounts)
      .where(eq(accounts.id, toId))
      .limit(1);
    if (!toWallet) throw new Error(`Destination wallet not found: ${toId}`);
    if (!toWallet.isActive) throw new Error("Destination wallet is not active");
    if (toWallet.type !== "asset") throw new Error("Destination must be an asset account");
    if (toWallet.id === wallet.id) throw new Error("Cannot transfer to the same wallet");

    const sourceIsCash = wallet.liquidityClass === "cash_equivalent";
    const destinationIsCash = toWallet.liquidityClass === "cash_equivalent";
    lines.push(
      { accountId: toWallet.id, debit: input.amountCents, credit: 0, description: input.description, cashFlowClass: destinationIsCash ? (sourceIsCash ? "transfer" : "investing") : undefined },
      { accountId: wallet.id, debit: 0, credit: input.amountCents, description: input.description, cashFlowClass: sourceIsCash ? (destinationIsCash ? "transfer" : "investing") : undefined },
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
      categoryAllocations: input.categoryAllocations,
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
      // Subscription payment
      subscriptionId: input.subscriptionId ?? null,
      tagIds: input.tagIds,
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
  const now = Date.now();
  const rows = await dbLike
    .select({
      debitTotal: sql<number>`coalesce(sum(${transactionLines.debit}), 0)`,
      creditTotal: sql<number>`coalesce(sum(${transactionLines.credit}), 0)`,
    })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
    .where(and(sql`${transactions.date} <= ${now}`, sql`${transactions.status} <> 'draft'`));

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
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
    .where(
      and(
        eq(transactionLines.accountId, accountId),
        sql`${transactions.date} <= ${Date.now()}`,
        sql`${transactions.status} <> 'draft'`,
      ),
    );

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
      and(
        eq(transactionLines.accountId, accountId),
        sql`${transactions.date} <= ${asOfInclusiveMs}`,
        sql`${transactions.status} <> 'draft'`,
      ),
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

/** Validate all journal references and normalize values before a write. */
export async function prepareJournalEntry(
  input: CreateJournalEntryInput,
  dbLike: any = defaultDb,
): Promise<PreparedJournalEntry> {
  const dateMs = typeof input.date === "number" ? input.date : input.date.getTime();
  if (!Number.isFinite(dateMs)) throw new Error("Invalid journal entry date");

  const { lines: validatedLines, totalDebit, totalCredit } = validateJournalLines(input.lines);
  const accountIds = Array.from(new Set(validatedLines.map((l) => l.accountId)));
  const accountById = new Map<number, { type: string; liquidityClass: string }>();
  for (const accountId of accountIds) {
    const rows = await dbLike
    .select({ id: accounts.id, isActive: accounts.isActive, type: accounts.type, liquidityClass: accounts.liquidityClass })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);
    const account = rows[0];
    if (!account) throw new Error(`Account not found: ${accountId}`);
    if (!account.isActive) throw new Error(`Account is not active: ${accountId}`);
    accountById.set(account.id, { type: account.type, liquidityClass: account.liquidityClass });
  }

  for (const line of validatedLines) {
    const account = accountById.get(line.accountId);
    if (account?.liquidityClass === "cash_equivalent" && line.cashFlowClass == null) {
      throw new Error(`Cash-equivalent account line ${line.accountId} requires cashFlowClass`);
    }
    if (account?.liquidityClass !== "cash_equivalent" && line.cashFlowClass != null) {
      throw new Error(`cashFlowClass may be set only on cash-equivalent account lines (account ${line.accountId})`);
    }
    if (line.cashFlowClass === "recovery" && input.txType !== "historical_recovery_adjustment") {
      throw new Error("cashFlowClass recovery is reserved for the recovery reconciliation workflow");
    }
  }
  const accountTypeById = new Map([...accountById].map(([id, account]) => [id, account.type]));
  const netExpense = validatedLines.reduce((sum, line) =>
    accountTypeById.get(line.accountId) === "expense" ? sum + line.debit - line.credit : sum, 0);
  const suppliedAllocations = input.categoryAllocations ?? (input.categoryId != null && netExpense !== 0
    ? [{ categoryId: input.categoryId, amount: netExpense }] : []);
  const categoryAllocations = suppliedAllocations.map((allocation) => ({
    categoryId: Number(allocation.categoryId), amount: Number(allocation.amount),
  }));
  if (categoryAllocations.some((allocation) => !Number.isInteger(allocation.categoryId) || allocation.categoryId <= 0 || !Number.isSafeInteger(allocation.amount) || allocation.amount === 0)) {
    throw new Error("categoryAllocations must contain positive category IDs and non-zero integer amounts");
  }
  if (new Set(categoryAllocations.map((allocation) => allocation.categoryId)).size !== categoryAllocations.length) {
    throw new Error("A category may appear only once per journal allocation");
  }
  if (categoryAllocations.reduce((sum, allocation) => sum + allocation.amount, 0) !== netExpense) {
    throw new Error("category allocations must equal the journal's net expense amount");
  }
  if (categoryAllocations.length > 0) {
    const validCategories = await dbLike.select({ id: categories.id }).from(categories)
      .where(sql`${categories.id} IN (${sql.join(categoryAllocations.map((allocation) => sql`${allocation.categoryId}`), sql`, `)})`);
    if (validCategories.length !== categoryAllocations.length) throw new Error("One or more allocation categories do not exist");
  }

  const tagIds = [...new Set(input.tagIds ?? [])];
  if (tagIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error("tagIds must contain positive integers");
  }
  if (tagIds.length > 0) {
    const existingTags = await dbLike
      .select({ id: tags.id })
      .from(tags)
      .where(sql`${tags.id} IN (${sql.join(tagIds.map((id) => sql`${id}`), sql`, `)})`);
    if (existingTags.length !== tagIds.length) throw new Error("One or more tags do not exist");
  }

  const dueMs =
    input.dueDate == null || input.dueDate === undefined
      ? null
      : typeof input.dueDate === "number"
        ? input.dueDate
        : NaN;
  if (dueMs != null && !Number.isFinite(dueMs)) {
    throw new Error("Invalid due date");
  }
  const periodId = await assertJournalPeriodOpen(dateMs, input.periodId, dbLike);

  return {
    dateMs,
    periodId,
    validatedLines,
    totalDebit,
    totalCredit,
    accountIds,
    tagIds,
    categoryAllocations,
    transactionValues: {
      date: new Date(dateMs),
      dueDate: dueMs != null ? new Date(dueMs) : null,
      description: input.description,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      place: input.place ?? null,
      txType: input.txType ?? "manual",
      status: "posted",
      periodId,
      linkedTxId: input.linkedTxId ?? null,
      reversalOfTxId: input.reversalOfTxId ?? null,
      categoryId: input.categoryId ?? null,
      originLat: input.originLat ?? null,
      originLng: input.originLng ?? null,
      originName: input.originName ?? null,
      destLat: input.destLat ?? null,
      destLng: input.destLng ?? null,
      destName: input.destName ?? null,
      distanceKm: input.distanceKm ?? null,
      subscriptionId: input.subscriptionId ?? null,
    },
  };
}

/**
 * Insert a prepared journal synchronously into an existing better-sqlite3
 * transaction.  Any thrown constraint or verification error rolls back the
 * caller's outer transaction.
 */
export function insertPreparedJournalEntrySync(tx: any, prepared: PreparedJournalEntry): number {
  assertPreparedJournalPeriodOpenSync(tx, prepared);
  const inserted = tx
    .insert(transactions)
    .values(prepared.transactionValues)
    .returning({ id: transactions.id })
    .all();
  const id = inserted[0]?.id;
  if (!id) throw new Error("Failed to create transaction row");

  tx.insert(transactionLines).values(prepared.validatedLines.map((line) => ({
    transactionId: id,
    accountId: line.accountId,
    debit: line.debit,
    credit: line.credit,
    description: line.description ?? null,
    cashFlowClass: line.cashFlowClass ?? null,
  }))).run();
  if (prepared.tagIds.length > 0) {
    tx.insert(transactionTags)
      .values(prepared.tagIds.map((tagId) => ({ transactionId: id, tagId })))
      .run();
  }
  if (prepared.categoryAllocations.length > 0) {
    tx.insert(transactionCategoryAllocations).values(prepared.categoryAllocations.map((allocation) => ({
      transactionId: id,
      categoryId: allocation.categoryId,
      amount: allocation.amount,
    }))).run();
  }

  const lineSums = tx
    .select({
      debitTotal: sql<number>`coalesce(sum(${transactionLines.debit}), 0)`,
      creditTotal: sql<number>`coalesce(sum(${transactionLines.credit}), 0)`,
    })
    .from(transactionLines)
    .where(eq(transactionLines.transactionId, id))
    .all();
  const persistedDebit = lineSums[0]?.debitTotal ?? 0;
  const persistedCredit = lineSums[0]?.creditTotal ?? 0;
  if (persistedDebit !== prepared.totalDebit || persistedCredit !== prepared.totalCredit) {
    throw new Error(
      `Persisted journal totals differ from validated totals: debits=${persistedDebit} credits=${persistedCredit}`,
    );
  }

  tx.insert(auditLogs).values({
    entityType: "transaction",
    entityId: id,
    action: "create",
    afterSnapshot: Buffer.from(JSON.stringify({
      transaction: prepared.transactionValues,
      lines: prepared.validatedLines,
      tagIds: prepared.tagIds,
    })),
  }).run();
  bumpFinancialRevisionSync(tx);
  return id;
}

export async function createJournalEntry(
  input: CreateJournalEntryInput,
  dbLike: any = defaultDb,
): Promise<{ transactionId: number; balancesByAccountId: Record<number, number> }> {
  const prepared = await prepareJournalEntry(input, dbLike);

  let transactionId: number;
  if (dbLike === defaultDb) {
    // better-sqlite3 transactions must be synchronous. Explicit .all()/.run()
    // calls keep the header, lines, and verification inside the same commit.
    transactionId = defaultDb.transaction((tx) => insertPreparedJournalEntrySync(tx, prepared));
  } else {
    // A supplied executor is assumed to be an existing domain transaction or
    // a test double; its owner controls the outer commit boundary.
    const inserted = await dbLike
      .insert(transactions)
      .values(prepared.transactionValues)
      .returning({ id: transactions.id });
    const id = inserted[0]?.id;
    if (!id) throw new Error("Failed to create transaction row");
    await dbLike.insert(transactionLines).values(prepared.validatedLines.map((line) => ({
      transactionId: id,
      accountId: line.accountId,
      debit: line.debit,
      credit: line.credit,
      description: line.description ?? null,
      cashFlowClass: line.cashFlowClass ?? null,
    })));
    if (prepared.tagIds.length > 0) {
      await dbLike.insert(transactionTags).values(prepared.tagIds.map((tagId) => ({ transactionId: id, tagId })));
    }
    const lineSums = await dbLike
      .select({
        debitTotal: sql<number>`coalesce(sum(${transactionLines.debit}), 0)`,
        creditTotal: sql<number>`coalesce(sum(${transactionLines.credit}), 0)`,
      })
      .from(transactionLines)
      .where(eq(transactionLines.transactionId, id));
    const persistedDebit = lineSums[0]?.debitTotal ?? 0;
    const persistedCredit = lineSums[0]?.creditTotal ?? 0;
    if (persistedDebit !== prepared.totalDebit || persistedCredit !== prepared.totalCredit) {
      throw new Error(
        `Persisted journal totals differ from validated totals: debits=${persistedDebit} credits=${persistedCredit}`,
      );
    }
    await dbLike.insert(auditLogs).values({
      entityType: "transaction",
      entityId: id,
      action: "create",
      afterSnapshot: Buffer.from(JSON.stringify({
        transaction: prepared.transactionValues,
        lines: prepared.validatedLines,
        tagIds: prepared.tagIds,
      })),
    });
    transactionId = id;
  }

  const balancesByAccountId: Record<number, number> = {};
  for (const accountId of prepared.accountIds) {
    balancesByAccountId[accountId] = await computeAccountBalance(accountId, dbLike);
  }

  const result = { transactionId, balancesByAccountId };

  // Only the public/default executor owns a completed commit here. Compound
  // commands using a supplied transaction invalidate once after their outer
  // commit, never while uncommitted data can still roll back.
  if (dbLike === defaultDb) {
    await invalidateOnTransactionMutation({
      transactionId: result.transactionId,
      affectedAccountIds: prepared.accountIds,
      affectedPeriodIds: prepared.periodId != null ? [prepared.periodId] : undefined,
      revisionBumped: true,
    });
  }

  return result;
}
