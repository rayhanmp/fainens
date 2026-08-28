import { desc, eq } from "drizzle-orm";

import { db } from "../db/client";
import { budgetPlans, categories, forecastPurchaseReviews, salaryPeriods, subscriptions, transactions } from "../db/schema";
import { getFinancialFacts } from "./financial-facts";
import { addOneMonth, addOneYear } from "./recurrence-calendar";
import { robustHistoricalStats } from "./budget-outlook-math";
import { getFinancialRevision } from "./financial-revision";

const DAY_MS = 86_400_000;
const MIN_COMPLETED_PERIODS = 2;
const MAX_HISTORY_PERIODS = 6;

type Confidence = "unavailable" | "low" | "moderate" | "high";
type ForecastMethod = "completed_cycle_median" | "insufficient_history" | "period_complete";
type RiskStatus = "within_budget" | "at_risk" | "over_budget" | "unknown";

export type BudgetOutlook = {
  periodId: number;
  asOfMs: number;
  totalDays: number;
  daysElapsed: number;
  daysRemaining: number;
  eligiblePeriodCount: number;
  confidence: Confidence;
  method: ForecastMethod;
  patternReview: { applied: boolean; categoryCount: number; evidenceRevision: number };
  total: {
    plannedAmount: number;
    actualAmount: number;
    remainingAmount: number;
    scheduledRemainingAmount: number;
    projectedAmount: number | null;
    projectedLowAmount: number | null;
    projectedHighAmount: number | null;
    riskStatus: RiskStatus;
  };
  categories: Array<{
    categoryId: number;
    categoryName: string;
    plannedAmount: number;
    actualAmount: number;
    remainingAmount: number;
    scheduledRemainingAmount: number;
    historicalRemainingAmount: number | null;
    projectedAmount: number | null;
    projectedLowAmount: number | null;
    projectedHighAmount: number | null;
    riskStatus: RiskStatus;
    historicalSampleCount: number;
    outlierCount: number;
    evidencePeriodIds: number[];
    historicalSampleAmounts: number[];
    patternReview: { transactionId: number; amount: number; description: string; classification: string; confidence: number; rationale: string } | null;
  }>;
};

function toMs(value: Date | number): number {
  return value instanceof Date ? value.getTime() : Number(value);
}

function inclusiveEnd(endMs: number): number {
  return endMs + DAY_MS - 1;
}

function roundAmount(value: number): number {
  return Math.round(value);
}

function confidenceFor(sampleCount: number, forecastAvailable: boolean): Confidence {
  if (!forecastAvailable) return "unavailable";
  if (sampleCount >= 5) return "high";
  if (sampleCount >= 3) return "moderate";
  return "low";
}

function nextSubscriptionOccurrence(dueAt: number, billingCycle: string): number {
  return billingCycle === "annual" ? addOneYear(dueAt) : addOneMonth(dueAt);
}

async function scheduledSpendingByCategory(afterMs: number, endMs: number): Promise<Map<number, number>> {
  const activeSubscriptions = await db
    .select({
      categoryId: subscriptions.categoryId,
      amount: subscriptions.amount,
      nextRenewalAt: subscriptions.nextRenewalAt,
      billingCycle: subscriptions.billingCycle,
    })
    .from(subscriptions)
    .where(eq(subscriptions.status, "active"));

  const scheduled = new Map<number, number>();
  for (const subscription of activeSubscriptions) {
    if (subscription.categoryId == null || subscription.amount <= 0) continue;
    let dueAt = toMs(subscription.nextRenewalAt);
    // Overdue renewals are intentionally not projected. They need review as
    // overdue obligations rather than being silently treated as future spend.
    while (dueAt <= afterMs) dueAt = nextSubscriptionOccurrence(dueAt, subscription.billingCycle);
    while (dueAt <= endMs) {
      scheduled.set(subscription.categoryId, (scheduled.get(subscription.categoryId) ?? 0) + subscription.amount);
      dueAt = nextSubscriptionOccurrence(dueAt, subscription.billingCycle);
    }
  }
  return scheduled;
}

/**
 * An explainable, cycle-aware budget forecast. It uses only completed salary
 * periods as evidence, aligns them by salary-cycle day, and excludes posted
 * subscription renewals from history because known future renewals are added
 * separately from the live subscription schedule.
 */
export async function getBudgetOutlook(periodId: number, now = Date.now()): Promise<BudgetOutlook> {
  const [period] = await db
    .select({ id: salaryPeriods.id, startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate })
    .from(salaryPeriods)
    .where(eq(salaryPeriods.id, periodId))
    .limit(1);
  if (!period) throw new Error("Salary period not found");

  const plans = await db
    .select({
      categoryId: budgetPlans.categoryId,
      categoryName: categories.name,
      plannedAmount: budgetPlans.plannedAmount,
    })
    .from(budgetPlans)
    .innerJoin(categories, eq(categories.id, budgetPlans.categoryId))
    .where(eq(budgetPlans.periodId, periodId));

  const startMs = toMs(period.startDate);
  const endMs = toMs(period.endDate);
  const endInclusiveMs = inclusiveEnd(endMs);
  const totalDays = Math.max(1, Math.round((endMs - startMs) / DAY_MS) + 1);
  const daysElapsed = now < startMs
    ? 0
    : now > endInclusiveMs
      ? totalDays
      : Math.min(totalDays, Math.floor((now - startMs) / DAY_MS) + 1);
  const daysRemaining = Math.max(0, totalDays - daysElapsed);
  const asOfMs = Math.min(now, endInclusiveMs);

  const currentFacts = await getFinancialFacts({
    startMs,
    endMs: endInclusiveMs,
    asOfMs,
    periodId,
  });
  const actualByCategory = new Map(currentFacts.byCategory.map((row) => [row.categoryId, row.spentCents]));
  const evidenceRevision = await getFinancialRevision();
  const storedReviews = await db.select({
    transactionId: forecastPurchaseReviews.transactionId,
    transactionDate: forecastPurchaseReviews.transactionDate,
    periodId: forecastPurchaseReviews.periodId,
    categoryId: forecastPurchaseReviews.categoryId,
    amount: forecastPurchaseReviews.amount,
    evidenceRevision: forecastPurchaseReviews.evidenceRevision,
    status: forecastPurchaseReviews.status,
    weight: forecastPurchaseReviews.weight,
    userWeight: forecastPurchaseReviews.userWeight,
    confidence: forecastPurchaseReviews.confidence,
    classification: forecastPurchaseReviews.classification,
    rationale: forecastPurchaseReviews.rationale,
    description: transactions.description,
  }).from(forecastPurchaseReviews).leftJoin(transactions, eq(transactions.id, forecastPurchaseReviews.transactionId));
  const currentReviews = storedReviews.filter((review) =>
    (review.status === "active" || review.status === "user_override")
    && review.evidenceRevision === evidenceRevision
    // Recurring and ordinary purchases are intentionally never pattern flags.
    && (review.classification === "one_off" || review.classification === "unusual")
  );
  const reviewByCategory = new Map<number, typeof currentReviews[number]>();
  for (const review of currentReviews) reviewByCategory.set(review.categoryId, review);

  const priorPeriods = await db
    .select({ id: salaryPeriods.id, startDate: salaryPeriods.startDate, endDate: salaryPeriods.endDate })
    .from(salaryPeriods)
    .where(eq(salaryPeriods.coverageStatus, "complete"))
    .orderBy(desc(salaryPeriods.endDate));
  const eligiblePeriods = priorPeriods
    .filter((candidate) => candidate.id !== periodId && toMs(candidate.endDate) < startMs)
    .slice(0, MAX_HISTORY_PERIODS);
  const forecastAvailable = daysRemaining > 0 && eligiblePeriods.length >= MIN_COMPLETED_PERIODS;

  const historyByCategory = new Map<number, number[]>();
  for (const plan of plans) historyByCategory.set(plan.categoryId, []);
  for (const historicPeriod of eligiblePeriods) {
    const historicStartMs = toMs(historicPeriod.startDate);
    const historicEndInclusiveMs = inclusiveEnd(toMs(historicPeriod.endDate));
    const alignedRemainingStartMs = Math.min(historicEndInclusiveMs + 1, historicStartMs + daysElapsed * DAY_MS);
    const historicFacts = alignedRemainingStartMs > historicEndInclusiveMs
      ? { byCategory: [] as Array<{ categoryId: number | null; spentCents: number }> }
      : await getFinancialFacts({
        startMs: alignedRemainingStartMs,
        endMs: historicEndInclusiveMs,
        asOfMs: historicEndInclusiveMs,
        periodId: historicPeriod.id,
        excludeTxTypes: ["subscription_renewal"],
      });
    const historicSpending = new Map(historicFacts.byCategory.map((row) => [row.categoryId, row.spentCents]));
    for (const plan of plans) {
      const baseAmount = historicSpending.get(plan.categoryId) ?? 0;
      const adjustment = currentReviews
        .filter((review) => review.periodId === historicPeriod.id && review.categoryId === plan.categoryId && review.transactionDate >= alignedRemainingStartMs && review.transactionDate <= historicEndInclusiveMs)
        .reduce((sum, review) => sum + review.amount * (1 - Math.max(0.05, Math.min(1, review.userWeight ?? review.weight))), 0);
      historyByCategory.get(plan.categoryId)?.push(Math.max(0, baseAmount - adjustment));
    }
  }

  const scheduledByCategory = daysRemaining > 0
    ? await scheduledSpendingByCategory(asOfMs, endInclusiveMs)
    : new Map<number, number>();
  const confidence = confidenceFor(eligiblePeriods.length, forecastAvailable);
  const method: ForecastMethod = daysRemaining === 0
    ? "period_complete"
    : forecastAvailable
      ? "completed_cycle_median"
      : "insufficient_history";

  const categoryRows = plans.map((plan) => {
    const actualAmount = actualByCategory.get(plan.categoryId) ?? 0;
    const samples = historyByCategory.get(plan.categoryId) ?? [];
    const review = reviewByCategory.get(plan.categoryId);
    const historicalStats = forecastAvailable ? robustHistoricalStats(samples, plan.plannedAmount) : null;
    const historicalRemainingAmount = historicalStats == null ? null : roundAmount(historicalStats.typical);
    const historicalLow = historicalStats == null ? null : roundAmount(historicalStats.low);
    const historicalHigh = historicalStats == null ? null : roundAmount(historicalStats.high);
    const scheduledRemainingAmount = scheduledByCategory.get(plan.categoryId) ?? 0;
    const projectedAmount = historicalRemainingAmount == null ? null : actualAmount + scheduledRemainingAmount + historicalRemainingAmount;
    const projectedLowAmount = historicalLow == null ? null : actualAmount + scheduledRemainingAmount + historicalLow;
    const projectedHighAmount = historicalHigh == null ? null : actualAmount + scheduledRemainingAmount + historicalHigh;
    const riskStatus: RiskStatus = actualAmount >= plan.plannedAmount
      ? "over_budget"
      : projectedAmount == null
        ? "unknown"
        : projectedAmount > plan.plannedAmount
          ? "at_risk"
          : "within_budget";
    return {
      categoryId: plan.categoryId,
      categoryName: plan.categoryName,
      plannedAmount: plan.plannedAmount,
      actualAmount,
      remainingAmount: plan.plannedAmount - actualAmount,
      scheduledRemainingAmount,
      historicalRemainingAmount,
      projectedAmount,
      projectedLowAmount,
      projectedHighAmount,
      riskStatus,
      historicalSampleCount: samples.length,
      outlierCount: historicalStats?.outlierCount ?? 0,
      evidencePeriodIds: eligiblePeriods.map((candidate) => candidate.id),
      historicalSampleAmounts: samples,
      patternReview: review ? { transactionId: review.transactionId, amount: review.amount, description: review.description ?? "Purchase", classification: review.classification, confidence: review.confidence, rationale: review.rationale } : null,
    };
  });

  const totalPlanned = categoryRows.reduce((sum, row) => sum + row.plannedAmount, 0);
  const totalActual = categoryRows.reduce((sum, row) => sum + row.actualAmount, 0);
  const totalScheduled = categoryRows.reduce((sum, row) => sum + row.scheduledRemainingAmount, 0);
  const totalProjected = forecastAvailable
    ? categoryRows.reduce((sum, row) => sum + (row.projectedAmount ?? row.actualAmount), 0)
    : null;
  const totalProjectedLow = forecastAvailable
    ? categoryRows.reduce((sum, row) => sum + (row.projectedLowAmount ?? row.actualAmount), 0)
    : null;
  const totalProjectedHigh = forecastAvailable
    ? categoryRows.reduce((sum, row) => sum + (row.projectedHighAmount ?? row.actualAmount), 0)
    : null;
  const totalRisk: RiskStatus = totalActual >= totalPlanned
    ? "over_budget"
    : totalProjected == null
      ? "unknown"
      : totalProjected > totalPlanned
        ? "at_risk"
        : "within_budget";

  return {
    periodId,
    asOfMs,
    totalDays,
    daysElapsed,
    daysRemaining,
    eligiblePeriodCount: eligiblePeriods.length,
    confidence,
    method,
    patternReview: { applied: currentReviews.length > 0, categoryCount: new Set(currentReviews.map((review) => review.categoryId)).size, evidenceRevision },
    total: {
      plannedAmount: totalPlanned,
      actualAmount: totalActual,
      remainingAmount: totalPlanned - totalActual,
      scheduledRemainingAmount: totalScheduled,
      projectedAmount: totalProjected,
      projectedLowAmount: totalProjectedLow,
      projectedHighAmount: totalProjectedHigh,
      riskStatus: totalRisk,
    },
    categories: categoryRows,
  };
}
