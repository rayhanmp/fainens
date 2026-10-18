import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { useId, useMemo, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceDot,
} from 'recharts';
import { formatCurrency as visibleCurrency, cn, formatDecimal } from '../../lib/utils';
import { HIDDEN_BALANCE } from '../../lib/balance-visibility';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useNetWorthTrendQuery, type NetWorthRange } from '../../features/analytics/queries';
import { monthTicks, paydayMarkers } from '../../features/analytics/net-worth-trend';
import { usePeriodsQuery } from '../../features/periods/queries';
import type { GetNetWorthTrend200 } from '../../generated/client';

const RANGE_OPTIONS: Array<{
  range: NetWorthRange;
  label: string;
  /** Screen reader / title */
  description: string;
}> = [
  { range: 'period', label: 'Period', description: 'The selected salary period, one point per day' },
  { range: '7d', label: '7D', description: 'Last 7 days, one point per day' },
  { range: '30d', label: '30D', description: 'Last 30 days, one point per day' },
  { range: '3m', label: '3M', description: 'Last 3 months, one point per week' },
  { range: '6m', label: '6M', description: 'Last 6 months, one point per week' },
  { range: '1y', label: '1Y', description: 'Last 12 months, one point per week' },
];

const DEFAULT_RANGE: NetWorthRange = '30d';
const RANGE_STORAGE_KEY = 'fainens.dashboard.net-worth-range';
/** Above this many points the per-point dots become noise, so only the line and hover dot remain. */
const MAX_DOTTED_POINTS = 31;

const isRange = (value: unknown): value is NetWorthRange => RANGE_OPTIONS.some((option) => option.range === value);

function readStoredRange(): NetWorthRange {
  try {
    const stored = localStorage.getItem(RANGE_STORAGE_KEY);
    return isRange(stored) ? stored : DEFAULT_RANGE;
  } catch {
    return DEFAULT_RANGE;
  }
}

function storeRange(range: NetWorthRange) {
  try {
    localStorage.setItem(RANGE_STORAGE_KEY, range);
  } catch {
    // Browser storage can be unavailable in private or restricted contexts.
  }
}

function compactAxisIdr(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${formatDecimal(v / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${formatDecimal(v / 1_000_000)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return String(Math.round(v));
}

function chartIndex(state: unknown): number | null {
  if (!state || typeof state !== 'object') return null;
  const value = (state as { activeTooltipIndex?: number | string }).activeTooltipIndex;
  if (value == null) return null;
  const index = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

const shortDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const longDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

type Row = GetNetWorthTrend200['series'][number];

export function NetWorthChart({ className = '', hideAmounts, periodId = null }: { className?: string; hideAmounts?: boolean; periodId?: number | null } = {}) {
  const { balancesHidden } = useBalanceVisibility();
  const amountsHidden = hideAmounts ?? balancesHidden;
  const formatCurrency = (value: number) => amountsHidden ? HIDDEN_BALANCE : visibleCurrency(value);
  const gradientId = useId().replace(/:/g, '');
  const [storedRange, setRange] = useState<NetWorthRange>(readStoredRange);
  // The period range follows the dashboard's period picker; without a period it falls back to the default.
  const range: NetWorthRange = storedRange === 'period' && periodId == null ? DEFAULT_RANGE : storedRange;
  const [compareStartIndex, setCompareStartIndex] = useState<number | null>(null);
  const [compareEndIndex, setCompareEndIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const netWorthQuery = useNetWorthTrendQuery(range, periodId);
  const periodsQuery = usePeriodsQuery();
  const series = netWorthQuery.data?.series;
  const rows: Row[] = useMemo(() => series ?? [], [series]);
  const isLoading = netWorthQuery.isPending && netWorthQuery.data == null;
  const loadError = netWorthQuery.error instanceof Error ? netWorthQuery.error.message : null;

  const selectRange = (next: NetWorthRange) => {
    setRange(next);
    storeRange(next);
    clearComparison();
    setHoverIndex(null);
  };

  // Paydays are only named in the tooltip; drawing them on the chart was too noisy.
  const paydays = useMemo(() => paydayMarkers(rows, periodsQuery.data ?? []), [rows, periodsQuery.data]);
  const ticks = useMemo(() => (rows.length > MAX_DOTTED_POINTS ? monthTicks(rows) : null), [rows]);
  const tickText = useMemo(() => new Map(ticks?.map((tick) => [tick.label, tick.text])), [ticks]);

  // A zero-based axis hides the useful movement when the balance is large and
  // the period's changes are comparatively small. Keep a little breathing
  // room around the observed values while preserving the sign of the data.
  const netWorthValues = rows.map((row) => row.netWorth);
  const observedMin = netWorthValues.length > 0 ? Math.min(...netWorthValues) : 0;
  const observedMax = netWorthValues.length > 0 ? Math.max(...netWorthValues) : 0;
  const observedRange = observedMax - observedMin;
  const minimumVisibleRange = Math.max(Math.abs(observedMax), Math.abs(observedMin), 1) * 0.01;
  const chartPadding = Math.max(observedRange, minimumVisibleRange, 1_000) * 0.15;
  const chartDomainMin = observedMin >= 0 ? Math.max(0, observedMin - chartPadding) : observedMin - chartPadding;
  const chartDomainMax = observedMax <= 0 && observedMin !== observedMax
    ? Math.min(0, observedMax + chartPadding)
    : observedMax + chartPadding;
  const yAxisDomain: [number, number] = [chartDomainMin, chartDomainMax];
  const yAxisLabelLength = Math.max(
    ...[chartDomainMin, chartDomainMax, observedMin, observedMax, 0]
      .map((value) => compactAxisIdr(value).length),
  );
  const yAxisWidth = Math.max(36, Math.min(56, Math.ceil(yAxisLabelLength * 6.5 + 5)));

  // Hovering a point moves the headline to it; otherwise the headline is the latest point.
  const focusRow = hoverIndex != null ? rows[hoverIndex] ?? null : null;
  const headlineRow = focusRow ?? rows[rows.length - 1] ?? null;
  const currentNetWorth = headlineRow?.netWorth ?? 0;
  const previousNetWorth = rows.length > 0 ? rows[0].netWorth : currentNetWorth;

  const netWorthChange = currentNetWorth - previousNetWorth;
  const netWorthChangePercent =
    previousNetWorth !== 0 ? (netWorthChange / Math.abs(previousNetWorth)) * 100 : 0;

  const getTrendIcon = () => {
    if (netWorthChange > 0) return <TrendingUp className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />;
    if (netWorthChange < 0) return <TrendingDown className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />;
    return <Minus className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />;
  };

  const getTrendColor = () => {
    if (netWorthChange > 0) return 'text-[var(--color-success)]';
    if (netWorthChange < 0) return 'text-[var(--color-danger)]';
    return 'text-[var(--color-muted)]';
  };

  const periodName = netWorthQuery.data?.period?.name;
  const compareLabel = rows.length >= 2
    ? focusRow
      ? `${shortDate(rows[0].asOfMs)} → ${longDate(focusRow.asOfMs)}`
      : range === 'period' && periodName ? `since ${periodName} began` : `since ${longDate(rows[0].asOfMs)}`
    : '';

  const comparison = compareStartIndex != null && compareEndIndex != null && compareStartIndex !== compareEndIndex
    ? (() => {
      const fromIndex = Math.min(compareStartIndex, compareEndIndex);
      const toIndex = Math.max(compareStartIndex, compareEndIndex);
      const from = rows[fromIndex];
      const to = rows[toIndex];
      return from && to ? { from, to, delta: to.netWorth - from.netWorth } : null;
    })()
    : null;

  const clearComparison = () => {
    setCompareStartIndex(null);
    setCompareEndIndex(null);
    setIsDragging(false);
  };

  const beginComparison = (state: unknown) => {
    const index = chartIndex(state);
    if (index == null) return;
    setCompareStartIndex(index);
    setCompareEndIndex(index);
    setIsDragging(true);
  };

  const trackPointer = (state: unknown) => {
    const index = chartIndex(state);
    if (index == null) return;
    setHoverIndex(index);
    if (isDragging) setCompareEndIndex(index);
  };

  const leaveChart = () => {
    clearComparison();
    setHoverIndex(null);
  };

  const xAxisMinTickGap = 40;
  const cardClass = 'flex min-w-0 flex-col rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-5 sm:p-6';

  if (isLoading && rows.length === 0) {
    return (
      <div className={cn(cardClass, className)}>
        <div className="mb-4 h-8 w-48 max-w-full animate-pulse rounded bg-[var(--ref-surface-container-highest)]" />
        <div className="flex gap-1">
          {RANGE_OPTIONS.map((o) => (
            <div
              key={o.range}
              className="h-9 w-10 animate-pulse rounded-lg bg-[var(--ref-surface-container-highest)]"
            />
          ))}
        </div>
        <div className="mt-5 h-64 animate-pulse rounded-xl bg-[var(--ref-surface-container-highest)]/60" />
      </div>
    );
  }

  return (
    <div className={cn(cardClass, className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-headline text-xl font-extrabold text-[var(--ref-on-surface)]">
            Net worth trend
          </h2>
        </div>

        <div
          className="inline-flex shrink-0 items-center gap-0.5 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-1"
          role="group"
          aria-label="Time range"
        >
          {RANGE_OPTIONS.map((o) => (
            <button
              key={o.range}
              type="button"
              aria-pressed={range === o.range}
              aria-label={o.description}
              title={o.range === 'period' && periodId == null ? 'Pick a salary period first' : o.description}
              disabled={o.range === 'period' && periodId == null}
              onClick={() => selectRange(o.range)}
              className={cn(
              'cursor-pointer touch-manipulation rounded-lg px-2.5 py-1.5 text-center text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ref-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 sm:px-3',
                range === o.range
                  ? 'bg-[var(--ref-primary)] text-white shadow-sm'
                  : 'text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container)] hover:text-[var(--ref-on-surface)]',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 mt-2">
        <div className="min-w-0">
          <p className="font-headline text-xl font-extrabold tracking-tight text-[var(--ref-on-surface)] sm:text-2xl lg:text-3xl" aria-live="polite">
            {formatCurrency(currentNetWorth)}
          </p>
          <div
            className={cn(
              'mt-1 flex flex-wrap items-center gap-1.5 text-xs',
              getTrendColor(),
            )}
          >
            {getTrendIcon()}
            <span>
              {rows.length >= 2 ? (
                <>
                  {netWorthChange >= 0 ? '+' : ''}
                  {formatCurrency(netWorthChange)} ({netWorthChangePercent >= 0 ? '+' : ''}
                  {formatDecimal(netWorthChangePercent, 1, 1)}% {compareLabel})
                </>
              ) : (
                'Add more history to compare'
              )}
            </span>
          </div>
        </div>
      </div>

      {loadError && (
        <p className="mb-4 text-sm text-[var(--color-danger)]">{loadError}</p>
      )}

      {rows.length > 0 ? (
        <div
          className="h-52 min-h-52 w-full flex-1 select-none outline-none sm:h-56"
          style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
          onMouseDown={(event) => event.preventDefault()}
          onDragStart={(event) => event.preventDefault()}
        >
          {/* Below xl the card has no definite height, so 100% resolves to 0 without a floor. */}
          <ResponsiveContainer width="100%" height="100%" minHeight={208}>
            <AreaChart
              data={rows}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              className="touch-pan-y"
              onMouseMove={trackPointer}
              onMouseLeave={leaveChart}
              onMouseDown={beginComparison}
              onMouseUp={clearComparison}
              onTouchStart={beginComparison}
              onTouchMove={trackPointer}
              onTouchEnd={leaveChart}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--ref-primary)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--ref-primary)" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 5" strokeOpacity={0.2} stroke="var(--ref-outline)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: 'var(--ref-outline)' }}
                axisLine={false}
                tickLine={false}
                tickMargin={10}
                interval={ticks ? 0 : 'preserveStartEnd'}
                ticks={ticks?.map((tick) => tick.label)}
                tickFormatter={(label: string) => tickText.get(label) ?? label}
                minTickGap={ticks ? 0 : xAxisMinTickGap}
                height={28}
              />
              <YAxis
                domain={yAxisDomain}
                tick={{ fontSize: 10, fill: 'var(--ref-outline)' }}
                axisLine={false}
                tickLine={false}
                tickCount={4}
                tickMargin={1}
                tickFormatter={(v) => amountsHidden ? '•••' : compactAxisIdr(Number(v))}
                width={yAxisWidth}
                className="sm:[&_.recharts-cartesian-axis-tick_text]:text-[11px]"
              />
              <Tooltip
                cursor={{ stroke: 'var(--ref-primary)', strokeOpacity: 0.3, strokeDasharray: '4 4' }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as Row;
                  const pointIndex = rows.findIndex((row) => row.asOfMs === p.asOfMs);
                  const dragStart = compareStartIndex != null ? rows[compareStartIndex] : null;
                  const comparisonDelta = isDragging && dragStart && compareStartIndex !== pointIndex
                    ? p.netWorth - dragStart.netWorth
                    : null;
                  const comparisonPercent = dragStart && comparisonDelta != null && dragStart.netWorth !== 0
                    ? (comparisonDelta / Math.abs(dragStart.netWorth)) * 100
                    : null;
                  const payday = paydays.find((marker) => marker.label === p.label);
                  return (
                    <div className="w-max max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3 text-left shadow-xl">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ref-outline)]">
                        {longDate(p.asOfMs) || label}
                        {payday && <span className="ml-1.5 normal-case tracking-normal text-[var(--ref-secondary)]">· Payday · {payday.name}</span>}
                      </p>
                      <p className="font-headline text-base font-bold text-[var(--ref-on-surface)] sm:text-lg">
                        {formatCurrency(p.netWorth)}
                      </p>
                      {dragStart && comparisonDelta != null && (
                        <div className={cn(
                          'mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg px-2.5 py-2 text-xs font-semibold',
                          comparisonDelta >= 0
                            ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]'
                            : 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]',
                        )}>
                          <span>
                            {comparisonDelta >= 0 ? '+' : ''}{formatCurrency(comparisonDelta)}
                            {' ('}{comparisonPercent != null ? `${formatDecimal(comparisonPercent, 2, 2)}%` : '-'}{') '}
                            {comparisonDelta > 0 ? '↑' : comparisonDelta < 0 ? '↓' : '→'}
                          </span>
                          <span className="min-w-0 text-right font-normal text-[var(--ref-on-surface-variant)]">
                            {shortDate(dragStart.asOfMs)}
                            {' - '}
                            {shortDate(p.asOfMs)}
                          </span>
                        </div>
                      )}
                      {!isDragging && (
                        <dl className="mt-2 space-y-1 border-t border-[var(--color-border)] pt-2 text-xs text-[var(--ref-on-surface-variant)]">
                          <div className="flex justify-between gap-5"><dt>Assets</dt><dd className="tabular-nums">{formatCurrency(p.totalAssets)}</dd></div>
                          <div className="flex justify-between gap-5"><dt>Liabilities</dt><dd className="tabular-nums">{formatCurrency(p.totalLiabilities)}</dd></div>
                        </dl>
                      )}
                    </div>
                  );
                }}
              />
              {isDragging && comparison && (
                <>
                  <ReferenceLine x={comparison.from.label} stroke="var(--ref-outline)" strokeDasharray="3 3" strokeOpacity={0.8} />
                  <ReferenceLine x={comparison.to.label} stroke="var(--ref-outline)" strokeDasharray="3 3" strokeOpacity={0.8} />
                  <ReferenceDot x={comparison.from.label} y={comparison.from.netWorth} r={5} fill="var(--color-surface)" stroke="var(--ref-outline)" strokeWidth={2} />
                  <ReferenceDot x={comparison.to.label} y={comparison.to.netWorth} r={6} fill="var(--ref-primary)" stroke="var(--color-surface)" strokeWidth={3} />
                </>
              )}
              <Area
                type="linear"
                dataKey="netWorth"
                stroke="var(--ref-primary)"
                strokeWidth={2.5}
                dot={rows.length > MAX_DOTTED_POINTS ? false : { r: 2.5, strokeWidth: 0, fill: 'var(--ref-primary)' }}
                activeDot={{ r: 5, stroke: 'var(--color-surface)', strokeWidth: 3, fill: 'var(--ref-primary)' }}
                fill={`url(#${gradientId})`}
                isAnimationActive={typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: no-preference)').matches}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        !isLoading && (
          <div className="flex min-h-[220px] items-center justify-center px-2 text-center text-sm text-[var(--ref-on-surface-variant)]">
            {range === 'period' ? 'No ledger activity in this period yet.' : 'No trend data. Add wallet transactions to build history.'}
          </div>
        )
      )}
    </div>
  );
}
