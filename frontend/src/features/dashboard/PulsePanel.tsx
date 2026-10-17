import { CalendarClock, CircleDollarSign, Flame, Percent } from 'lucide-react';
import { cn, formatDecimal } from '../../lib/utils';
import { panelCard } from './panel-styles';
import { MetricHint } from './MetricHint';

export function PulsePanel({ income, expense, isTracked, burnRate, runway, isAnalyticsLoading, formatAmount }: {
  income: number;
  expense: number;
  isTracked: boolean;
  burnRate: number | null;
  runway: { isUnbounded: boolean; runwayMonths: number | null } | null;
  isAnalyticsLoading: boolean;
  formatAmount: (cents: number) => string;
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
    </section>
  );
}
