import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';

type Point = Awaited<ReturnType<typeof api.analytics.spendingTrend>>['series'][number];

function compactAxisIdr(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(Math.round(value));
}

export function SpendingTrendChart() {
  const [points, setPoints] = useState<Point[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [averageDailySpend, setAverageDailySpend] = useState(0);
  const [hasIncompleteCoverage, setHasIncompleteCoverage] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.analytics.spendingTrend()
      .then((result) => {
        if (cancelled) return;
        setPoints(result.series);
        setTotalSpent(result.totalSpent);
        setAverageDailySpend(result.averageDailySpend);
        setHasIncompleteCoverage(result.hasIncompleteCoverage);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not load spending trend.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (isLoading) {
    return <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-5"><div className="h-5 w-40 animate-pulse rounded bg-[var(--ref-surface-container-highest)]" /><div className="mt-4 h-10 w-48 animate-pulse rounded bg-[var(--ref-surface-container-highest)]" /><div className="mt-5 h-52 animate-pulse rounded-xl bg-[var(--ref-surface-container-highest)]/60" /></div>;
  }

  return (
    <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-headline text-lg font-extrabold text-[var(--ref-on-surface)]">Daily spending</h3>
          <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">Recorded expenses over the last 30 days</p>
        </div>
        <div className="text-right">
          <p className="font-headline text-lg font-extrabold text-[var(--ref-on-surface)]">{formatCurrency(totalSpent)}</p>
          <p className="mt-0.5 text-[11px] text-[var(--ref-on-surface-variant)]">{formatCurrency(averageDailySpend)} avg/day</p>
        </div>
      </div>
      {loadError && <p className="mt-4 text-sm text-[var(--color-danger)]">{loadError}</p>}
      {!loadError && points.every((point) => point.spent === 0) ? (
        <div className="flex min-h-52 items-center justify-center px-3 text-center text-sm text-[var(--ref-on-surface-variant)]">No posted spending recorded in the last 30 days.</div>
      ) : !loadError && (
        <div className="mt-4 h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points} margin={{ top: 8, right: 2, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" stroke="var(--ref-outline)" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--ref-outline)' }} stroke="var(--ref-outline)" interval={4} height={26} />
              <YAxis tick={{ fontSize: 9, fill: 'var(--ref-outline)' }} stroke="var(--ref-outline)" tickFormatter={(value) => `Rp ${compactAxisIdr(Number(value))}`} width={52} />
              <Tooltip
                cursor={{ fill: 'var(--ref-surface-container-high)', opacity: 0.5 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const point = payload[0].payload as Point;
                  return <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-md"><p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ref-outline)]">{label}</p><p className="font-headline text-base font-bold text-[var(--ref-on-surface)]">{formatCurrency(point.spent)}</p><p className="mt-1 text-[10px] text-[var(--ref-on-surface-variant)]">{point.transactionCount} posted expense{point.transactionCount === 1 ? '' : 's'}</p></div>;
                }}
              />
              <Bar dataKey="spent" fill="var(--ref-primary)" radius={[4, 4, 0, 0]} maxBarSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {hasIncompleteCoverage && <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] font-medium leading-relaxed text-[var(--ref-on-surface)]">Some days have incomplete period coverage; empty bars are not proof that no spending occurred.</p>}
    </div>
  );
}
