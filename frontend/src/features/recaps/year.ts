import type { PeriodRecap, SavedRecapStory } from './queries';
import { recapDay } from './stories';

export const recapYear = (period: { startDate: number }) => recapDay(period.startDate).getUTCFullYear();

/** A year recap keeps its periods' own recaps alongside the sums, for the insights only a year can show. */
export type YearRecap = PeriodRecap & { yearPeriods?: PeriodRecap[] };

/**
 * One recap for a calendar year, combined from its salary periods' recaps. Sums and merges stay exact;
 * figures that cannot be combined exactly (the median receipt, historical baselines) are left out
 * rather than approximated, and the chapters that need them simply sit the year out.
 */
export function combineYear(recaps: PeriodRecap[], year: number): YearRecap {
  const sorted = [...recaps].sort((a, b) => a.startMs - b.startMs);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const sum = (pick: (recap: PeriodRecap) => number) => sorted.reduce((total, recap) => total + pick(recap), 0);

  const categories = new Map<string, { categoryId: number | null; name: string; amount: number }>();
  for (const row of sorted.flatMap(recap => recap.categories)) {
    const key = row.categoryId != null ? `id:${row.categoryId}` : `name:${row.name}`;
    const current = categories.get(key) ?? { categoryId: row.categoryId ?? null, name: row.name, amount: 0 };
    current.amount += row.amount;
    categories.set(key, current);
  }
  const repeats = new Map<string, { description: string; occurrences: number; totalAmount: number; category: string }>();
  for (const row of sorted.flatMap(recap => recap.highlights?.repeatPurchases ?? [])) {
    const key = row.description.trim().toLowerCase();
    const current = repeats.get(key) ?? { ...row, occurrences: 0, totalAmount: 0 };
    current.occurrences += row.occurrences;
    current.totalAmount += row.totalAmount;
    repeats.set(key, current);
  }
  const peaks = sorted.map(recap => recap.highlights?.peakSpendingDay).filter(peak => peak != null);
  const largest = sorted.map(recap => recap.largestPurchase).filter(purchase => purchase != null).sort((a, b) => b.amount - a.amount)[0] ?? null;
  const budgets = sorted.map(recap => recap.budget).filter(budget => budget != null);
  const planned = budgets.reduce((total, budget) => total + budget.planned, 0);
  const spent = budgets.reduce((total, budget) => total + budget.spent, 0);
  const purchaseCount = sum(recap => recap.purchaseCount);
  const purchaseTotal = sorted.every(recap => recap.purchaseProfile) ? sum(recap => recap.purchaseProfile?.totalAmount ?? 0) : null;

  return {
    period: { id: last.period.id, name: String(year), startDate: first.period.startDate, endDate: last.period.endDate },
    startMs: first.startMs, endMs: last.endMs, generatedAt: Math.max(...sorted.map(recap => recap.generatedAt)),
    isPartial: sorted.some(recap => recap.isPartial), coverageComplete: sorted.every(recap => recap.coverageComplete),
    income: sum(recap => recap.income), expenses: sum(recap => recap.expenses), net: sum(recap => recap.net),
    activityCount: sum(recap => recap.activityCount), purchaseCount, spendingDays: sum(recap => recap.spendingDays),
    purchaseProfile: null,
    highlights: {
      averagePurchaseAmount: purchaseTotal !== null && purchaseCount > 0 ? Math.round(purchaseTotal / purchaseCount) : null,
      peakSpendingDay: peaks.sort((a, b) => b.amount - a.amount)[0] ?? null,
      topPurchases: sorted.flatMap(recap => recap.highlights?.topPurchases ?? []).sort((a, b) => b.amount - a.amount).slice(0, 5),
      repeatPurchases: [...repeats.values()].sort((a, b) => b.occurrences - a.occurrences || b.totalAmount - a.totalAmount).slice(0, 2),
    },
    daily: sorted.every(recap => recap.daily) ? sorted.flatMap(recap => recap.daily ?? []) : undefined,
    categories: [...categories.values()].sort((a, b) => b.amount - a.amount),
    baseline: null,
    budget: budgets.length ? {
      planned, spent, remaining: planned - spent, percentUsed: planned > 0 ? Math.round(spent / planned * 100) : null,
      categoryCount: Math.max(...budgets.map(budget => budget.categoryCount)),
      unbudgetedExpenses: budgets.reduce((total, budget) => total + budget.unbudgetedExpenses, 0),
      overBudgetCategoryCount: budgets.reduce((total, budget) => total + budget.overBudgetCategoryCount, 0),
      overBudgetCategories: budgets.flatMap(budget => budget.overBudgetCategories).sort((a, b) => b.over - a.over).slice(0, 3),
    } : null,
    largestPurchase: largest,
    comparison: null,
    yearPeriods: sorted,
  };
}

/** A year recap travels through the viewer as an unsaved edition with no written copy of its own. */
export function yearEdition(recap: PeriodRecap, year: number): SavedRecapStory {
  return { snapshot: recap, copy: { headline: `${year}, in review`, deck: 'Your whole year of receipts.', chapters: [] }, savedAt: recap.generatedAt, source: 'template', seed: year };
}
