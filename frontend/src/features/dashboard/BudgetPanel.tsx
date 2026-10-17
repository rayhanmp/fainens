import { useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Info } from 'lucide-react';
import type { BudgetOutlook, BudgetPlan } from '../../lib/api';
import { cn } from '../../lib/utils';

type PlanRow = { name: string; actual: number; planned: number; outlook: BudgetOutlook['categories'][number] | null };

const riskRank = { over_budget: 0, at_risk: 1, unknown: 2, within_budget: 3 } as const;
const usedRatio = (actual: number, planned: number) => actual / Math.max(1, planned);

function formatForecastRange(low: number | null, high: number | null, midpoint: number | null, formatAmount: (cents: number) => string): string | null {
  if (midpoint == null) return null;
  if (low == null || high == null || low === high) return formatAmount(midpoint);
  return `${formatAmount(low)}–${formatAmount(high)}`;
}

/** Top five categories: outlook rows by risk, else budget rows by usage, else raw spending. */
function planRowsFor(outlook: BudgetOutlook | null, budgetRows: readonly BudgetPlan[], spending: readonly { category: string; spentCents: number }[]): PlanRow[] {
  if (outlook && outlook.categories.length > 0) {
    return [...outlook.categories]
      .sort((a, b) => riskRank[a.riskStatus] - riskRank[b.riskStatus] || usedRatio(b.actualAmount, b.plannedAmount) - usedRatio(a.actualAmount, a.plannedAmount))
      .slice(0, 5)
      .map((row) => ({ name: row.categoryName, actual: row.actualAmount, planned: row.plannedAmount, outlook: row }));
  }
  if (budgetRows.length > 0) {
    const usedPercent = (row: BudgetPlan) => Math.max(row.percentUsed, usedRatio(row.actualAmount, row.plannedAmount) * 100);
    return [...budgetRows]
      .sort((a, b) => usedPercent(b) - usedPercent(a))
      .slice(0, 5)
      .map((row) => ({ name: row.categoryName, actual: row.actualAmount, planned: row.plannedAmount, outlook: null }));
  }
  return spending.filter((row) => row.spentCents > 0).slice(0, 5)
    .map((row) => ({ name: row.category, actual: row.spentCents, planned: 0, outlook: null }));
}

export function BudgetPanel({ periodId, coverageStatus, isLoading, isTracked, outlook, budgetRows, spending, totalPlanned, remaining, dailyBudget, formatAmount }: {
  periodId: number | null;
  coverageStatus: string | null | undefined;
  isLoading: boolean;
  isTracked: boolean;
  /** May briefly hold the previous period's outlook while the next one loads. */
  outlook: BudgetOutlook | null;
  budgetRows: readonly BudgetPlan[];
  spending: readonly { category: string; spentCents: number }[];
  totalPlanned: number;
  remaining: number;
  dailyBudget: number | null;
  formatAmount: (cents: number) => string;
}) {
  const planRows = useMemo(
    () => planRowsFor(outlook?.periodId === periodId ? outlook : null, budgetRows, spending),
    [budgetRows, outlook, periodId, spending],
  );
  const likelyFinish = outlook ? formatForecastRange(outlook.total.projectedLowAmount, outlook.total.projectedHighAmount, outlook.total.projectedAmount, formatAmount) : null;

  return (
    <div className="dashboard-budget rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">Budget outlook</p>
          <h2 className="mt-1 font-headline text-xl font-extrabold text-[var(--ref-on-surface)]">Spending by category</h2>
        </div>
        {totalPlanned > 0 && isTracked ? <div className="flex flex-col items-end text-right">
          <div className="flex items-center gap-1">
            <p className="text-sm font-bold text-[var(--ref-on-surface)]">{formatAmount(remaining)} remaining</p>
            {outlook && likelyFinish && <div className="group relative">
              <button type="button" aria-label="Show budget outlook" title="Show budget outlook" className="rounded-full p-1 text-[var(--ref-outline)] transition-colors hover:bg-[var(--ref-surface-container-high)] hover:text-[var(--ref-on-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--ref-primary)]"><Info className="h-3.5 w-3.5" /></button>
              <div role="tooltip" className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden w-64 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3 text-left text-xs text-[var(--ref-on-surface)] shadow-lg group-hover:block group-focus-within:block">
                <p className="font-bold">Budget outlook</p>
                <p className="mt-1 leading-relaxed">Likely finish {likelyFinish}.</p>
                {dailyBudget != null && <p className="mt-1 text-[var(--ref-on-surface-variant)]">{formatAmount(dailyBudget)} daily budget for the remaining days.</p>}
                <p className="mt-1 text-[var(--ref-on-surface-variant)]">{outlook.confidence.charAt(0).toUpperCase() + outlook.confidence.slice(1)} confidence · based on {outlook.eligiblePeriodCount} completed periods.</p>
                {outlook.patternReview.applied && <>
                  <p className="mt-1 text-[var(--ref-on-surface-variant)]">Pattern review applied to {outlook.patternReview.categoryCount} categor{outlook.patternReview.categoryCount === 1 ? 'y' : 'ies'}.</p>
                  <p className="mt-1 text-[var(--ref-on-surface-variant)]">Flagged purchase{outlook.patternReview.categoryCount === 1 ? '' : 's'}: {outlook.categories.flatMap((row) => row.patternReview ? [`${row.patternReview.description} (${formatAmount(row.patternReview.amount)}, ${row.patternReview.classification.replace('_', ' ')})`] : []).join(', ')}.</p>
                </>}
              </div>
            </div>}
          </div>
          {likelyFinish && <p className="mt-1 text-xs font-semibold text-[var(--ref-on-surface-variant)]">Likely finish {likelyFinish}</p>}
        </div> : <Link to="/budget" className="text-sm font-bold text-[var(--ref-primary)] hover:underline">{totalPlanned > 0 ? 'Review coverage' : 'Set a budget'}</Link>}
      </div>
      {isLoading
        ? <div className="mt-6 h-56 animate-pulse rounded-2xl bg-[var(--ref-surface-container-highest)]" />
        : !isTracked
          ? <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">Budget and activity actuals are <strong>not tracked</strong> for this {coverageStatus === 'skipped' ? 'skipped' : 'incomplete'} period. Empty totals are not a zero-activity result.</div>
          : planRows.length === 0
            ? <div className="mt-6 rounded-2xl bg-[var(--ref-surface-container-low)] p-6 text-sm text-[var(--ref-on-surface-variant)]">No categorized spending for this period yet. Add transactions or set a budget to start planning.</div>
            : <div className="dashboard-budget-rows mt-6 space-y-5">{planRows.map((row) => <BudgetRow key={row.outlook?.categoryId ?? row.name} row={row} formatAmount={formatAmount} />)}</div>}
      <Link to="/budget" className="mt-6 inline-flex items-center gap-1 text-sm font-bold text-[var(--ref-primary)] hover:underline">Manage budget <ArrowRight className="h-4 w-4" /></Link>
    </div>
  );
}

function BudgetRow({ row, formatAmount }: { row: PlanRow; formatAmount: (cents: number) => string }) {
  const ratio = row.planned > 0 ? row.actual / row.planned : 0;
  const overBudget = row.planned > 0 && ratio > 1;
  const nearBudget = row.planned > 0 && ratio >= 0.75;
  const outlookRange = formatForecastRange(row.outlook?.projectedLowAmount ?? null, row.outlook?.projectedHighAmount ?? null, row.outlook?.projectedAmount ?? null, formatAmount);
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-bold text-[var(--ref-on-surface)]">{row.name}</p>
          <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">{row.planned > 0 ? `${formatAmount(row.actual)} of ${formatAmount(row.planned)}` : `${formatAmount(row.actual)} recorded`}</p>
        </div>
        <p className={cn('text-sm font-bold', overBudget ? 'text-[var(--color-danger)]' : nearBudget ? 'text-amber-700 dark:text-amber-300' : 'text-[var(--ref-primary)]')}>{row.planned > 0 ? `${Math.round(ratio * 100)}%` : formatAmount(row.actual)}</p>
      </div>
      <div className="mt-2 h-3 overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]"><div className={cn('h-full rounded-full', overBudget ? 'bg-[var(--color-danger)]' : nearBudget ? 'bg-amber-600' : 'bg-[var(--ref-primary)]')} style={{ width: `${Math.min(100, row.planned > 0 ? ratio * 100 : 100)}%` }} /></div>
      {outlookRange && <p className={cn('mt-1.5 text-[11px]', row.outlook?.riskStatus === 'at_risk' ? 'text-amber-800 dark:text-amber-200' : 'text-[var(--ref-on-surface-variant)]')}>Outlook: likely {outlookRange} by period end{row.outlook?.scheduledRemainingAmount ? ` · includes ${formatAmount(row.outlook.scheduledRemainingAmount)} scheduled` : ''}.</p>}
    </div>
  );
}
