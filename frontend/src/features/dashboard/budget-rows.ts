import { paceTone, type PaceTone } from './pacing.ts';

export type OutlookCategory = {
  categoryId: number;
  categoryName: string;
  plannedAmount: number;
  actualAmount: number;
  projectedAmount: number | null;
  projectedLowAmount: number | null;
  projectedHighAmount: number | null;
  scheduledRemainingAmount: number;
  riskStatus: 'within_budget' | 'at_risk' | 'over_budget' | 'unknown';
};

export type BudgetPlanRow = { categoryId?: number; categoryName: string; plannedAmount: number; actualAmount: number; percentUsed: number };

export type PlanRow = {
  key: string;
  name: string;
  actual: number;
  planned: number;
  /** Midpoint forecast for the period end, when the outlook has one. */
  projected: number | null;
  projectedLow: number | null;
  projectedHigh: number | null;
  scheduledRemaining: number;
  tone: PaceTone;
};

const riskRank = { over_budget: 0, at_risk: 1, unknown: 2, within_budget: 3 } as const;
const usedRatio = (actual: number, planned: number) => actual / Math.max(1, planned);

/** Already over plan is danger; a forecast past the plan, the outlook's at-risk call or running ahead of the calendar is a warning. */
export function rowTone(row: { actual: number; planned: number; projected: number | null; risk?: OutlookCategory['riskStatus'] }, elapsedRatio: number): PaceTone {
  if (row.planned <= 0) return 'ok';
  if (row.actual > row.planned || row.risk === 'over_budget') return 'danger';
  if (row.risk === 'at_risk' || (row.projected != null && row.projected > row.planned)) return 'warning';
  return paceTone(row.actual / row.planned, elapsedRatio);
}

/** Top categories: outlook rows by risk, else budget rows by usage, else raw spending. */
export function planRowsFor(
  outlook: readonly OutlookCategory[] | null,
  budgetRows: readonly BudgetPlanRow[],
  spending: readonly { category: string; spentCents: number }[],
  elapsedRatio: number,
  limit = 6,
): PlanRow[] {
  if (outlook && outlook.length > 0) {
    return [...outlook]
      .sort((a, b) => riskRank[a.riskStatus] - riskRank[b.riskStatus] || usedRatio(b.actualAmount, b.plannedAmount) - usedRatio(a.actualAmount, a.plannedAmount))
      .slice(0, limit)
      .map((row) => ({
        key: `c${row.categoryId}`, name: row.categoryName, actual: row.actualAmount, planned: row.plannedAmount,
        projected: row.projectedAmount, projectedLow: row.projectedLowAmount, projectedHigh: row.projectedHighAmount, scheduledRemaining: row.scheduledRemainingAmount,
        tone: rowTone({ actual: row.actualAmount, planned: row.plannedAmount, projected: row.projectedAmount, risk: row.riskStatus }, elapsedRatio),
      }));
  }
  if (budgetRows.length > 0) {
    const usedPercent = (row: BudgetPlanRow) => Math.max(row.percentUsed, usedRatio(row.actualAmount, row.plannedAmount) * 100);
    return [...budgetRows]
      .sort((a, b) => usedPercent(b) - usedPercent(a))
      .slice(0, limit)
      .map((row) => ({
        key: row.categoryId != null ? `c${row.categoryId}` : row.categoryName, name: row.categoryName, actual: row.actualAmount, planned: row.plannedAmount,
        projected: null, projectedLow: null, projectedHigh: null, scheduledRemaining: 0,
        tone: rowTone({ actual: row.actualAmount, planned: row.plannedAmount, projected: null }, elapsedRatio),
      }));
  }
  return spending.filter((row) => row.spentCents > 0).slice(0, limit)
    .map((row) => ({ key: row.category, name: row.category, actual: row.spentCents, planned: 0, projected: null, projectedLow: null, projectedHigh: null, scheduledRemaining: 0, tone: 'ok' as const }));
}

/** Counts for the panel subtitle, over the whole outlook rather than the rows shown. */
export function riskCounts(outlook: readonly OutlookCategory[], elapsedRatio: number): { over: number; atRisk: number } {
  let over = 0;
  let atRisk = 0;
  for (const row of outlook) {
    const tone = rowTone({ actual: row.actualAmount, planned: row.plannedAmount, projected: row.projectedAmount, risk: row.riskStatus }, elapsedRatio);
    if (tone === 'danger') over += 1;
    else if (tone === 'warning') atRisk += 1;
  }
  return { over, atRisk };
}
