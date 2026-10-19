import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn } from '../../lib/utils';
import { CategoryIcon } from './CategoryIcon';
import { usePeriodCategoryUsageQuery } from './page-queries';
import { shortRupiah } from './short-rupiah';

type Category = { id: number; name: string; color: string | null };
type Series = { id: number; name: string; color: string; values: number[]; total: number };

/** Colour for a category that has since been deleted and so has no colour of its own. */
const OTHER_COLOR = 'var(--ref-outline-variant)';

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

const PLOT_HEIGHT = 240;

/** A round gridline step (1, 2, 2.5 or 5 × 10ⁿ) that splits max into about `intervals` parts. */
function niceStep(max: number, intervals: number) {
  const raw = max / intervals;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;
}

const changeTone = (change: number) => (change > 0.05 ? 'text-[var(--color-danger)]' : change < -0.05 ? 'text-[var(--color-success)]' : 'text-[var(--ref-on-surface-variant)]');

function ChangeLabel({ change }: { change: number }) {
  const Icon = change > 0.05 ? ArrowUpRight : change < -0.05 ? ArrowDownRight : Minus;
  return (
    <span className={cn('inline-flex items-center gap-0.5 tabular-nums', changeTone(change))}>
      <Icon className="h-3 w-3" aria-hidden />
      {Math.abs(Math.round(change * 100))}%
    </span>
  );
}

type Segment = { item: Series; value: number };

/**
 * Spending per salary period as stacked columns, the biggest categories at the bottom. Hovering a
 * column lists what it is made of; clicking a legend entry (or a trend row) focuses that category.
 * The period still under way is drawn lighter, labelled "so far" and left out of the average.
 */
export function PeriodSpendChart({ categories, focus, onFocusChange }: { categories: Category[]; focus: number | null; onFocusChange: (id: number | null) => void }) {
  const { formatAmount, balancesHidden } = useBalanceVisibility();
  const { periods, ranked, isLoading, isFetching } = usePeriodSeries(categories, 8);
  const [hover, setHover] = useState<{ period: number; series: number | null } | null>(null);
  const [legendHover, setLegendHover] = useState<number | null>(null);
  const [now] = useState(() => Date.now());
  const short = (value: number) => (balancesHidden ? formatAmount(value) : shortRupiah(value));

  // Every category keeps its own band and colour; nothing is folded away.
  const series = ranked;
  const totals = periods.map((_, index) => series.reduce((sum, item) => sum + item.values[index], 0));
  const focused = series.find((item) => item.id === focus) ?? null;
  const values = periods.map((_, index) => (focused ? focused.values[index] : totals[index]));
  const max = Math.max(1, ...values);
  // A round ceiling a little above the tallest column leaves room for its label.
  const step = niceStep(max, 4);
  const ceiling = step * Math.max(1, Math.ceil(max / step));
  // Label every other step so the axis says the scale without filling the plot with lines.
  const stepCount = Math.round(ceiling / step);
  const ticks = Array.from({ length: stepCount + 1 }, (_, index) => index * step).filter((_, index) => stepCount <= 2 || index % 2 === 0 || index === stepCount);
  const running = periods.map((period) => period.endDate > now);
  const complete = periods.map((_, index) => index).filter((index) => !running[index]);
  // The header stats follow the focused category, else the one hovered in the legend, else everything.
  const statSeries = focused ?? series.find((item) => item.id === legendHover) ?? null;
  const statValues = statSeries ? statSeries.values : totals;
  const average = complete.length > 0 ? complete.reduce((sum, index) => sum + statValues[index], 0) / complete.length : null;
  const peak = complete.length > 0 ? complete.reduce((best, index) => (statValues[index] > statValues[best] ? index : best), complete[0]) : null;
  const statTotal = statValues.reduce((sum, value) => sum + value, 0);
  const changeAt = (index: number) => (index > 0 && !running[index] && values[index - 1] > 0 ? (values[index] - values[index - 1]) / values[index - 1] : null);
  const grandTotal = totals.reduce((sum, value) => sum + value, 0);

  const segmentsAt = (index: number): Segment[] =>
    (focused ? [focused] : series).map((item) => ({ item, value: item.values[index] })).filter((segment) => segment.value > 0);

  return (
    <section id="spending-by-period" className="scroll-mt-6 rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-[var(--color-border)] px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ref-on-surface)]">
            Spending by period
            {focused && (
              <button
                type="button"
                onClick={() => onFocusChange(null)}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ref-surface-container-low)] py-0.5 pl-2 pr-2.5 text-[11px] font-medium text-[var(--ref-on-surface)] hover:bg-[var(--ref-surface-container)]"
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: focused.color }} aria-hidden />
                {focused.name}
                <span className="text-[var(--ref-on-surface-variant)]" aria-label="Show every category">×</span>
              </button>
            )}
          </h2>
          <p className="text-xs text-[var(--ref-on-surface-variant)]">{focused ? 'One category across the salary periods. Clear it to see every category.' : 'Each salary period, split by category. Hover a column for its breakdown.'}</p>
        </div>
        {periods.length > 0 && (
          <dl className="flex items-end gap-6 text-right" aria-live="polite">
            <div className="flex items-center gap-1.5 self-center text-xs font-medium text-[var(--ref-on-surface)]">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: statSeries?.color ?? 'var(--ref-on-surface)' }} aria-hidden />
              {statSeries ? statSeries.name : 'All categories'}
            </div>
            <div>
              <dt className="text-[11px] text-[var(--ref-on-surface-variant)]">Total, {periods.length} periods</dt>
              <dd className="text-sm font-semibold tabular-nums text-[var(--ref-on-surface)]">{short(statTotal)}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-[var(--ref-on-surface-variant)]">Average period</dt>
              <dd className="text-sm font-semibold tabular-nums text-[var(--ref-on-surface)]">{average != null ? short(average) : '—'}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-[var(--ref-on-surface-variant)]">Highest</dt>
              <dd className="text-sm font-semibold tabular-nums text-[var(--ref-on-surface)]">{peak != null ? `${short(statValues[peak])} · ${shortPeriod(periods[peak].name)}` : '—'}</dd>
            </div>
          </dl>
        )}
      </div>

      {isLoading ? (
        <p className="px-5 py-10 text-sm text-[var(--ref-on-surface-variant)]">Loading…</p>
      ) : periods.length === 0 ? (
        <p className="px-5 py-10 text-sm text-[var(--ref-on-surface-variant)]">No salary periods yet.</p>
      ) : (
        <div className={cn('px-5 pb-5 pt-10 transition-opacity', isFetching && 'opacity-60')}>
          <div className="relative" style={{ height: PLOT_HEIGHT }}>
            <span className="absolute -top-7 left-0 text-[10px] font-medium uppercase tracking-wide text-[var(--ref-outline)]">Spending (Rp)</span>
            {ticks.map((tick) => (
              <div key={tick} className="pointer-events-none absolute inset-x-0 flex translate-y-1/2 items-center gap-2" style={{ bottom: `${(tick / ceiling) * 100}%` }} aria-hidden>
                <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-[var(--ref-outline)]">{tick === 0 ? '0' : short(tick).replace(/^Rp/, '')}</span>
                <span className={cn('h-px flex-1', tick === 0 ? 'bg-[var(--ref-outline-variant)]' : 'bg-[var(--color-border)] opacity-50')} />
              </div>
            ))}
            <div className="absolute inset-y-0 left-14 right-0 flex items-end gap-2 sm:gap-4" onMouseLeave={() => setHover(null)}>
              {periods.map((period, periodIndex) => {
                const columnTotal = values[periodIndex];
                const segments = segmentsAt(periodIndex);
                const isHovered = hover?.period === periodIndex;
                // Legend hover only dims while every category is shown; a focused chart stays as it is.
                const legendDim = focused ? null : legendHover;
                const dimmed = (hover != null && !isHovered) || (legendDim != null && !segments.some((segment) => segment.item.id === legendDim));
                const tooltipLeft = periodIndex < periods.length / 2;
                return (
                  <div
                    key={period.id}
                    className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end outline-none"
                    onMouseEnter={() => setHover({ period: periodIndex, series: null })}
                    onFocus={() => setHover({ period: periodIndex, series: null })}
                    onBlur={() => setHover(null)}
                    tabIndex={0}
                    role="img"
                    aria-label={`${period.name}${running[periodIndex] ? ' (so far)' : ''}: ${formatAmount(columnTotal)}`}
                  >
                    <span className={cn('pointer-events-none absolute -inset-x-1 inset-y-0 rounded-xl bg-[var(--ref-surface-container-low)] transition-opacity sm:-inset-x-1.5', isHovered ? 'opacity-100' : 'opacity-0')} aria-hidden />
                    <span className={cn('relative mb-1.5 truncate text-[11px] font-semibold tabular-nums transition-opacity', isHovered ? 'text-[var(--ref-on-surface)]' : 'text-[var(--ref-on-surface-variant)]', dimmed && 'opacity-50')}>
                      {columnTotal > 0 ? short(columnTotal) : ''}
                    </span>
                    <div
                      className={cn('relative flex w-full max-w-[3.25rem] flex-col-reverse gap-px overflow-hidden rounded-t-md transition-opacity', dimmed && 'opacity-40', !dimmed && running[periodIndex] && 'opacity-55')}
                      style={{ height: `${(columnTotal / ceiling) * 100}%` }}
                    >
                      {segments.map(({ item, value }) => (
                        <div
                          key={item.id}
                          onMouseEnter={() => setHover({ period: periodIndex, series: item.id })}
                          className="w-full min-h-px transition-opacity"
                          style={{
                            flex: `${value} 1 0`,
                            backgroundColor: item.color,
                            opacity: (isHovered && hover?.series != null && hover.series !== item.id) || (legendDim != null && legendDim !== item.id) ? 0.3 : 1,
                          }}
                        />
                      ))}
                    </div>

                    {isHovered && (
                      <PeriodTooltip
                        name={period.name}
                        running={running[periodIndex]}
                        total={columnTotal}
                        periodTotal={totals[periodIndex]}
                        change={changeAt(periodIndex)}
                        segments={segments}
                        activeId={hover?.series ?? null}
                        focused={focused != null}
                        format={formatAmount}
                        side={tooltipLeft ? 'right' : 'left'}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="ml-14 mt-2 flex gap-2 sm:gap-4">
            {periods.map((period, index) => (
              <p key={period.id} className={cn('min-w-0 flex-1 truncate text-center text-xs', hover?.period === index ? 'font-semibold text-[var(--ref-on-surface)]' : 'text-[var(--ref-on-surface-variant)]')}>
                {shortPeriod(period.name)}
                {running[index] && <span className="text-[var(--ref-outline)]"> · so far</span>}
              </p>
            ))}
          </div>

          {/* Hovering or focusing a category shows its total and averages in the header. */}
          <div className="mt-5 flex flex-wrap items-center gap-x-1 gap-y-1" role="radiogroup" aria-label="Focus on a category" onMouseLeave={() => setLegendHover(null)}>
            {series.map((item) => {
              const active = focus === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  title={`${item.name}: ${formatAmount(item.total)}${grandTotal > 0 ? ` · ${Math.round((item.total / grandTotal) * 100)}% of the ${periods.length} periods` : ''}`}
                  onClick={() => onFocusChange(active ? null : item.id)}
                  onMouseEnter={() => setLegendHover(item.id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-[opacity,background-color]',
                    active ? 'bg-[var(--ref-surface-container)] font-medium text-[var(--ref-on-surface)]' : 'text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)] hover:text-[var(--ref-on-surface)]',
                    focus != null && !active && 'opacity-50 hover:opacity-100',
                  )}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} aria-hidden />
                  {item.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

/** What one column is made of: the period's total, its change, and its categories biggest first. */
function PeriodTooltip({ name, running, total, periodTotal, change, segments, activeId, focused, format, side }: {
  name: string;
  running: boolean;
  total: number;
  periodTotal: number;
  change: number | null;
  segments: Segment[];
  activeId: number | null;
  focused: boolean;
  format: (value: number) => string;
  side: 'left' | 'right';
}) {
  const sorted = [...segments].sort((a, b) => b.value - a.value);

  return (
    <div
      className="pointer-events-none absolute top-0 z-30 w-64 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3 text-xs shadow-xl"
      style={side === 'right' ? { left: 'calc(50% + 2.25rem)' } : { right: 'calc(50% + 2.25rem)' }}
      role="status"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold text-[var(--ref-on-surface)]">{name}{running ? ' · so far' : ''}</p>
        {change != null && <ChangeLabel change={change} />}
      </div>
      <p className="mt-0.5 text-base font-bold tabular-nums text-[var(--ref-on-surface)]">{format(total)}</p>
      {focused && periodTotal > 0 && <p className="text-[11px] text-[var(--ref-on-surface-variant)]">{Math.round((total / periodTotal) * 100)}% of {format(periodTotal)} that period</p>}
      {!focused && (
        <ul className="mt-2 space-y-0.5 border-t border-[var(--color-border)] pt-2">
          {sorted.map(({ item, value }) => {
            const highlighted = item.id === activeId;
            return (
              <li key={item.id} className={cn('-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-0.5', highlighted && 'bg-[var(--ref-surface-container-low)]')}>
                <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ backgroundColor: item.color }} aria-hidden />
                <span className={cn('min-w-0 flex-1 truncate', highlighted ? 'font-semibold text-[var(--ref-on-surface)]' : 'text-[var(--ref-on-surface-variant)]')}>{item.name}</span>
                <span className="tabular-nums text-[var(--ref-on-surface)]">{format(value)}</span>
                <span className="w-8 text-right tabular-nums text-[var(--ref-outline)]">{total > 0 ? `${Math.round((value / total) * 100)}%` : ''}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * A small line of one category across the periods. Hovering it shows a crosshair on the nearest
 * period with that period's amount above it.
 */
function Sparkline({ values, labels, color, highlightLast, format }: { values: number[]; labels: string[]; color: string; highlightLast: boolean; format: (value: number) => string }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...values);
  const width = 112;
  const height = 32;
  const x = (index: number) => (values.length <= 1 ? width / 2 : (index / (values.length - 1)) * (width - 8) + 4);
  const y = (value: number) => height - 4 - (value / max) * (height - 8);
  const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  const pick = (clientX: number, rect: DOMRect) => {
    const ratio = (clientX - rect.left) / rect.width;
    setActive(Math.max(0, Math.min(last, Math.round(ratio * last))));
  };
  return (
    <div
      className="relative shrink-0 cursor-crosshair py-1"
      onMouseMove={(event) => pick(event.clientX, event.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setActive(null)}
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
        <polyline points={`${x(0)},${height} ${points} ${x(last)},${height}`} fill={color} fillOpacity={0.1} stroke="none" />
        <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {active != null && <line x1={x(active)} x2={x(active)} y1={0} y2={height} stroke="var(--ref-outline)" strokeWidth={1} strokeDasharray="2 2" />}
        {active != null
          ? <circle cx={x(active)} cy={y(values[active])} r={3.5} fill={color} stroke="var(--ref-surface-container-lowest)" strokeWidth={2} />
          : last >= 0 && <circle cx={x(last)} cy={y(values[last])} r={3} fill={color} stroke="var(--ref-surface-container-lowest)" strokeWidth={2} opacity={highlightLast ? 1 : 0.6} />}
      </svg>
      {active != null && (
        <div
          className="pointer-events-none absolute bottom-full z-20 mb-1 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[var(--ref-on-surface)] px-2 py-1 text-[11px] text-[var(--ref-surface-container-lowest)] shadow-lg"
          style={{ left: x(active) }}
          role="status"
        >
          <span className="opacity-75">{labels[active]}</span> <span className="font-semibold tabular-nums">{format(values[active])}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Each category's spending over the last salary periods as a sparkline, with the latest complete
 * period against the one before it. The period still under way is left out of the comparison.
 * Clicking a row focuses that category in "Spending by period".
 */
export function CategoryTrendTable({ categories, focus, onSelect }: { categories: Category[]; focus: number | null; onSelect: (id: number) => void }) {
  const { formatAmount, balancesHidden } = useBalanceVisibility();
  const short = (value: number) => (balancesHidden ? formatAmount(value) : shortRupiah(value));
  const { periods, ranked, isLoading } = usePeriodSeries(categories, 8);
  const [now] = useState(() => Date.now());
  // Compare whole periods: the latest one that has ended against the one before it.
  const lastComplete = periods.reduce((found, period, index) => (period.endDate <= now ? index : found), -1);
  const previousIndex = lastComplete - 1;
  const labels = periods.map((period) => shortPeriod(period.name));
  const rows = ranked.slice(0, 8).map((series) => {
    const latest = lastComplete >= 0 ? series.values[lastComplete] : 0;
    const before = previousIndex >= 0 ? series.values[previousIndex] : 0;
    return { series, latest, before, change: before > 0 ? (latest - before) / before : null, average: series.total / Math.max(1, periods.length) };
  });

  return (
    <section className="flex h-full flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]">
      <div className="border-b border-[var(--color-border)] px-5 py-3.5">
        <h2 className="text-sm font-semibold text-[var(--ref-on-surface)]">Category trends</h2>
        <p className="text-xs text-[var(--ref-on-surface-variant)]">
          {lastComplete >= 1 ? `${periods[lastComplete].name} against ${periods[previousIndex].name}, and the last ${periods.length} periods.` : 'Needs two finished salary periods to compare.'}
        </p>
      </div>
      {isLoading ? (
        <p className="px-5 py-10 text-sm text-[var(--ref-on-surface-variant)]">Loading…</p>
      ) : (
        // Rows share the card's height, so it ends level with the card beside it.
        <ul className="flex flex-1 flex-col divide-y divide-[var(--color-border)]">
          {rows.map(({ series, latest, change, average }) => {
            const selected = focus === series.id;
            return (
              <li key={series.id} className="flex flex-1">
                <div
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  title={`Show ${series.name} in Spending by period`}
                  onClick={() => onSelect(series.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(series.id);
                    }
                  }}
                  className={cn(
                    'flex flex-1 cursor-pointer items-center gap-3 px-5 py-2.5 outline-none transition-colors hover:bg-[var(--ref-surface-container-low)] focus-visible:bg-[var(--ref-surface-container-low)]',
                    selected && 'bg-[var(--ref-surface-container-low)] shadow-[inset_3px_0_0_var(--ref-primary)]',
                  )}
                >
                  <CategoryIcon name={series.name} color={series.color} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--ref-on-surface)]">{series.name}</p>
                    <p className="truncate text-[11px] text-[var(--ref-on-surface-variant)]">{formatAmount(Math.round(average))} a period on average</p>
                  </div>
                  <Sparkline values={series.values} labels={labels} format={short} color={series.color} highlightLast={lastComplete === series.values.length - 1} />
                  <div className="w-28 shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(latest)}</p>
                    <p className="text-[11px] font-medium">
                      {change == null ? <span className="text-[var(--ref-on-surface-variant)]">new</span> : <ChangeLabel change={change} />}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
