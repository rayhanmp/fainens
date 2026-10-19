import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn } from '../../lib/utils';
import { CategoryIcon } from './CategoryIcon';
import { usePeriodCategoryUsageQuery } from './page-queries';
import { shortRupiah } from './short-rupiah';

type Category = { id: number; name: string; color: string | null };
type Series = { id: number; name: string; color: string; values: number[]; total: number };

/** Stacked series past this many fold into "Other", so every colour stays tellable apart. */
const MAX_SERIES = 6;
const OTHER_COLOR = 'var(--ref-outline)';

/** "May 2026" → "May"; other names are kept. */
const shortPeriod = (name: string) => name.replace(/\s+20\d\d$/, '').slice(0, 9);

function usePeriodSeries(categories: Category[], count: number) {
  const query = usePeriodCategoryUsageQuery(count);
  const data = useMemo(() => {
    const periods = query.data ?? [];
    const byId = new Map(categories.map((category) => [category.id, category]));
    const all = new Map<number, Series>();
    periods.forEach((period, index) => {
      for (const row of period.categories) {
        const amount = Math.max(0, row.amount);
        if (amount === 0) continue;
        const category = byId.get(row.categoryId);
        const series = all.get(row.categoryId) ?? { id: row.categoryId, name: category?.name ?? 'Archived category', color: category?.color ?? OTHER_COLOR, values: periods.map(() => 0), total: 0 };
        series.values[index] += amount;
        series.total += amount;
        all.set(row.categoryId, series);
      }
    });
    const ranked = [...all.values()].sort((a, b) => b.total - a.total);
    return { periods, ranked };
  }, [query.data, categories]);
  return { ...data, isLoading: query.isPending && !query.data, isFetching: query.isFetching };
}

/**
 * Spending per salary period as stacked columns, the biggest categories on the bottom and the rest
 * folded into "Other". Clicking a legend entry puts that category in focus and greys the others; the
 * period still under way is drawn lighter and labelled "so far".
 */
export function PeriodSpendChart({ categories }: { categories: Category[] }) {
  const { formatAmount, balancesHidden } = useBalanceVisibility();
  const { periods, ranked, isLoading, isFetching } = usePeriodSeries(categories, 8);
  const [focus, setFocus] = useState<number | null>(null);
  const [hover, setHover] = useState<{ period: number; series: number } | null>(null);
  const [now] = useState(() => Date.now());
  const short = (value: number) => (balancesHidden ? formatAmount(value) : shortRupiah(value));

  const shown = ranked.slice(0, MAX_SERIES);
  const rest = ranked.slice(MAX_SERIES);
  const series: Series[] = rest.length > 0
    ? [...shown, { id: -1, name: `Other (${rest.length})`, color: OTHER_COLOR, values: periods.map((_, index) => rest.reduce((sum, item) => sum + item.values[index], 0)), total: rest.reduce((sum, item) => sum + item.total, 0) }]
    : shown;
  const totals = periods.map((_, index) => series.reduce((sum, item) => sum + item.values[index], 0));
  const focused = series.find((item) => item.id === focus) ?? null;
  const columnValue = (index: number) => (focused ? focused.values[index] : totals[index]);
  const max = Math.max(1, ...periods.map((_, index) => columnValue(index)));
  // Three recessive gridlines at round-ish steps.
  const step = (() => {
    const raw = max / 3;
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    return Math.ceil(raw / magnitude) * magnitude;
  })();
  const ceiling = Math.max(max, step * 3);
  const hovered = hover ? { period: periods[hover.period], item: series[hover.series], value: series[hover.series].values[hover.period], total: totals[hover.period] } : null;

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--ref-on-surface)]">Spending by period</h2>
          <p className="text-xs text-[var(--ref-on-surface-variant)]">{focused ? `${focused.name} in each salary period. Click it again to see every category.` : 'Each salary period, split by category. Click a category to focus on it.'}</p>
        </div>
        {hovered && (
          <p className="rounded-lg bg-[var(--ref-surface-container-low)] px-2.5 py-1.5 text-xs text-[var(--ref-on-surface-variant)]" aria-live="polite">
            <span className="font-semibold text-[var(--ref-on-surface)]">{hovered.item.name}</span> · {hovered.period.name} · {formatAmount(hovered.value)} · {hovered.total > 0 ? Math.round((hovered.value / hovered.total) * 100) : 0}% of the period
          </p>
        )}
      </div>

      {isLoading ? (
        <p className="px-5 py-10 text-sm text-[var(--ref-on-surface-variant)]">Loading…</p>
      ) : periods.length === 0 ? (
        <p className="px-5 py-10 text-sm text-[var(--ref-on-surface-variant)]">No salary periods yet.</p>
      ) : (
        <div className={cn('px-5 pb-4 pt-5 transition-opacity', isFetching && 'opacity-60')}>
          <div className="relative h-52">
            {[1, 2, 3].map((line) => (
              <div key={line} className="pointer-events-none absolute inset-x-0 flex items-center gap-2" style={{ bottom: `${((step * line) / ceiling) * 100}%` }} aria-hidden>
                <span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-[var(--ref-outline)]">{short(step * line)}</span>
                <span className="h-px flex-1 bg-[var(--color-border)]" />
              </div>
            ))}
            <div className="absolute inset-y-0 left-16 right-0 flex items-end gap-2 sm:gap-3" onMouseLeave={() => setHover(null)}>
              {periods.map((period, periodIndex) => {
                const running = period.endDate > now;
                return (
                  <div key={period.id} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
                    <span className="mb-1 truncate text-[10px] font-semibold tabular-nums text-[var(--ref-on-surface)]">{columnValue(periodIndex) > 0 ? short(columnValue(periodIndex)) : ''}</span>
                    <div
                      className={cn('flex w-full max-w-14 flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px]', running && 'opacity-60')}
                      style={{ height: `${(columnValue(periodIndex) / ceiling) * 100}%` }}
                      role="img"
                      aria-label={`${period.name}${running ? ' (so far)' : ''}: ${formatAmount(columnValue(periodIndex))}`}
                    >
                      {series.map((item, seriesIndex) => {
                        const value = item.values[periodIndex];
                        if (value <= 0 || (focused && item.id !== focused.id)) return null;
                        return (
                          <div
                            key={item.id}
                            onMouseEnter={() => setHover({ period: periodIndex, series: seriesIndex })}
                            className="w-full shrink-0 transition-opacity"
                            style={{
                              flexBasis: `${(value / columnValue(periodIndex)) * 100}%`,
                              backgroundColor: item.color,
                              opacity: hover && (hover.period !== periodIndex || hover.series !== seriesIndex) ? 0.55 : 1,
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="ml-16 mt-1.5 flex gap-2 sm:gap-3">
            {periods.map((period) => (
              <span key={period.id} className="min-w-0 flex-1 truncate text-center text-[11px] text-[var(--ref-on-surface-variant)]">
                {shortPeriod(period.name)}{period.endDate > now ? ' · so far' : ''}
              </span>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Focus on a category">
            {series.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={focus === item.id}
                onClick={() => setFocus(focus === item.id ? null : item.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-[opacity,background-color]',
                  focus === item.id ? 'border-[var(--ref-on-surface)]/40 bg-[var(--ref-surface-container-low)] text-[var(--ref-on-surface)]' : 'border-[var(--color-border)] text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]',
                  focus != null && focus !== item.id && 'opacity-50',
                )}
              >
                <span className="h-2 w-2 rounded-[3px]" style={{ backgroundColor: item.color }} aria-hidden />
                {item.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Sparkline({ values, color, highlightLast }: { values: number[]; color: string; highlightLast: boolean }) {
  const max = Math.max(1, ...values);
  const width = 96;
  const height = 28;
  const x = (index: number) => (values.length <= 1 ? width / 2 : (index / (values.length - 1)) * (width - 4) + 2);
  const y = (value: number) => height - 3 - (value / max) * (height - 6);
  const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0" aria-hidden>
      <polyline points={`${x(0)},${height} ${points} ${x(last)},${height}`} fill={color} fillOpacity={0.1} stroke="none" />
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {last >= 0 && <circle cx={x(last)} cy={y(values[last])} r={3} fill={color} stroke="var(--ref-surface-container-lowest)" strokeWidth={2} opacity={highlightLast ? 1 : 0.6} />}
    </svg>
  );
}

/**
 * Each category's spending over the last salary periods as a sparkline, with the latest complete
 * period against the one before it. The period still under way is left out of the comparison.
 */
export function CategoryTrendTable({ categories }: { categories: Category[] }) {
  const { formatAmount } = useBalanceVisibility();
  const { periods, ranked, isLoading } = usePeriodSeries(categories, 8);
  const [now] = useState(() => Date.now());
  // Compare whole periods: the latest one that has ended against the one before it.
  const lastComplete = periods.reduce((found, period, index) => (period.endDate <= now ? index : found), -1);
  const previousIndex = lastComplete - 1;
  const rows = ranked.slice(0, 10).map((series) => {
    const latest = lastComplete >= 0 ? series.values[lastComplete] : 0;
    const before = previousIndex >= 0 ? series.values[previousIndex] : 0;
    return { series, latest, before, change: before > 0 ? (latest - before) / before : null, average: series.total / Math.max(1, periods.length) };
  });

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]">
      <div className="border-b border-[var(--color-border)] px-5 py-3.5">
        <h2 className="text-sm font-semibold text-[var(--ref-on-surface)]">Category trends</h2>
        <p className="text-xs text-[var(--ref-on-surface-variant)]">
          {lastComplete >= 1 ? `${periods[lastComplete].name} against ${periods[previousIndex].name}, and the last ${periods.length} periods.` : 'Needs two finished salary periods to compare.'}
        </p>
      </div>
      {isLoading ? (
        <p className="px-5 py-10 text-sm text-[var(--ref-on-surface-variant)]">Loading…</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {rows.map(({ series, latest, change, average }) => {
            const up = change != null && change > 0.05;
            const down = change != null && change < -0.05;
            return (
              <li key={series.id} className="flex items-center gap-3 px-5 py-2.5">
                <CategoryIcon name={series.name} color={series.color} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--ref-on-surface)]">{series.name}</p>
                  <p className="truncate text-[11px] text-[var(--ref-on-surface-variant)]">{formatAmount(Math.round(average))} a period on average</p>
                </div>
                <Sparkline values={series.values} color={series.color} highlightLast={lastComplete === series.values.length - 1} />
                <div className="w-28 shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(latest)}</p>
                  <p className={cn('inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums', up ? 'text-[var(--color-danger)]' : down ? 'text-[var(--color-success)]' : 'text-[var(--ref-on-surface-variant)]')}>
                    {change == null ? 'new' : (
                      <>
                        {up ? <ArrowUpRight className="h-3 w-3" /> : down ? <ArrowDownRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                        {Math.abs(Math.round(change * 100))}%
                      </>
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
