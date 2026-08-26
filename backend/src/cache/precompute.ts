import { eq, sql, and } from "drizzle-orm";

import { db } from "../db/client";
import { accounts, transactionLines, transactions, salaryPeriods } from "../db/schema";
import { computeAccountBalance, computeAccountBalanceRolledUp, computeTrialBalanceTotals } from "../services/ledger";
import { cacheSet, CacheKeys } from "./redis";
import { CACHE_TTL, Keys } from "./keys";
import { ANALYTICS_KEYS } from "./keys";
import { getFinancialRevision } from "../services/financial-revision";
import { assignedOrLegacyPeriodMembership } from "../services/period-locking";

const DAY_MS = 86_400_000;

// Types for cached data
export interface AccountBalanceCache {
  accountId: number;
  balance: number; // cents
  computedAt: number; // timestamp ms
  revision: number;
}

export interface PeriodSummaryCache {
  periodId: number;
  income: number; // cents
  expenses: number; // cents
  net: number; // cents
  savingsRate: number; // percentage (0-100)
  computedAt: number;
  revision: number;
}

export interface NetWorthCache {
  totalAssets: number; // cents
  totalLiabilities: number; // cents
  netWorth: number; // cents
  liquidAssets: number; // cents (cash, bank)
  illiquidAssets: number; // cents (receivables)
  computedAt: number;
  revision: number;
}

export interface BurnRateCache {
  grossBurnRate: number; // cents per month (avg)
  period: string; // description of period analyzed
  computedAt: number;
  revision: number;
}

export interface RunwayCache {
  runwayMonths: number | null; // months; null means no observed burn
  isUnbounded: boolean;
  liquidAssets: number; // cents
  grossBurnRate: number; // cents per month
  computedAt: number;
  revision: number;
}

export interface TrialBalanceCache {
  totalDebits: number; // cents
  totalCredits: number; // cents
  isBalanced: boolean;
  computedAt: number;
  revision: number;
}

/**
 * A read can span a concurrent ledger commit. Never publish the result under
 * the newer revision in that case: callers may use the value for this request,
 * but the next cache read must recompute against the committed revision.
 */
async function cacheIfRevisionUnchanged<T extends { revision: number }>(
  key: string,
  data: T,
  ttlSeconds: number,
  startedRevision: number,
): Promise<T> {
  const currentRevision = await getFinancialRevision();
  if (currentRevision !== startedRevision) return { ...data, revision: currentRevision };
  await cacheSet(key, data, ttlSeconds);
  return data;
}

// Precompute and cache account balance for a single account
export async function precomputeAccountBalance(accountId: number): Promise<AccountBalanceCache> {
  const startedRevision = await getFinancialRevision();
  const balance = await computeAccountBalance(accountId, db);

  const data: AccountBalanceCache = {
    accountId,
    balance,
    computedAt: Date.now(),
    revision: startedRevision,
  };

  return cacheIfRevisionUnchanged(Keys.accountBalance(accountId), data, CACHE_TTL.ACCOUNT_BALANCE, startedRevision);
}

// Precompute and cache balances for all accounts
export async function precomputeAllAccountBalances(): Promise<AccountBalanceCache[]> {
  const allAccounts = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.isActive, true));

  const results: AccountBalanceCache[] = [];
  for (const account of allAccounts) {
    const data = await precomputeAccountBalance(account.id);
    results.push(data);
  }

  return results;
}

// Precompute period summary for a salary period
export async function precomputePeriodSummary(periodId: number): Promise<PeriodSummaryCache> {
  const startedRevision = await getFinancialRevision();
  // Get period date range
  const [period] = await db
    .select({ startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate })
    .from(salaryPeriods)
    .where(eq(salaryPeriods.id, periodId))
    .limit(1);

  if (!period) {
    throw new Error(`Period not found: ${periodId}`);
  }

  // Get all transactions in this period (using sql template for date comparisons)
  const periodTransactions = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        sql`${transactions.date} >= ${period.startDate}`,
        sql`${transactions.date} <= ${period.endDate + DAY_MS - 1}`,
        sql`${transactions.status} <> 'draft'`,
        assignedOrLegacyPeriodMembership(periodId, transactions.periodId),
      ),
    );

  const transactionIds = periodTransactions.map((t) => t.id);

  // Calculate income (revenue accounts)
  const revenueAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.type, "revenue"));
  const revenueAccountIds = revenueAccounts.map((a) => a.id);

  const incomeResult = transactionIds.length === 0 || revenueAccountIds.length === 0
    ? [{ total: 0 }]
    : await db
      .select({
        total: sql<number>`coalesce(sum(${transactionLines.credit} - ${transactionLines.debit}), 0)`,
      })
      .from(transactionLines)
      .where(
        and(
          sql`${transactionLines.transactionId} IN (${sql.join(transactionIds.map(String), sql`, `)})`,
          sql`${transactionLines.accountId} IN (${sql.join(revenueAccountIds.map(String), sql`, `)})`,
        ),
      );

  // Calculate expenses (expense accounts)
  const expenseAccountsResult = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.type, "expense"));
  const expenseAccountIds = expenseAccountsResult.map((a) => a.id);

  const expensesResult = transactionIds.length === 0 || expenseAccountIds.length === 0
    ? [{ total: 0 }]
    : await db
      .select({
        total: sql<number>`coalesce(sum(${transactionLines.debit} - ${transactionLines.credit}), 0)`,
      })
      .from(transactionLines)
      .where(
        and(
          sql`${transactionLines.transactionId} IN (${sql.join(transactionIds.map(String), sql`, `)})`,
          sql`${transactionLines.accountId} IN (${sql.join(expenseAccountIds.map(String), sql`, `)})`,
        ),
      );

  const income = incomeResult[0]?.total ?? 0;
  const expenses = expensesResult[0]?.total ?? 0;
  const net = income - expenses;
  const savingsRate = income > 0 ? (net / income) * 100 : 0;

  const data: PeriodSummaryCache = {
    periodId,
    income,
    expenses,
    net,
    savingsRate: Math.round(savingsRate * 100) / 100, // 2 decimal places
    computedAt: Date.now(),
    revision: startedRevision,
  };

  return cacheIfRevisionUnchanged(Keys.periodSummary(periodId), data, CACHE_TTL.PERIOD_SUMMARY, startedRevision);
}

// Precompute net worth
export async function precomputeNetWorth(): Promise<NetWorthCache> {
  const startedRevision = await getFinancialRevision();
  // Get all asset and liability accounts
  const assetAccounts = await db
    .select({ id: accounts.id, liquidityClass: accounts.liquidityClass })
    .from(accounts)
    .where(eq(accounts.type, "asset"));

  const liabilityAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.type, "liability"));

  let liquidAssets = 0;
  let totalAssets = 0;

  for (const account of assetAccounts) {
    const balance = await computeAccountBalanceRolledUp(account.id, db);
    totalAssets += balance;
    if (account.liquidityClass === 'cash_equivalent') liquidAssets += balance;
  }

  let totalLiabilities = 0;
  for (const account of liabilityAccounts) {
    const balance = await computeAccountBalanceRolledUp(account.id, db);
    totalLiabilities += balance;
  }

  const illiquidAssets = totalAssets - liquidAssets;
  const netWorth = totalAssets - totalLiabilities;

  const data: NetWorthCache = {
    totalAssets,
    totalLiabilities,
    netWorth,
    liquidAssets,
    illiquidAssets,
    computedAt: Date.now(),
    revision: startedRevision,
  };

  return cacheIfRevisionUnchanged(Keys.analytics(ANALYTICS_KEYS.NET_WORTH), data, CACHE_TTL.ANALYTICS, startedRevision);
}

// Precompute burn rate (average monthly operational expenses)
export async function precomputeBurnRate(months: number = 3): Promise<BurnRateCache> {
  const startedRevision = await getFinancialRevision();
  // Get expense accounts
  const expenseAccountsResult = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.type, "expense"));
  const expenseAccountIds = expenseAccountsResult.map((a) => a.id);

  // Get transactions from last N months excluding internal transfers
  const cutoffDate = Date.now() - months * 30 * 24 * 60 * 60 * 1000;

  const burnResult = expenseAccountIds.length === 0
    ? [{ total: 0 }]
    : await db
      .select({
        total: sql<number>`coalesce(sum(${transactionLines.debit} - ${transactionLines.credit}), 0)`,
      })
      .from(transactionLines)
      .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
      .where(
        and(
          sql`${transactions.date} >= ${cutoffDate}`,
          sql`${transactions.date} <= ${Date.now()}`,
          sql`${transactions.status} <> 'draft'`,
          sql`${transactionLines.accountId} IN (${sql.join(expenseAccountIds.map(String), sql`, `)})`,
          // Exclude non-operational txTypes (transfers, settlements, etc.)
          sql`${transactions.txType} NOT IN ('paylater_settlement')`,
        ),
      );

  const totalExpenses = burnResult[0]?.total ?? 0;
  const grossBurnRate = Math.round(totalExpenses / months);

  const data: BurnRateCache = {
    grossBurnRate,
    period: `Last ${months} months`,
    computedAt: Date.now(),
    revision: startedRevision,
  };

  return cacheIfRevisionUnchanged(Keys.analytics(ANALYTICS_KEYS.BURN_RATE), data, CACHE_TTL.ANALYTICS, startedRevision);
}

// Precompute runway (how many months until broke)
export async function precomputeRunway(): Promise<RunwayCache> {
  const startedRevision = await getFinancialRevision();
  const liquidAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(
      eq(accounts.type, "asset"),
      eq(accounts.liquidityClass, "cash_equivalent"),
    ));

  let liquidAssets = 0;
  for (const account of liquidAccounts) {
    liquidAssets += await computeAccountBalance(account.id, db);
  }

  // Get burn rate
  const burnRateData = await precomputeBurnRate();
  const grossBurnRate = burnRateData.grossBurnRate;

  // Calculate runway
  const isUnbounded = grossBurnRate <= 0;
  const runwayMonths = isUnbounded ? null : liquidAssets / grossBurnRate;

  const data: RunwayCache = {
    runwayMonths: runwayMonths == null ? null : Math.round(runwayMonths * 10) / 10, // 1 decimal place
    isUnbounded,
    liquidAssets,
    grossBurnRate,
    computedAt: Date.now(),
    revision: startedRevision,
  };

  return cacheIfRevisionUnchanged(Keys.analytics(ANALYTICS_KEYS.RUNWAY), data, CACHE_TTL.ANALYTICS, startedRevision);
}

// Precompute trial balance
export async function precomputeTrialBalance(): Promise<TrialBalanceCache> {
  const startedRevision = await getFinancialRevision();
  const totals = await computeTrialBalanceTotals(db);

  const data: TrialBalanceCache = {
    totalDebits: totals.debitTotal,
    totalCredits: totals.creditTotal,
    isBalanced: totals.isBalanced,
    computedAt: Date.now(),
    revision: startedRevision,
  };

  return cacheIfRevisionUnchanged(Keys.analytics(ANALYTICS_KEYS.TRIAL_BALANCE), data, CACHE_TTL.ANALYTICS, startedRevision);
}

// Precompute all analytics in one go
export async function precomputeAllAnalytics(): Promise<void> {
  await Promise.all([
    precomputeNetWorth(),
    precomputeBurnRate(),
    precomputeRunway(),
    precomputeTrialBalance(),
  ]);
}

// Precompute everything (used on startup or after bulk import)
export async function precomputeEverything(): Promise<void> {
  await precomputeAllAccountBalances();
  await precomputeAllAnalytics();

  // Precompute summaries for all periods
  const periods = await db.select({ id: salaryPeriods.id }).from(salaryPeriods);
  for (const period of periods) {
    await precomputePeriodSummary(period.id);
  }
}
