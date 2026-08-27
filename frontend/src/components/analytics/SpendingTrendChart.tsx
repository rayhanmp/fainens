import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { SlidersHorizontal } from 'lucide-react';
import { api } from '../../lib/api';
import { cn, formatCurrency } from '../../lib/utils';

type Point = Awaited<ReturnType<typeof api.analytics.spendingTrend>>['series'][number];
type ViewMode = 'calendar' | 'weekly' | 'cumulative';

function compactAxisIdr(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(Math.round(value));
}

function shortDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function coverageText(point: Point): string {
  if (point.coverageStatus === 'complete') return 'Complete coverage';
  if (point.coverageStatus === 'partial') return 'Partial coverage';
  if (point.coverageStatus === 'skipped') return 'Skipped period';
  return 'Unknown coverage';
}

export function SpendingTrendChart({ periodId = null }: { periodId?: number | null } = {}) {
  const [points, setPoints] = useState<Point[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [averageDailySpend, setAverageDailySpend] = useState(0);
  const [hasIncompleteCoverage, setHasIncompleteCoverage] = useState(false);
  const [dataScope, setDataScope] = useState<'30d' | 'period'>('30d');
  const [periodName, setPeriodName] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('calendar');
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const periodQuery = dataScope === 'period' && periodId != null ? { periodId } : {};
    void api.analytics.spendingTrend(periodQuery)
      .then((result) => {
        if (cancelled) return;
        setPoints(result.series);
        setTotalSpent(result.totalSpent);
        setAverageDailySpend(result.averageDailySpend);
        setHasIncompleteCoverage(result.hasIncompleteCoverage);
        setPeriodName(result.periodName);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not load spending trend.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [dataScope, periodId]);

  useEffect(() => {
    if (periodId == null && dataScope === 'period') setDataScope('30d');
  }, [dataScope, periodId]);

  const weeklyPoints = useMemo(() => {
    const groups: Array<{ label: string; startMs: number; endMs: number; spent: number; transactionCount: number; hasIncompleteCoverage: boolean }> = [];
    for (let index = 0; index < points.length; index += 7) {
      const group = points.slice(index, index + 7);
      if (group.length === 0) continue;
      groups.push({
        label: `${shortDate(group[0].startMs)}–${shortDate(group[group.length - 1].endMs)}`,
        startMs: group[0].startMs,
        endMs: group[group.length - 1].endMs,
        spent: group.reduce((sum, point) => sum + point.spent, 0),
        transactionCount: group.reduce((sum, point) => sum + point.transactionCount, 0),
        hasIncompleteCoverage: group.some((point) => point.coverageStatus !== 'complete'),
      });
    }
    return groups;
  }, [points]);

  const cumulativePoints = useMemo(() => {
    let runningTotal = 0;
    return points.map((point) => {
      runningTotal += point.spent;
      return { ...point, cumulative: runningTotal };
    });
  }, [points]);

  const heatmapCells = useMemo<Array<Point | null>>(() => {
    if (points.length === 0) return [];
    const leadingEmptyCells = new Date(points[0].startMs).getDay();
    return [...Array.from({ length: leadingEmptyCells }, () => null), ...points];
  }, [points]);

  const maxDailySpend = Math.max(1, ...points.map((point) => point.spent));
  const modeOptions: Array<{ id: ViewMode; label: string; description: string }> = [
    { id: 'calendar', label: 'Calendar', description: 'Daily activity heatmap' },
    { id: 'weekly', label: 'Weekly', description: 'Seven-day totals' },
    { id: 'cumulative', label: 'Cumulative', description: 'Known spend pace' },
  ];

  const selectScope = (scope: '30d' | 'period') => {
    setDataScope(scope);
    setIsOptionsOpen(false);
  };

  const selectView = (nextView: ViewMode) => {
    setView(nextView);
    setIsOptionsOpen(false);
  };

  if (isLoading) {
    return <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-5"><div className="h-5 w-40 animate-pulse rounded bg-[var(--ref-surface-container-highest)]" /><div className="mt-4 h-10 w-48 animate-pulse rounded bg-[var(--ref-surface-container-highest)]" /><div className="mt-5 h-52 rounded-xl bg-[var(--ref-surface-container-highest)]/60" /></div>;
  }

  return (
    <div className="relative rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-headline text-lg font-extrabold text-[var(--ref-on-surface)]">Spending activity</h3>
          <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">{dataScope === 'period' && periodId != null ? `${periodName ?? 'Selected salary period'} · recorded expenses` : 'Last 30 days · recorded expenses'}</p>
        </div>
        <div className="flex items-start gap-2">
          <div className="text-right">
            <p className="font-headline text-lg font-extrabold text-[var(--ref-on-surface)]">{formatCurrency(totalSpent)}</p>
            <p className="mt-0.5 text-[11px] text-[var(--ref-on-surface-variant)]">{formatCurrency(averageDailySpend)} avg/day</p>
          </div>
          <button
            type="button"
            aria-label="Spending chart options"
            aria-expanded={isOptionsOpen}
            onClick={() => setIsOptionsOpen((open) => !open)}
            className={cn(
              'grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--ref-primary)]/30',
              isOptionsOpen
                ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)] text-white'
                : 'border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-high)] hover:text-[var(--ref-on-surface)]',
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isOptionsOpen && (
        <div className="absolute right-5 top-[4.75rem] z-20 w-60 rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3 shadow-xl">
          <p className="px-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--ref-on-surface-variant)]">Time range</p>
          <div className="mt-2 grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => selectScope('30d')}
              className={cn('rounded-lg px-2 py-2 text-left text-xs font-bold transition-colors', dataScope === '30d' ? 'bg-[var(--ref-primary)] text-white' : 'text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-high)] hover:text-[var(--ref-on-surface)]')}
            >
              Last 30 days
            </button>
            <button
              type="button"
              disabled={periodId == null}
              onClick={() => selectScope('period')}
              className={cn('rounded-lg px-2 py-2 text-left text-xs font-bold transition-colors', dataScope === 'period' ? 'bg-[var(--ref-primary)] text-white' : 'text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-high)] hover:text-[var(--ref-on-surface)]', 'disabled:cursor-not-allowed disabled:opacity-40')}
            >
              This period
            </button>
          </div>
          <p className="mt-4 px-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--ref-on-surface-variant)]">Chart style</p>
          <div className="mt-2 grid gap-1">
            {modeOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => selectView(option.id)}
                className={cn('rounded-lg px-2 py-2 text-left transition-colors', view === option.id ? 'bg-[var(--ref-primary)] text-white' : 'hover:bg-[var(--ref-surface-container-high)]')}
              >
                <span className={cn('block text-xs font-bold', view === option.id ? 'text-white' : 'text-[var(--ref-on-surface)]')}>{option.label}</span>
                <span className={cn('mt-0.5 block text-[10px]', view === option.id ? 'text-white/80' : 'text-[var(--ref-on-surface-variant)]')}>{option.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {loadError ? <p className="mt-4 text-sm text-[var(--color-danger)]">{loadError}</p> : points.every((point) => point.spent === 0) ? (
        <div className="mt-4 flex min-h-52 items-center justify-center px-3 text-center text-sm text-[var(--ref-on-surface-variant)]">No posted spending recorded for this view.</div>
      ) : view === 'calendar' ? (
        <div className="mt-5">
          <div className="grid grid-cols-7 gap-1.5" role="img" aria-label="Spending activity by day; darker cells mean more spending">
            {heatmapCells.map((point, index) => point == null ? <span key={`empty-${index}`} className="aspect-square" aria-hidden="true" /> : (
              <span
                key={point.startMs}
                title={`${shortDate(point.startMs)} · ${formatCurrency(point.spent)} · ${point.transactionCount} expense${point.transactionCount === 1 ? '' : 's'} · ${coverageText(point)}`}
                className={cn(
                  'aspect-square rounded-md border transition-transform hover:scale-105',
                  point.coverageStatus === 'complete' ? 'border-transparent' : 'border-dashed border-amber-500/70',
                  point.spent > 0 ? 'bg-[var(--ref-primary)]' : 'bg-[var(--ref-surface-container-highest)]',
                )}
                style={{ opacity: point.spent > 0 ? 0.25 + (0.75 * point.spent / maxDailySpend) : 0.65 }}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--ref-on-surface-variant)]">
            <span>{points[0] ? shortDate(points[0].startMs) : ''}</span>
            <span className="flex items-center gap-1.5" aria-label="Heatmap legend"><i className="h-2.5 w-2.5 rounded-sm bg-[var(--ref-surface-container-highest)]" /> none <i className="ml-1 h-2.5 w-2.5 rounded-sm bg-[var(--ref-primary)]" /> more</span>
            <span>{points.at(-1) ? shortDate(points.at(-1)!.startMs) : ''}</span>
          </div>
        </div>
      ) : view === 'weekly' ? (
        <div className="mt-4 h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeklyPoints} margin={{ top: 8, right: 2, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" stroke="var(--ref-outline)" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--ref-outline)' }} stroke="var(--ref-outline)" interval={0} height={28} />
              <YAxis tick={{ fontSize: 9, fill: 'var(--ref-outline)' }} stroke="var(--ref-outline)" tickFormatter={(value) => `Rp ${compactAxisIdr(Number(value))}`} width={52} />
              <Tooltip
                cursor={{ fill: 'var(--ref-surface-container-high)', opacity: 0.5 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const point = payload[0].payload as (typeof weeklyPoints)[number];
                  return <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-md"><p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ref-outline)]">{point.label}</p><p className="font-headline text-base font-bold text-[var(--ref-on-surface)]">{formatCurrency(point.spent)}</p><p className="mt-1 text-[10px] text-[var(--ref-on-surface-variant)]">{point.transactionCount} posted expense{point.transactionCount === 1 ? '' : 's'}{point.hasIncompleteCoverage ? ' · coverage gap' : ''}</p></div>;
                }}
              />
              <Bar dataKey="spent" fill="var(--ref-primary)" radius={[4, 4, 0, 0]} maxBarSize={34} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-4 h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cumulativePoints} margin={{ top: 8, right: 2, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" stroke="var(--ref-outline)" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--ref-outline)' }} stroke="var(--ref-outline)" interval={4} height={26} />
              <YAxis tick={{ fontSize: 9, fill: 'var(--ref-outline)' }} stroke="var(--ref-outline)" tickFormatter={(value) => `Rp ${compactAxisIdr(Number(value))}`} width={52} />
              <Tooltip
                cursor={{ stroke: 'var(--ref-outline)', opacity: 0.4 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const point = payload[0].payload as Point & { cumulative: number };
                  return <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-md"><p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ref-outline)]">{point.label}</p><p className="font-headline text-base font-bold text-[var(--ref-on-surface)]">{formatCurrency(point.cumulative)} known spend</p><p className="mt-1 text-[10px] text-[var(--ref-on-surface-variant)]">{point.transactionCount} posted expense{point.transactionCount === 1 ? '' : 's'} · {coverageText(point)}</p></div>;
                }}
              />
              <Line type="monotone" dataKey="cumulative" stroke="var(--ref-primary)" strokeWidth={3} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {hasIncompleteCoverage && <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] font-medium leading-relaxed text-[var(--ref-on-surface)]">Dashed cells and coverage gaps mean activity is unknown—not zero.</p>}
    </div>
  );
}
