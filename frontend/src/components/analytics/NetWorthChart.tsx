import { useId, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { formatCurrency, cn } from '../../lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useNetWorthTrendQuery, type NetWorthRange } from '../../features/analytics/queries';
import type { GetNetWorthTrend200 } from '../../generated/client';

const RANGE_OPTIONS: Array<{
  range: NetWorthRange;
  label: string;
  /** Screen reader / title */
  description: string;
}> = [
  { range: '7d', label: '7 days', description: 'Last 7 days, one point per day' },
  { range: '30d', label: '30 days', description: 'Last 30 days, one point per day' },
  { range: '3m', label: '3 months', description: 'Last 3 months, month-end snapshots' },
  { range: '6m', label: '6 months', description: 'Last 6 months, month-end snapshots' },
  { range: '1y', label: '1 year', description: 'Last 12 months, month-end snapshots' },
];

function compactAxisIdr(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return String(Math.round(v));
}

type Row = GetNetWorthTrend200['series'][number];

export function NetWorthChart({ className = '' }: { className?: string } = {}) {
  const gradientId = useId().replace(/:/g, '');
  const [range, setRange] = useState<NetWorthRange>('30d');
  const netWorthQuery = useNetWorthTrendQuery(range);
  const rows: Row[] = netWorthQuery.data?.series ?? [];
  const isLoading = netWorthQuery.isPending && netWorthQuery.data == null;
  const loadError = netWorthQuery.error instanceof Error ? netWorthQuery.error.message : null;

  const currentNetWorth = rows.length > 0 ? rows[rows.length - 1].netWorth : 0;
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

  const compareLabel = rows.length >= 2
    ? `since ${new Date(rows[0].asOfMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : '';

  const xAxisMinTickGap = range === '30d' ? 14 : range === '7d' ? 6 : 10;

  if (isLoading && rows.length === 0) {
    return (
      <div className={cn('flex h-full min-h-0 flex-col rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-4 sm:p-6 lg:p-8', className)}>
        <div className="mb-4 h-8 w-48 max-w-full animate-pulse rounded bg-[var(--ref-surface-container-highest)]" />
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {RANGE_OPTIONS.map((o) => (
            <div
              key={o.range}
              className="h-11 animate-pulse rounded-full bg-[var(--ref-surface-container-highest)] sm:h-10 sm:min-w-[5.5rem]"
            />
          ))}
        </div>
        <div className="mt-6 h-56 min-h-[220px] animate-pulse rounded-lg bg-[var(--ref-surface-container-highest)]/60 sm:h-64 lg:h-72" />
      </div>
    );
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-4 sm:p-6 lg:p-8', className)}>
      <div className="mb-5 flex flex-col gap-4 lg:mb-6">
        <div className="min-w-0">
          <h3 className="font-headline text-base font-bold text-[var(--ref-on-surface)] sm:text-lg">
            Net worth trend
          </h3>
          <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)] sm:text-sm">
            Net worth over time, rolling back from today
          </p>
        </div>

        <div
          className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-start"
          role="tablist"
          aria-label="Time range"
        >
          {RANGE_OPTIONS.map((o) => (
            <button
              key={o.range}
              type="button"
              role="tab"
              aria-selected={range === o.range}
              title={o.description}
              onClick={() => setRange(o.range)}
              className={cn(
                'cursor-pointer min-h-[44px] touch-manipulation rounded-full px-3 py-2.5 text-center text-xs font-bold transition-colors sm:min-h-0 sm:min-w-[6.5rem] sm:px-4 sm:py-2',
                range === o.range
                  ? 'bg-[var(--ref-primary)] text-white shadow-sm'
                  : 'border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] text-[var(--ref-on-surface-variant)] hover:border-[var(--ref-outline)] hover:text-[var(--ref-on-surface)]',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="font-headline text-xl font-extrabold tracking-tight text-[var(--ref-on-surface)] sm:text-2xl lg:text-3xl">
            {formatCurrency(currentNetWorth)}
          </p>
          <div
            className={cn(
              'mt-1 flex flex-wrap items-center gap-1 text-xs sm:text-sm',
              getTrendColor(),
            )}
          >
            {getTrendIcon()}
            <span>
              {rows.length >= 2 ? (
                <>
                  {netWorthChange >= 0 ? '+' : ''}
                  {formatCurrency(netWorthChange)} ({netWorthChangePercent >= 0 ? '+' : ''}
                  {netWorthChangePercent.toFixed(1)}% {compareLabel})
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
        <div className="h-[min(55vh,22rem)] min-h-[220px] w-full sm:h-72 sm:min-h-[260px] lg:h-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={rows}
              margin={{ top: 8, right: 4, left: 0, bottom: 4 }}
              className="touch-pan-x"
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--ref-primary-container)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="var(--ref-primary-container)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" stroke="var(--ref-outline)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: 'var(--ref-outline)' }}
                stroke="var(--ref-outline)"
                interval="preserveStartEnd"
                minTickGap={xAxisMinTickGap}
                height={36}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'var(--ref-outline)' }}
                stroke="var(--ref-outline)"
                tickFormatter={(v) => `Rp ${compactAxisIdr(Number(v))}`}
                width={48}
                className="sm:[&_.recharts-cartesian-axis-tick_text]:text-[11px]"
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as Row;
                  return (
                    <div className="max-w-[90vw] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left shadow-md sm:max-w-xs">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ref-outline)]">
                        {label}
                      </p>
                      <p className="font-headline text-base font-bold text-[var(--ref-on-surface)] sm:text-lg">
                        {formatCurrency(p.netWorth)}
                      </p>
                      <p className="mt-1 text-[10px] text-[var(--ref-on-surface-variant)] sm:text-xs">
                        Assets {formatCurrency(p.totalAssets)} · Liab. {formatCurrency(p.totalLiabilities)}
                      </p>
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="netWorth"
                stroke="var(--ref-primary)"
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                isAnimationActive={typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: no-preference)').matches}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        !isLoading && (
          <div className="flex min-h-[220px] items-center justify-center px-2 text-center text-sm text-[var(--ref-on-surface-variant)]">
            No trend data. Add wallet transactions to build history.
          </div>
        )
      )}
    </div>
  );
}
