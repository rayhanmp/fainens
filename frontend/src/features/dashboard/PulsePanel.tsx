import { CalendarClock, CircleDollarSign, Flame, Percent } from 'lucide-react';
import { cn, formatDecimal } from '../../lib/utils';
import { panelCard } from './panel-styles';
import { MetricHint } from './MetricHint';
import { PeekableAmount } from './PeekableAmount';
import { formatPercent, paceTone, type PeriodPacing } from './pacing';

export function PulsePanel({ income, expense, isTracked, burnRate, runway, isAnalyticsLoading, formatAmount, pacing, budgetUsedRatio, dailyBudget }: {
  income: number;
  expense: number;
  isTracked: boolean;
  burnRate: number | null;
  runway: { isUnbounded: boolean; runwayMonths: number | null } | null;
  isAnalyticsLoading: boolean;
  formatAmount: (cents: number) => string;
  /** Where today sits in the selected period; null without a selected period. */
  pacing: PeriodPacing | null;
  /** Share of the period's budget spent so far; null when the period is untracked or has no outlook. */
  budgetUsedRatio: number | null;
  dailyBudget: number | null;
}) {
  const net = isTracked ? income - expense : null;
  const savingsRate = net != null && income > 0 ? (net / income) * 100 : null;
  const loadingOr = (value: string) => (isAnalyticsLoading ? 'Loading…' : value);
  return (
    <section aria-label="Financial pulse" className={cn(panelCard, 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4')}>
      <div className="min-w-0 pb-4 md:pb-0 md:pr-5">
        <p className="flex items-center gap-2 text-xs text-[var(--ref-on-surface-variant)]"><CircleDollarSign className="h-4 w-4" />Period cash flow <MetricHint>{isTracked ? `${formatAmount(income)} income minus ${formatAmount(expense)} spending.` : 'Complete period coverage to calculate cash flow.'}</MetricHint></p>
        <p className={cn('mt-1 break-words text-xl font-bold tabular-nums', net == null ? '' : net >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]')}>{net == null ? 'Not tracked' : `${net >= 0 ? '+' : ''}${formatAmount(net)}`}</p>
      </div>
      <div className="min-w-0 border-t border-[var(--color-border)] py-4 md:border-l md:border-t-0 md:px-5 md:py-0">
        <p className="flex items-center gap-2 text-xs text-[var(--ref-on-surface-variant)]"><Percent className="h-4 w-4" />Savings rate <MetricHint>{savingsRate == null ? 'Needs tracked income for this period.' : 'Share of period income retained after recorded spending.'}</MetricHint></p>
        <p className={cn('mt-1 text-xl font-bold tabular-nums', savingsRate != null && savingsRate < 0 ? 'text-[var(--color-danger)]' : 'text-[var(--ref-on-surface)]')}>{savingsRate == null ? '—' : `${formatDecimal(savingsRate)}%`}</p>
      </div>
      <div className="min-w-0 border-t border-[var(--color-border)] pt-4 md:border-t-0 md:pr-5 xl:border-l xl:px-5 xl:pt-0">
        <p className="flex items-center gap-2 text-xs text-[var(--ref-on-surface-variant)]"><Flame className="h-4 w-4" />Monthly burn <MetricHint>Average operating spend over the last three months.</MetricHint></p>
        <p className="mt-1 break-words text-xl font-bold tabular-nums">{burnRate != null ? formatAmount(burnRate) : loadingOr('—')}</p>
      </div>
      <div className="min-w-0 border-t border-[var(--color-border)] pt-4 md:border-t-0 md:border-l md:pl-5 xl:pt-0">
        <p className="flex items-center gap-2 text-xs text-[var(--ref-on-surface-variant)]"><CalendarClock className="h-4 w-4" />Cash runway <MetricHint>Estimated months of liquid cash at the current monthly burn.</MetricHint></p>
        <p className="mt-1 break-words text-xl font-bold tabular-nums">{loadingOr(runway?.isUnbounded ? 'No observed burn' : runway?.runwayMonths != null ? `${formatDecimal(runway.runwayMonths)} months` : '—')}</p>
      </div>
      {pacing && <PacingRow pacing={pacing} budgetUsedRatio={budgetUsedRatio} dailyBudget={dailyBudget} />}
    </section>
  );
}

const paceText = { ok: 'text-[var(--ref-primary)]', warning: 'text-amber-700 dark:text-amber-300', danger: 'text-[var(--color-danger)]' } as const;
const paceFill = { ok: 'bg-[var(--ref-primary)]', warning: 'bg-amber-600', danger: 'bg-[var(--color-danger)]' } as const;

/** Time elapsed versus budget used, on one bar. Desktop only: phones get the Safe daily pace card instead. */
function PacingRow({ pacing, budgetUsedRatio, dailyBudget }: { pacing: PeriodPacing; budgetUsedRatio: number | null; dailyBudget: number | null }) {
  const elapsed = formatPercent(pacing.elapsedRatio);
  const tone = budgetUsedRatio != null ? paceTone(budgetUsedRatio, pacing.elapsedRatio) : null;
  const dayLabel = pacing.status === 'active' ? `Day ${pacing.dayIndex} of ${pacing.totalDays}` : pacing.status === 'ended' ? `Period ended · ${pacing.totalDays} days` : `Not started · ${pacing.totalDays} days`;
  const barLabel = `${elapsed} of the period elapsed${budgetUsedRatio != null ? `, ${formatPercent(budgetUsedRatio)} of the budget used` : ''}`;
  // The pulse card sizes style every direct `div`; a footer keeps this row out of that grid.
  return (
    <footer aria-label="Period pacing" className="col-span-full mt-3 hidden border-t border-[var(--color-border)] pt-2.5 md:block">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-[11px] leading-tight text-[var(--ref-on-surface-variant)]">
        <p><strong className="font-bold text-[var(--ref-on-surface)]">{dayLabel}</strong>{pacing.status === 'active' && <> · <span className="font-semibold text-[var(--ref-primary)]">{elapsed}</span> of the period elapsed</>}</p>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {budgetUsedRatio != null && tone && <p className={cn('font-bold tabular-nums', paceText[tone])}>{formatPercent(budgetUsedRatio)} of budget used</p>}
          {dailyBudget != null && <p>Safe daily pace: <strong className="font-bold text-[var(--ref-on-surface)]"><PeekableAmount cents={dailyBudget} /></strong> per day</p>}
        </div>
      </div>
      <div className="relative mt-1.5 h-1.5 overflow-visible rounded-full bg-[var(--ref-surface-container-highest)]" role="img" aria-label={barLabel}>
        {/* Time elapsed is the pale layer; budget used is the solid layer; the tick is today. */}
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pacing.elapsedRatio * 100}%`, background: 'color-mix(in srgb, var(--ref-primary) 28%, var(--ref-surface-container-highest))' }} />
        {budgetUsedRatio != null && tone && <div className={cn('absolute inset-y-0 left-0 rounded-full', paceFill[tone])} style={{ width: `${Math.min(1, budgetUsedRatio) * 100}%` }} />}
        {pacing.status === 'active' && <div className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-[var(--ref-on-surface)]" style={{ left: `${pacing.elapsedRatio * 100}%` }} title="Today" />}
      </div>
    </footer>
  );
}
