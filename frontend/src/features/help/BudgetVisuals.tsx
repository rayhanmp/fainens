import { Fragment, type ReactNode } from 'react';
import { BudgetCategoryRow } from '../budgets/BudgetCategoryRow';
import { budgetGroupTitles, budgetLineStatus, compareByUrgency } from '../budgets/budget-line';
import { BudgetPanel } from '../dashboard/BudgetPanel';
import '../dashboard/dashboard.css';
import type { PeriodPacing } from '../dashboard/pacing';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import type { BudgetOutlook, BudgetPlan } from '../../lib/api';
import { cn } from '../../lib/utils';
import { VisualFrame } from './visuals';

/**
 * Budgets, drawn with the app's own components: the Budget page's category rows and the
 * Dashboard's budget health panel, fed sample numbers. Clicks are held so nothing navigates.
 */

const SAMPLE = [
  { id: 1, categoryId: 1, categoryName: 'Food & Dining', color: '#f97316', plannedAmount: 1_500_000, actualAmount: 1_150_000, projectedAmount: 1_640_000 },
  { id: 2, categoryId: 2, categoryName: 'Transportation', color: '#0ea5e9', plannedAmount: 600_000, actualAmount: 540_000, projectedAmount: 760_000 },
  { id: 3, categoryId: 3, categoryName: 'Shopping', color: '#ec4899', plannedAmount: 700_000, actualAmount: 820_000, projectedAmount: 860_000 },
  { id: 4, categoryId: 4, categoryName: 'Entertainment', color: '#8b5cf6', plannedAmount: 400_000, actualAmount: 150_000, projectedAmount: 330_000 },
  { id: 5, categoryId: 5, categoryName: 'Health', color: '#10b981', plannedAmount: 300_000, actualAmount: 0, projectedAmount: 120_000 },
];

const ACTIVE: PeriodPacing = { dayIndex: 18, totalDays: 30, elapsedRatio: 18 / 30, status: 'active' };
const ENDED: PeriodPacing = { dayIndex: 30, totalDays: 30, elapsedRatio: 1, status: 'ended' };

/** The row shows its editing controls, but clicks never reach them (see Inert), so nothing runs. */
const SHOWN_ACTIONS = { savePlanned: () => Promise.resolve(), edit: () => undefined, move: () => undefined, remove: () => undefined };

/** Stops clicks reaching the real components, so their links and menus don’t act; hover hints still work. */
function Inert({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className} onClickCapture={(event) => { event.preventDefault(); event.stopPropagation(); }}>{children}</div>;
}

/** The Budget page's "Category budgets" card, grouped by urgency as the page does. */
function CategoryBudgets({ pacing, closed }: { pacing: PeriodPacing; closed?: boolean }) {
  const { formatAmount } = useBalanceVisibility();
  const rows = SAMPLE.map((row) => ({ row: { ...row, note: null }, status: budgetLineStatus(row, pacing) }));
  rows.sort((a, b) => compareByUrgency(a.status, b.status));
  return (
    <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-4 shadow-sm sm:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-headline text-xl font-bold text-[var(--ref-on-surface)]">Category budgets</h2>
          <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">{pacing.status === 'active' ? `Day ${pacing.dayIndex} of ${pacing.totalDays}, ${pacing.totalDays - pacing.dayIndex + 1} days left. Open a category to review its transactions.` : 'Open a category to review its transactions.'}</p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">{rows.length} categories</span>
      </div>
      <ul className="-mx-2 space-y-1 sm:-mx-3">
        {rows.map(({ row, status }, index) => {
          const startsGroup = index === 0 || rows[index - 1]!.status.group !== status.group;
          return (
            <Fragment key={row.id}>
              {startsGroup && (
                <li aria-hidden className={cn('flex items-center gap-3 px-2 text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)] sm:px-3', index > 0 ? 'pt-4 pb-1' : 'pb-1')}>
                  {budgetGroupTitles[status.group]}<span className="h-px flex-1 bg-[var(--color-border)]" />
                </li>
              )}
              <BudgetCategoryRow row={row} categoryColor={row.color} status={status} tracked showLabel={false} periodId="0" formatAmount={formatAmount} actions={closed ? null : SHOWN_ACTIONS} />
            </Fragment>
          );
        })}
      </ul>
    </div>
  );
}

/** The Budget page’s category list, as it looks on day 18 of 30. */
export function BudgetRowsDemo() {
  return (
    <VisualFrame caption="The Budget page’s own category rows, with sample amounts. Hover a row for its details.">
      <Inert className="mx-auto max-w-2xl"><CategoryBudgets pacing={ACTIVE} /></Inert>
    </VisualFrame>
  );
}

/** A closed period’s budget: the same rows, read-only, under the closed-period notice. */
export function ClosedBudgetDemo() {
  return (
    <VisualFrame caption="In a closed period the plan can’t be edited, and the notice says how to reopen it.">
      <Inert className="mx-auto max-w-2xl space-y-4">
        <div className="rounded-xl border border-[var(--color-warning)] bg-[var(--color-warning)]/10 px-4 py-3 text-sm text-[var(--color-text-primary)]">
          This accounting period is closed. Budget history is read-only until it is reopened from Salary Periods.
        </div>
        <CategoryBudgets pacing={ENDED} closed />
      </Inert>
    </VisualFrame>
  );
}

/** The Dashboard’s budget health panel, with a sample forecast for each category. */
export function BudgetForecastDemo() {
  const { formatAmount } = useBalanceVisibility();
  const planned = SAMPLE.reduce((sum, row) => sum + row.plannedAmount, 0);
  const actual = SAMPLE.reduce((sum, row) => sum + row.actualAmount, 0);
  const projected = SAMPLE.reduce((sum, row) => sum + row.projectedAmount, 0);
  const risk = (row: (typeof SAMPLE)[number]) => (row.actualAmount > row.plannedAmount ? 'over_budget' : row.projectedAmount > row.plannedAmount ? 'at_risk' : 'within_budget') as BudgetOutlook['total']['riskStatus'];
  const outlook: BudgetOutlook = {
    periodId: 1,
    asOfMs: 0,
    totalDays: 30,
    daysElapsed: 18,
    daysRemaining: 12,
    eligiblePeriodCount: 4,
    confidence: 'moderate',
    method: 'completed_cycle_median',
    patternReview: { applied: false, categoryCount: 0, evidenceRevision: 0 },
    total: { plannedAmount: planned, actualAmount: actual, remainingAmount: planned - actual, scheduledRemainingAmount: 186_000, projectedAmount: projected, projectedLowAmount: projected - 300_000, projectedHighAmount: projected + 300_000, riskStatus: projected > planned ? 'at_risk' : 'within_budget' },
    categories: SAMPLE.map((row) => ({
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      plannedAmount: row.plannedAmount,
      actualAmount: row.actualAmount,
      remainingAmount: row.plannedAmount - row.actualAmount,
      scheduledRemainingAmount: 0,
      historicalRemainingAmount: row.projectedAmount - row.actualAmount,
      projectedAmount: row.projectedAmount,
      projectedLowAmount: row.projectedAmount - 60_000,
      projectedHighAmount: row.projectedAmount + 60_000,
      riskStatus: risk(row),
      historicalSampleCount: 4,
      outlierCount: 0,
      evidencePeriodIds: [],
      historicalSampleAmounts: [],
      patternReview: null,
    })),
  };
  const budgetRows: BudgetPlan[] = SAMPLE.map((row) => ({ id: row.id, periodId: 1, categoryId: row.categoryId, plannedAmount: row.plannedAmount, actualAmount: row.actualAmount, variance: row.plannedAmount - row.actualAmount, percentUsed: Math.round((row.actualAmount / row.plannedAmount) * 100), categoryName: row.categoryName, note: null }));

  return (
    <VisualFrame caption="The Dashboard’s budget health panel with sample numbers: each tile is sized by its plan and marks where it’s likely to finish.">
      <Inert className="mx-auto max-w-3xl">
        <BudgetPanel periodId={1} coverageStatus="complete" isLoading={false} isTracked outlook={outlook} budgetRows={budgetRows} spending={[]} totalPlanned={planned} remaining={planned - actual} dailyBudget={Math.round((planned - actual) / 12)} formatAmount={formatAmount} />
      </Inert>
    </VisualFrame>
  );
}
