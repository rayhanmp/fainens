import { db } from "../db/client";
import { sql } from 'drizzle-orm';
import { salaryPeriods } from "../db/schema";
import { getFinancialFacts, type FinancialFacts } from "./financial-facts";
import { inclusivePeriodEnd } from "./period-locking";

export class RecapPeriodError extends Error {
  constructor(message: string, public readonly status: 400 | 404) { super(message); }
}
async function recapPeriods() {
  return db.select({ id: salaryPeriods.id, name: salaryPeriods.name, startDate: salaryPeriods.startDate,
    endDate: salaryPeriods.endDate, coverageStatus: salaryPeriods.coverageStatus }).from(salaryPeriods);
}

export function summarizeRecap(facts: FinancialFacts) {
  const expenses = facts.rows.filter(row => row.expenseCents > 0);
  const activity = facts.rows.filter(row => row.expenseCents !== 0 || row.incomeCents !== 0);
  const days = new Set(expenses.map(row => new Date(row.date).toISOString().slice(0, 10)));
  const largest = [...expenses].sort((a, b) => b.expenseCents - a.expenseCents || a.id - b.id)[0];
  const amounts = expenses.map(row => row.expenseCents).sort((a, b) => a - b);
  const purchaseTotal = amounts.reduce((sum, amount) => sum + amount, 0);
  const middle = Math.floor(amounts.length / 2);
  const topPurchases = [...expenses]
    .sort((a, b) => b.expenseCents - a.expenseCents || a.date - b.date || a.id - b.id)
    .slice(0, 3)
    .map(row => ({ description: row.description || "A recorded purchase", amount: row.expenseCents,
      date: row.date, category: row.category ?? "Unallocated" }));
  const repeatedPurchases = new Map<string, { description: string; occurrences: number; totalAmount: number; category: string }>();
  for (const row of expenses) {
    const description = row.description.trim();
    if (!description) continue;
    const key = description.toLowerCase();
    const repeated = repeatedPurchases.get(key) ?? { description, occurrences: 0, totalAmount: 0, category: row.category ?? "Unallocated" };
    repeated.occurrences += 1;
    repeated.totalAmount += row.expenseCents;
    repeatedPurchases.set(key, repeated);
  }
  const daily = new Map<number, { amount: number; purchaseCount: number }>();
  for (const row of facts.rows) {
    if (!row.expenseCents) continue;
    const date = Math.floor(row.date / 86_400_000) * 86_400_000;
    const day = daily.get(date) ?? { amount: 0, purchaseCount: 0 };
    day.amount += row.expenseCents;
    if (row.expenseCents > 0) day.purchaseCount += 1;
    daily.set(date, day);
  }
  const peak = [...daily].filter(([, value]) => value.amount > 0).sort((a, b) => b[1].amount - a[1].amount || a[0] - b[0])[0];
  return {
    highlights: {
      averagePurchaseAmount: expenses.length ? Math.round(expenses.reduce((sum, row) => sum + row.expenseCents, 0) / expenses.length) : null,
      peakSpendingDay: peak ? { date: peak[0], ...peak[1] } : null,
      topPurchases,
      repeatPurchases: [...repeatedPurchases.values()].filter(row => row.occurrences > 1)
        .sort((a, b) => b.occurrences - a.occurrences || b.totalAmount - a.totalAmount).slice(0, 2),
    },
    income: facts.totalIncomeCents,
    expenses: facts.totalSpentCents,
    net: facts.totalIncomeCents - facts.totalSpentCents,
    activityCount: activity.length,
    purchaseCount: expenses.length,
    purchaseProfile: amounts.length ? { totalAmount: purchaseTotal,
      medianAmount: Math.round(amounts.length % 2 ? amounts[middle] : (amounts[middle - 1] + amounts[middle]) / 2) } : null,
    spendingDays: days.size,
    categories: facts.byCategory.filter(row => row.spentCents > 0).map(row => ({ name: row.category, amount: row.spentCents })),
    largestPurchase: largest ? { description: largest.description || "A recorded purchase", amount: largest.expenseCents, date: largest.date } : null,
  };
}

export function summarizeRecapBudget(facts: FinancialFacts, plans: Array<{ categoryId: number; name: string; plannedAmount: number }>) {
  if (!plans.length) return null;
  const spentByCategory = new Map(facts.byCategory.map(row => [row.categoryId, row.spentCents]));
  const allocations = new Map<number, { name: string; planned: number; spent: number }>();
  for (const plan of plans) {
    const previous = allocations.get(plan.categoryId);
    allocations.set(plan.categoryId, { name: plan.name, planned: (previous?.planned ?? 0) + plan.plannedAmount,
      spent: spentByCategory.get(plan.categoryId) ?? 0 });
  }
  const rows = [...allocations.values()];
  const planned = rows.reduce((sum, row) => sum + row.planned, 0);
  const spent = rows.reduce((sum, row) => sum + row.spent, 0);
  const over = rows.filter(row => row.spent > row.planned)
    .map(row => ({ ...row, over: row.spent - row.planned })).sort((a, b) => b.over - a.over || a.name.localeCompare(b.name));
  return { planned, spent, remaining: planned - spent, percentUsed: planned > 0 ? Math.round(spent / planned * 100) : null,
    categoryCount: rows.length, unbudgetedExpenses: facts.totalSpentCents - spent,
    overBudgetCategoryCount: over.length, overBudgetCategories: over.slice(0, 3) };
}

export async function listRecapPeriods(now = Date.now()) {
  const periods = await recapPeriods();
  return periods.filter(period => period.startDate <= now)
    .sort((a, b) => b.startDate - a.startDate || b.id - a.id)
    .map(({ id, name, startDate, endDate }) => ({ id, name, startDate, endDate, isPartial: now <= inclusivePeriodEnd(endDate) }));
}

export async function getPeriodRecap(periodId: number, now = Date.now()) {
  const periods = await recapPeriods();
  const selected = periods.find(period => period.id === periodId);
  if (!selected) throw new RecapPeriodError("This salary period does not exist", 404);
  if (selected.startDate > now) throw new RecapPeriodError("This salary period has not started yet", 400);
  const { id, name, startDate, endDate } = selected;
  const endMs = inclusivePeriodEnd(endDate);
  const previous = periods.filter(period => period.startDate < startDate)
    .sort((a, b) => b.startDate - a.startDate || b.id - a.id)[0];
  const isPartial = now <= endMs;
  const coverageComplete = selected.coverageStatus === "complete";
  // Use the same explicit assignment as the dashboard; dates alone cannot
  // attribute unassigned or other-period journals to this edition.
  const comparable = !isPartial && coverageComplete && previous?.coverageStatus === "complete"
    && inclusivePeriodEnd(previous.endDate) < startDate;
  const [facts, previousFacts, plans] = await Promise.all([
    getFinancialFacts({ periodId: id, startMs: startDate, endMs, asOfMs: Math.min(now, endMs) }),
    comparable ? getFinancialFacts({ periodId: previous.id, startMs: previous.startDate,
      endMs: inclusivePeriodEnd(previous.endDate) }) : Promise.resolve(null),
    db.all(sql`SELECT bp.category_id AS categoryId, c.name AS name, bp.planned_amount AS plannedAmount
      FROM budget_plan bp INNER JOIN category c ON c.id = bp.category_id WHERE bp.period_id = ${id}`) as Array<{ categoryId: number; name: string; plannedAmount: number }>,
  ]);
  const canCompare = previousFacts && previousFacts.totalSpentCents > 0 && facts.totalSpentCents >= 0;
  const duration = endMs - startDate + 1;
  const elapsed = Math.min(now, endMs) - startDate + 1;
  // A still-running edition gets the same elapsed slice of each historical
  // period. Only known-complete coverage can support a historical baseline.
  const baselinePeriods = coverageComplete ? periods
    .filter(period => period.startDate < startDate && period.coverageStatus === "complete"
      && inclusivePeriodEnd(period.endDate) < startDate
      && Math.abs(inclusivePeriodEnd(period.endDate) - period.startDate + 1 - duration) <= 3 * 86_400_000
      && (!isPartial || inclusivePeriodEnd(period.endDate) - period.startDate + 1 >= elapsed))
    .sort((a, b) => b.startDate - a.startDate || b.id - a.id).slice(0, 3) : [];
  const historicalFacts = await Promise.all(baselinePeriods.map(period => {
    if (!isPartial && previousFacts && period.id === previous?.id) return previousFacts;
    return getFinancialFacts({ periodId: period.id, startMs: period.startDate,
      endMs: inclusivePeriodEnd(period.endDate),
      ...(isPartial ? { asOfMs: period.startDate + elapsed - 1 } : {}),
    });
  }));
  const average = (select: (facts: FinancialFacts) => number) =>
    historicalFacts.reduce((sum, previous) => sum + select(previous), 0) / historicalFacts.length;
  const baseline = historicalFacts.length ? {
    periodCount: historicalFacts.length, matchedElapsed: isPartial,
    income: average(previous => previous.totalIncomeCents),
    expenses: average(previous => previous.totalSpentCents),
    purchaseCount: average(previous => previous.rows.filter(row => row.expenseCents > 0).length),
    purchaseTotal: average(previous => previous.rows.reduce((sum, row) => sum + Math.max(0, row.expenseCents), 0)),
  } : null;
  return {
    period: { id, name, startDate, endDate }, startMs: startDate, endMs, generatedAt: now,
    isPartial, coverageComplete, ...summarizeRecap(facts),
    budget: summarizeRecapBudget(facts, plans),
    baseline,
    comparison: canCompare ? { periodId: previous!.id, periodName: previous!.name,
      previousExpenses: previousFacts.totalSpentCents,
      changePercent: Math.round((facts.totalSpentCents - previousFacts.totalSpentCents) / previousFacts.totalSpentCents * 1000) / 10,
    } : null,
  };
}
