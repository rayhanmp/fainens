import { eq, sql, and } from "drizzle-orm";

import { db } from "../db/client";
import { accounts, transactionLines, transactions, salaryPeriods } from "../db/schema";
import { computeAccountBalance, computeAccountBalanceRolledUp, computeTrialBalanceTotals } from "../services/ledger";
import { cacheSet, CacheKeys } from "./redis";
import { CACHE_TTL, Keys } from "./keys";
import { ANALYTICS_KEYS } from "./keys";

// Types for cached data
export interface AccountBalanceCache {
  accountId: number;
  balance: number; // cents
  computedAt: number; // timestamp ms
}

export interface PeriodSummaryCache {
  periodId: number;
  income: number; // cents
  expenses: number; // cents
  net: number; // cents
  savingsRate: number; // percentage (0-100)
  computedAt: number;
}

export interface NetWorthCache {
  totalAssets: number; // cents
  totalLiabilities: number; // cents
  netWorth: number; // cents
  liquidAssets: number; // cents (cash, bank)
  illiquidAssets: number; // cents (receivables)
  computedAt: number;
}

export interface BurnRateCache {
  grossBurnRate: number; // cents per month (avg)
  period: string; // description of period analyzed
  computedAt: number;
}

export interface RunwayCache {
  runwayMonths: number; // months
  liquidAssets: number; // cents
  grossBurnRate: number; // cents per month
  computedAt: number;
}

export interface TrialBalanceCache {
  totalDebits: number; // cents
  totalCredits: number; // cents
  isBalanced: boolean;
  computedAt: number;
}

// Precompute and cache account balance for a single account
export async function precomputeAccountBalance(accountId: number): Promise<AccountBalanceCache> {
  const balance = await computeAccountBalance(accountId, db);

  const data: AccountBalanceCache = {
    accountId,
    balance,
    computedAt: Date.now(),
  };

  await cacheSet(Keys.accountBalance(accountId), data, CACHE_TTL.ACCOUNT_BALANCE);
  return data;
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
        sql`${transactions.date} <= ${period.endDate}`,
      ),
    );

  const transactionIds = periodTransactions.map((t) => t.id);

  // Calculate income (revenue accounts)
  const revenueAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.type, "revenue"));
  const revenueAccountIds = revenueAccounts.map((a) => a.id);

  const incomeResult = await db
    .select({
      total: sql<number>`coalesce(sum(${transactionLines.credit}), 0)`,
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

  const expensesResult = await db
    .select({
      total: sql<number>`coalesce(sum(${transactionLines.debit}), 0)`,
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
  };

  await cacheSet(Keys.periodSummary(periodId), data, CACHE_TTL.PERIOD_SUMMARY);
  return data;
}

// Precompute net worth
export async function precomputeNetWorth(): Promise<NetWorthCache> {
  // Get all asset and liability accounts
  const assetAccounts = await db
    .select({ id: accounts.id })
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
    liquidAssets += balance;
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
  };

  await cacheSet(Keys.analytics(ANALYTICS_KEYS.NET_WORTH), data, CACHE_TTL.ANALYTICS);
  return data;
}

// Precompute burn rate (average monthly operational expenses)
export async function precomputeBurnRate(months: number = 3): Promise<BurnRateCache> {
  // Get expense accounts
  const expenseAccountsResult = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.type, "expense"));
  const expenseAccountIds = expenseAccountsResult.map((a) => a.id);

  // Get transactions from last N months excluding internal transfers
  const cutoffDate = Date.now() - months * 30 * 24 * 60 * 60 * 1000;

  const burnResult = await db
    .select({
      total: sql<number>`coalesce(sum(${transactionLines.debit}), 0)`,
    })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
    .where(
      and(
        sql`${transactions.date} >= ${cutoffDate}`,
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
  };

  await cacheSet(Keys.analytics(ANALYTICS_KEYS.BURN_RATE), data, CACHE_TTL.ANALYTICS);
  return data;
}

// Precompute runway (how many months until broke)
export async function precomputeRunway(): Promise<RunwayCache> {
  const liquidAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.type, "asset"));

  let liquidAssets = 0;
  for (const account of liquidAccounts) {
    liquidAssets += await computeAccountBalance(account.id, db);
  }

  // Get burn rate
  const burnRateData = await precomputeBurnRate();
  const grossBurnRate = burnRateData.grossBurnRate;

  // Calculate runway
  const runwayMonths = grossBurnRate > 0 ? liquidAssets / grossBurnRate : Infinity;

  const data: RunwayCache = {
    runwayMonths: Math.round(runwayMonths * 10) / 10, // 1 decimal place
    liquidAssets,
    grossBurnRate,
    computedAt: Date.now(),
  };

  await cacheSet(Keys.analytics(ANALYTICS_KEYS.RUNWAY), data, CACHE_TTL.ANALYTICS);
  return data;
}

// Precompute trial balance
export async function precomputeTrialBalance(): Promise<TrialBalanceCache> {
  const totals = await computeTrialBalanceTotals(db);

  const data: TrialBalanceCache = {
    totalDebits: totals.debitTotal,
    totalCredits: totals.creditTotal,
    isBalanced: totals.isBalanced,
    computedAt: Date.now(),
  };

  await cacheSet(Keys.analytics(ANALYTICS_KEYS.TRIAL_BALANCE), data, CACHE_TTL.ANALYTICS);
  return data;
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
