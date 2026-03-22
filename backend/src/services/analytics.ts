import { eq, sql, and } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, transactionLines, transactions, salaryPeriods, budgetPlans } from "../db/schema";
import {
  computeAccountBalance,
  computeAccountBalanceAsOf,
  computeAccountBalanceRolledUp,
} from "./ledger";

// Types for analytics results
export interface NetWorthResult {
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  liquidAssets: number;
  illiquidAssets: number;
}

export interface BurnRateResult {
  grossBurnRate: number; // cents per month
  period: string;
}

export interface RunwayResult {
  runwayMonths: number;
  liquidAssets: number;
  grossBurnRate: number;
}

export interface LifestyleCreepResult {
  currentMPC: number; // Marginal Propensity to Consume (0-1+)
  trend: "increasing" | "stable" | "decreasing";
  periods: Array<{
    periodName: string;
    income: number;
    discretionarySpending: number;
    mpc: number;
  }>;
}

export interface DashboardAnalytics {
  netWorth: NetWorthResult;
  burnRate: BurnRateResult;
  runway: RunwayResult;
  trialBalance: { isBalanced: boolean };
}

// Calculate net worth: Assets - Liabilities
export async function calculateNetWorth(): Promise<NetWorthResult> {
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

  return {
    totalAssets,
    totalLiabilities,
    netWorth,
    liquidAssets,
    illiquidAssets,
  };
}

/** Net worth (assets − liabilities) using only ledger activity on or before `asOfInclusiveMs`. */
export async function calculateNetWorthAsOf(asOfInclusiveMs: number): Promise<NetWorthResult> {
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
    const balance = await computeAccountBalanceAsOf(account.id, asOfInclusiveMs, db);
    totalAssets += balance;
    liquidAssets += balance;
  }

  let totalLiabilities = 0;
  for (const account of liabilityAccounts) {
    totalLiabilities += await computeAccountBalanceAsOf(account.id, asOfInclusiveMs, db);
  }

  const illiquidAssets = totalAssets - liquidAssets;
  const netWorth = totalAssets - totalLiabilities;

  return {
    totalAssets,
    totalLiabilities,
    netWorth,
    liquidAssets,
    illiquidAssets,
  };
}

/** Net worth trend window — all ranges end at “now” (today). */
export type NetWorthRange = "7d" | "30d" | "6m" | "1y";

function endOfCalendarDayMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
}

/**
 * Build as-of timestamps (oldest → newest, last point ≈ now).
 * - 7d / 30d: one point per calendar day
 * - 6m: month-end for last 6 months including current month
 * - 1y: month-end for last 12 months including current month
 */
export function buildNetWorthTrendBuckets(range: NetWorthRange): Array<{ label: string; asOfMs: number }> {
  const now = Date.now();

  if (range === "7d" || range === "30d") {
    const dayCount = range === "7d" ? 7 : 30;
    const out: Array<{ label: string; asOfMs: number }> = [];
    for (let i = 0; i < dayCount; i++) {
      const daysAgo = dayCount - 1 - i;
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - daysAgo);
      const eod = endOfCalendarDayMs(day);
      const asOfMs = Math.min(now, eod);
      const label = day.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      out.push({ label, asOfMs });
    }
    return out;
  }

  if (range === "6m") {
    const out: Array<{ label: string; asOfMs: number }> = [];
    for (let i = 0; i < 6; i++) {
      const monthsAgo = 5 - i;
      const d = new Date();
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      d.setMonth(d.getMonth() - monthsAgo);
      const eom = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
      const asOfMs = Math.min(now, eom);
      const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      out.push({ label, asOfMs });
    }
    return out;
  }

  // 1y — 12 month-ends rolling back from current month
  const out: Array<{ label: string; asOfMs: number }> = [];
  for (let i = 0; i < 12; i++) {
    const monthsAgo = 11 - i;
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    d.setMonth(d.getMonth() - monthsAgo);
    const eom = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
    const asOfMs = Math.min(now, eom);
    const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    out.push({ label, asOfMs });
  }
  return out;
}

export interface NetWorthTrendPoint {
  label: string;
  asOfMs: number;
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
}

export async function getNetWorthTrend(range: NetWorthRange): Promise<{
  range: NetWorthRange;
  bucketCount: number;
  series: NetWorthTrendPoint[];
}> {
  const buckets = buildNetWorthTrendBuckets(range);
  const series: NetWorthTrendPoint[] = [];
  for (const b of buckets) {
    const nw = await calculateNetWorthAsOf(b.asOfMs);
    series.push({
      label: b.label,
      asOfMs: b.asOfMs,
      netWorth: nw.netWorth,
      totalAssets: nw.totalAssets,
      totalLiabilities: nw.totalLiabilities,
    });
  }
  return { range, bucketCount: buckets.length, series };
}

// Calculate gross burn rate (average monthly operational expenses)
export async function calculateBurnRate(months: number = 3): Promise<BurnRateResult> {
  // Get expense accounts
  const expenseAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.type, "expense"));
  const expenseAccountIds = expenseAccounts.map((a) => a.id);

  if (expenseAccountIds.length === 0) {
    return { grossBurnRate: 0, period: `Last ${months} months` };
  }

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
        sql`${transactions.txType} NOT IN ('paylater_settlement', 'simple_transfer')`,
      ),
    );

  const totalExpenses = burnResult[0]?.total ?? 0;
  const grossBurnRate = Math.round(totalExpenses / months);

  return {
    grossBurnRate,
    period: `Last ${months} months`,
  };
}

// Calculate runway (how many months until broke)
export async function calculateRunway(): Promise<RunwayResult> {
  const liquidAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.type, "asset"));

  let liquidAssets = 0;
  for (const account of liquidAccounts) {
    liquidAssets += await computeAccountBalance(account.id, db);
  }

  // Get burn rate
  const { grossBurnRate } = await calculateBurnRate();

  // Calculate runway
  const runwayMonths = grossBurnRate > 0 ? liquidAssets / grossBurnRate : Infinity;

  return {
    runwayMonths: Math.round(runwayMonths * 10) / 10, // 1 decimal place
    liquidAssets,
    grossBurnRate,
  };
}

// Calculate Lifestyle Creep Index (MPC over periods)
export async function calculateLifestyleCreep(periodCount: number = 6): Promise<LifestyleCreepResult> {
  // Get recent periods
  const periods = await db
    .select({ id: salaryPeriods.id, name: salaryPeriods.name })
    .from(salaryPeriods)
    .orderBy(sql`${salaryPeriods.startDate} DESC`)
    .limit(periodCount);

  if (periods.length < 2) {
    return {
      currentMPC: 0,
      trend: "stable",
      periods: [],
    };
  }

  // Reverse to get chronological order
  periods.reverse();

  const periodData: Array<{
    periodName: string;
    income: number;
    discretionarySpending: number;
    mpc: number;
  }> = [];

  for (const period of periods) {
    // Get budgets for this period (treated as discretionary spending plan)
    const budgets = await db
      .select({
        plannedAmount: budgetPlans.plannedAmount,
      })
      .from(budgetPlans)
      .where(eq(budgetPlans.periodId, period.id));

    const discretionarySpending = budgets.reduce((sum, b) => sum + b.plannedAmount, 0);

    // Get actual income for the period (from revenue accounts)
    const [periodDetails] = await db
      .select({ startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate })
      .from(salaryPeriods)
      .where(eq(salaryPeriods.id, period.id));

    if (!periodDetails) continue;

    // Calculate income in this period
    const revenueAccounts = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.type, "revenue"));
    const revenueAccountIds = revenueAccounts.map((a) => a.id);

    let income = 0;
    if (revenueAccountIds.length > 0) {
      const incomeResult = await db
        .select({
          total: sql<number>`coalesce(sum(${transactionLines.credit}), 0)`,
        })
        .from(transactionLines)
        .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
        .where(
          and(
            sql`${transactions.date} >= ${periodDetails.startDate}`,
            sql`${transactions.date} <= ${periodDetails.endDate}`,
            sql`${transactionLines.accountId} IN (${sql.join(revenueAccountIds.map(String), sql`, `)})`,
          ),
        );
      income = incomeResult[0]?.total ?? 0;
    }

    // MPC = discretionary spending / income
    const mpc = income > 0 ? discretionarySpending / income : 0;

    periodData.push({
      periodName: period.name,
      income,
      discretionarySpending,
      mpc: Math.round(mpc * 100) / 100,
    });
  }

  // Calculate trend
  const currentMPC = periodData.length > 0 ? periodData[periodData.length - 1].mpc : 0;
  let trend: "increasing" | "stable" | "decreasing" = "stable";

  if (periodData.length >= 2) {
    const previousMPC = periodData[periodData.length - 2].mpc;
    const diff = currentMPC - previousMPC;
    if (diff > 0.05) trend = "increasing";
    else if (diff < -0.05) trend = "decreasing";
  }

  return {
    currentMPC: Math.round(currentMPC * 100) / 100,
    trend,
    periods: periodData,
  };
}

// Get all dashboard analytics in one call
export async function getDashboardAnalytics(): Promise<DashboardAnalytics> {
  const [netWorth, burnRate, runway, trialBalance] = await Promise.all([
    calculateNetWorth(),
    calculateBurnRate(),
    calculateRunway(),
    import("./ledger").then((m) => m.computeTrialBalanceTotals(db)),
  ]);

  return {
    netWorth,
    burnRate,
    runway,
    trialBalance: { isBalanced: trialBalance.isBalanced },
  };
}
