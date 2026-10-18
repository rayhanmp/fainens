import { personalExpenseLine, personalIncomeLine } from "./reallocation-effects";
import { asc, eq, sql, and, inArray, notInArray } from "drizzle-orm";
import { db } from "../db/client";
import { accounts, transactionLines, transactions, salaryPeriods, budgetPlans } from "../db/schema";
import {
  computeAccountBalance,
  computeAccountBalanceAsOf,
  computeAccountBalanceRolledUp,
} from "./ledger";
import { DAY_MS, endOfLocalDay, inclusivePeriodEnd, inclusivePeriodStart, localDayKey, startOfLocalDay } from "../lib/calendar";

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
  /** Months of tracked history inside the window (after skipped periods). */
  trackedMonths: number;
  /** Months the window total was divided by: tracked history, at least MIN_BURN_RATE_MONTHS. */
  divisorMonths: number;
}

export interface RunwayResult {
  runwayMonths: number | null;
  isUnbounded: boolean;
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

export interface SpendingTrendPoint {
  label: string;
  startMs: number;
  endMs: number;
  spent: number;
  transactionCount: number;
  coverageStatus: "complete" | "partial" | "skipped" | "unknown";
}

function toMs(value: Date | number): number {
  return value instanceof Date ? value.getTime() : Number(value);
}

/** Real activity only: drafts, reversed originals and their reversal journals are excluded, as in financial facts. */
const reportableActivity = () => and(
  notInArray(transactions.status, ["draft", "reversed"]),
  notInArray(transactions.txType, ["reversal", "domain_reversal"]),
);

/** Start of each local calendar day from the day containing `startMs` through the day containing `endMs`. */
function localDaysBetween(startMs: number, endMs: number, maxDays: number): number[] {
  const days: number[] = [];
  const cursor = new Date(startOfLocalDay(startMs));
  while (cursor.getTime() <= endMs && days.length < maxDays) {
    days.push(cursor.getTime());
    cursor.setDate(cursor.getDate() + 1);
  }
  return days.length ? days : [startOfLocalDay(startMs)];
}

/** Daily posted expense activity for a rolling window. Values are canonical
 * expense-account effects (refunds and reimbursements net against spending,
 * as in financial facts), bucketed by local calendar day. */
export async function getSpendingTrend(dayCount: number = 30, periodId?: number): Promise<{
  range: "30d" | "period";
  periodId: number | null;
  periodName: string | null;
  startMs: number;
  endMs: number;
  bucketCount: number;
  totalSpent: number;
  averageDailySpend: number;
  hasIncompleteCoverage: boolean;
  series: SpendingTrendPoint[];
}> {
  const count = Math.max(1, Math.min(370, Math.trunc(dayCount)));
  const now = Date.now();
  const scopedPeriodId = periodId == null ? null : Number(periodId);
  let selectedPeriod: { id: number; name: string; startDate: Date | number; endDate: Date | number; coverageStatus: string } | null = null;
  if (scopedPeriodId != null && Number.isSafeInteger(scopedPeriodId) && scopedPeriodId > 0) {
    const [period] = await db
      .select({ id: salaryPeriods.id, name: salaryPeriods.name, startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate, coverageStatus: salaryPeriods.coverageStatus })
      .from(salaryPeriods)
      .where(eq(salaryPeriods.id, scopedPeriodId))
      .limit(1);
    if (!period) throw new Error("Salary period not found");
    selectedPeriod = period;
  }
  let firstStartMs: number;
  let finalEndMs: number;
  if (selectedPeriod) {
    firstStartMs = inclusivePeriodStart(toMs(selectedPeriod.startDate));
    const periodEndMs = inclusivePeriodEnd(toMs(selectedPeriod.endDate));
    finalEndMs = Math.max(firstStartMs, Math.min(now, periodEndMs));
  } else {
    const firstDay = new Date(startOfLocalDay(now));
    firstDay.setDate(firstDay.getDate() - (count - 1));
    firstStartMs = firstDay.getTime();
    finalEndMs = now;
  }
  const dayStarts = localDaysBetween(firstStartMs, finalEndMs, selectedPeriod ? 370 : count);
  const indexByDay = new Map(dayStarts.map((dayStart, index) => [localDayKey(dayStart), index]));

  const expenseAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.type, "expense"));
  const expenseAccountIds = expenseAccounts.map((account) => account.id);

  // One net amount per transaction, so a refund or reimbursement credit offsets
  // the spending it returns instead of being dropped.
  const rows = expenseAccountIds.length === 0
    ? []
    : await db
      .select({
        date: transactions.date,
        transactionId: transactions.id,
        amount: sql<number>`coalesce(sum(${personalExpenseLine(sql`${transactionLines.transactionId}`, sql`${transactionLines.debit}`, sql`${transactionLines.credit}`)}), 0)`,
      })
      .from(transactionLines)
      .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
      .where(and(
        sql`${transactions.date} >= ${firstStartMs}`,
        sql`${transactions.date} <= ${finalEndMs}`,
        reportableActivity(),
        notInArray(transactions.txType, ["paylater_settlement", "simple_transfer"]),
        sql`${transactionLines.accountId} IN (${sql.join(expenseAccountIds.map(String), sql`, `)})`,
      ))
      .groupBy(transactions.id, transactions.date);

  const periods = await db
    .select({ startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate, coverageStatus: salaryPeriods.coverageStatus })
    .from(salaryPeriods)
      .where(selectedPeriod
        ? eq(salaryPeriods.id, selectedPeriod.id)
        : sql`${salaryPeriods.endDate} >= ${firstStartMs - DAY_MS} AND ${salaryPeriods.startDate} <= ${finalEndMs + DAY_MS}`);
  const netByPoint = dayStarts.map(() => 0);
  const transactionIdsByPoint = dayStarts.map(() => new Set<number>());
  for (const row of rows) {
    const amount = Number(row.amount) || 0;
    if (amount === 0) continue;
    const index = indexByDay.get(localDayKey(toMs(row.date)));
    if (index == null) continue;
    netByPoint[index] += amount;
    transactionIdsByPoint[index].add(Number(row.transactionId));
  }
  const points: SpendingTrendPoint[] = dayStarts.map((startMs, index) => {
    const endMs = Math.min(now, endOfLocalDay(startMs));
    const period = selectedPeriod ?? periods.find((candidate) =>
      inclusivePeriodStart(toMs(candidate.startDate)) <= startMs && inclusivePeriodEnd(toMs(candidate.endDate)) >= startMs);
    return {
      label: new Date(startMs).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      startMs,
      endMs,
      // A day where credits exceed spending shows no spending, never negative spending.
      spent: Math.max(0, netByPoint[index]),
      transactionCount: transactionIdsByPoint[index].size,
      coverageStatus: (period?.coverageStatus as SpendingTrendPoint["coverageStatus"] | undefined) ?? "unknown",
    };
  });
  // The total keeps cross-day netting (a refund on a later day still offsets
  // the purchase), so it matches financial facts for the same window.
  const totalSpent = Math.max(0, netByPoint.reduce((sum, amount) => sum + amount, 0));
  // Skipped/unknown coverage is not zero activity, so the average uses only
  // complete/partial days in both the numerator and the denominator. When no
  // day has known coverage (new periods start as "unknown"), every non-skipped
  // day is used instead so the average still describes the recorded activity.
  const knownIndexes = points.flatMap((point, index) => point.coverageStatus === "complete" || point.coverageStatus === "partial" ? [index] : []);
  const averageIndexes = knownIndexes.length > 0
    ? knownIndexes
    : points.flatMap((point, index) => point.coverageStatus === "skipped" ? [] : [index]);
  const averageNet = averageIndexes.reduce((sum, index) => sum + netByPoint[index], 0);
  return {
    range: selectedPeriod ? "period" : "30d",
    periodId: selectedPeriod?.id ?? null,
    periodName: selectedPeriod?.name ?? null,
    startMs: firstStartMs,
    endMs: finalEndMs,
    bucketCount: points.length,
    totalSpent,
    averageDailySpend: averageIndexes.length === 0 ? 0 : Math.round(Math.max(0, averageNet) / averageIndexes.length),
    hasIncompleteCoverage: points.some((point) => point.coverageStatus !== "complete"),
    series: points,
  };
}

// Calculate net worth: Assets - Liabilities
export async function calculateNetWorth(): Promise<NetWorthResult> {
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
    const balance = await computeAccountBalanceAsOf(account.id, asOfInclusiveMs, db, { restateReversals: true });
    totalAssets += balance;
    if (account.liquidityClass === 'cash_equivalent') liquidAssets += balance;
  }

  let totalLiabilities = 0;
  for (const account of liabilityAccounts) {
    totalLiabilities += await computeAccountBalanceAsOf(account.id, asOfInclusiveMs, db, { restateReversals: true });
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
export type NetWorthRange = "7d" | "30d" | "3m" | "6m" | "1y";

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
      const day = new Date(startOfLocalDay(now));
      day.setDate(day.getDate() - daysAgo);
      const eod = endOfLocalDay(day.getTime());
      const asOfMs = Math.min(now, eod);
      const label = day.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      out.push({ label, asOfMs });
    }
    return out;
  }

  if (range === "3m" || range === "6m") {
    const monthCount = range === "3m" ? 3 : 6;
    const out: Array<{ label: string; asOfMs: number }> = [];
    for (let i = 0; i < monthCount; i++) {
      const monthsAgo = monthCount - 1 - i;
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
  const series = (await netWorthAtEach(buckets.map((bucket) => bucket.asOfMs))).map((point, index) => ({
    label: buckets[index].label,
    asOfMs: buckets[index].asOfMs,
    ...point,
  }));
  return { range, bucketCount: buckets.length, series };
}

/**
 * Net worth at several instants from one read of the ledger: the same lines and sign rules as
 * calculateNetWorthAsOf (non-draft, reversals restated), summed in date order and sampled at each
 * instant. Asking per point instead runs two queries per account per point.
 */
export async function netWorthAtEach(asOfMs: number[]): Promise<Array<{ netWorth: number; totalAssets: number; totalLiabilities: number }>> {
  if (asOfMs.length === 0) return [];
  const lines = await db
    .select({
      date: sql<number>`${transactions.date}`,
      type: accounts.type,
      debit: transactionLines.debit,
      credit: transactionLines.credit,
    })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
    .innerJoin(accounts, eq(transactionLines.accountId, accounts.id))
    .where(and(
      inArray(accounts.type, ["asset", "liability"]),
      sql`${transactions.date} <= ${Math.max(...asOfMs)}`,
      sql`${transactions.status} <> 'draft'`,
      sql`${transactions.status} <> 'reversed' AND NOT (${transactions.txType} IN ('reversal', 'domain_reversal') AND ${transactions.reversalOfTxId} IS NOT NULL)`,
    ))
    .orderBy(asc(transactions.date));

  const order = asOfMs.map((instant, index) => ({ instant, index })).sort((a, b) => a.instant - b.instant);
  const out: Array<{ netWorth: number; totalAssets: number; totalLiabilities: number }> = new Array(asOfMs.length);
  let totalAssets = 0;
  let totalLiabilities = 0;
  let next = 0;
  for (const { instant, index } of order) {
    for (; next < lines.length && Number(lines[next].date) <= instant; next++) {
      const line = lines[next];
      if (line.type === "asset") totalAssets += line.debit - line.credit;
      else totalLiabilities += line.credit - line.debit;
    }
    out[index] = { totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities };
  }
  return out;
}

/** A month of burn is 30 days, matching the 90-day window behind "Last 3 months". */
const BURN_MONTH_MS = 30 * DAY_MS;
/** Tracked history shorter than this still divides by it, so a few days of spending is not extrapolated into a huge monthly rate. */
export const MIN_BURN_RATE_MONTHS = 1;

/**
 * Gross burn rate (average monthly expenses), shared by the dashboard cache and the agent.
 *
 * The window is the last `months` × 30 days, but the total is divided by the months of tracked
 * history inside it: from the first recorded transaction (or the window start, if later) to now,
 * minus any salary period explicitly marked as skipped (whose spending is also left out). Short
 * history is divided by at least {@link MIN_BURN_RATE_MONTHS}. Drafts, reversed originals and
 * reversal journals are excluded, and refunds net against spending, as in financial facts.
 */
export async function calculateBurnRate(months: number = 3, now: number = Date.now()): Promise<BurnRateResult> {
  const windowMonths = Math.max(1, months);
  const windowStartMs = now - windowMonths * BURN_MONTH_MS;
  const windowLabel = `Last ${windowMonths * 30} days`;
  const empty = (description: string): BurnRateResult => ({
    grossBurnRate: 0,
    period: `${windowLabel} (${description})`,
    trackedMonths: 0,
    divisorMonths: 0,
  });

  const [first] = await db
    .select({ date: sql<number | null>`min(${transactions.date})` })
    .from(transactions)
    .where(and(reportableActivity(), sql`${transactions.date} <= ${now}`));
  if (first?.date == null) return empty("no tracked history");
  const trackedStartMs = Math.max(windowStartMs, startOfLocalDay(Number(first.date)));

  const skippedPeriods = await db
    .select({ startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate })
    .from(salaryPeriods)
    .where(eq(salaryPeriods.coverageStatus, "skipped"));
  const skippedRanges = skippedPeriods
    .map((period) => ({
      startMs: Math.max(trackedStartMs, inclusivePeriodStart(Number(period.startDate))),
      endMs: Math.min(now, inclusivePeriodEnd(Number(period.endDate))),
    }))
    .filter((range) => range.endMs >= range.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  let skippedMs = 0;
  let coveredUntil = trackedStartMs - 1;
  for (const range of skippedRanges) {
    const startMs = Math.max(range.startMs, coveredUntil + 1);
    if (range.endMs >= startMs) skippedMs += range.endMs - startMs + 1;
    coveredUntil = Math.max(coveredUntil, range.endMs);
  }
  const trackedMonths = Math.max(0, now - trackedStartMs + 1 - skippedMs) / BURN_MONTH_MS;
  const divisorMonths = Math.min(windowMonths, Math.max(MIN_BURN_RATE_MONTHS, trackedMonths));

  const rows = await db
    .select({
      date: transactions.date,
      amount: sql<number>`coalesce(sum(${personalExpenseLine(sql`${transactionLines.transactionId}`, sql`${transactionLines.debit}`, sql`${transactionLines.credit}`)}), 0)`,
    })
    .from(transactionLines)
    .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
    .innerJoin(accounts, eq(transactionLines.accountId, accounts.id))
    .where(and(
      sql`${transactions.date} >= ${trackedStartMs}`,
      sql`${transactions.date} <= ${now}`,
      eq(accounts.type, "expense"),
      reportableActivity(),
      // Settlements and wallet transfers are not operating spending.
      notInArray(transactions.txType, ["paylater_settlement", "simple_transfer"]),
    ))
    .groupBy(transactions.id, transactions.date);
  const totalExpenses = rows
    .filter((row) => !skippedRanges.some((range) => Number(row.date) >= range.startMs && Number(row.date) <= range.endMs))
    .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

  const roundedTracked = Math.round(trackedMonths * 10) / 10;
  return {
    grossBurnRate: Math.round(totalExpenses / divisorMonths),
    period: trackedMonths >= windowMonths
      ? windowLabel
      : `${windowLabel} (${roundedTracked} ${roundedTracked === 1 ? "month" : "months"} of tracked history${trackedMonths < MIN_BURN_RATE_MONTHS ? `, averaged over ${MIN_BURN_RATE_MONTHS} month` : ""})`,
    trackedMonths: roundedTracked,
    divisorMonths: Math.round(divisorMonths * 100) / 100,
  };
}

// Calculate runway (how many months until broke)
export async function calculateRunway(): Promise<RunwayResult> {
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
  const { grossBurnRate } = await calculateBurnRate();

  // Calculate runway
  const isUnbounded = grossBurnRate <= 0;
  const runwayMonths = isUnbounded ? null : liquidAssets / grossBurnRate;

  return {
    runwayMonths: runwayMonths == null ? null : Math.round(runwayMonths * 10) / 10, // 1 decimal place
    isUnbounded,
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
          total: sql<number>`coalesce(sum(${personalIncomeLine(sql`${transactionLines.transactionId}`, sql`${transactionLines.debit}`, sql`${transactionLines.credit}`)}), 0)`,
        })
        .from(transactionLines)
        .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
        .where(
          and(
            sql`${transactions.date} >= ${periodDetails.startDate}`,
            sql`${transactions.date} <= ${periodDetails.endDate}`,
            sql`${transactions.status} <> 'draft'`,
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
