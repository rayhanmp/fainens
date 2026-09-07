import { useMemo } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { cn, formatCurrency } from '../../lib/utils';

export interface ActivityDay {
  date: string;
  expenseCents: number;
  incomeCents: number;
  transactionCount: number;
}

interface Props {
  days?: ActivityDay[];
  kind: string;
  loading: boolean;
  updating: boolean;
  error: boolean;
  completeCoverage: boolean;
  startDate?: string;
  endDate?: string;
  onSelectDate: (date: string) => void;
  onRetry: () => void;
}

function dateLabel(date: string) {
  return new Date(`${date}T00:00:00+07:00`).toLocaleDateString('en-GB', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short' });
}

/** A supporting sparkline inside the summary, rather than a separate chart panel. */
export function TransactionActivityChart({ days, kind, loading, updating, error, completeCoverage, startDate, endDate, onSelectDate, onRetry }: Props) {
  const countMode = kind === 'transfer' || kind === 'loan';
  const incomeMode = kind === 'income';
  const label = countMode ? 'Daily activity' : incomeMode ? 'Daily income' : 'Daily spending';
  const color = incomeMode ? '#059669' : 'var(--ref-primary)';
  const points = useMemo(() => {
    if (!days?.length) return [];
    const indexed = new Map(days.map((day) => [day.date, day]));
    // Include every recorded date, even if a journal was assigned outside its period.
    const first = startDate && startDate < days[0].date ? startDate : days[0].date;
    const last = endDate && endDate > days[days.length - 1].date ? endDate : days[days.length - 1].date;
    const start = Date.parse(`${first}T00:00:00Z`);
    const end = Date.parse(`${last}T00:00:00Z`);
    const dates: string[] = [];
    if ((end - start) / 86400000 > 3660) return [];
    for (let time = start; time <= end; time += 86400000) dates.push(new Date(time).toISOString().slice(0, 10));
    return dates.map((date) => {
      const day = indexed.get(date);
      const known = day != null || completeCoverage;
      return {
        date,
        value: known ? (countMode ? day?.transactionCount : incomeMode ? day?.incomeCents : day?.expenseCents) ?? 0 : null,
        count: day?.transactionCount ?? 0,
      };
    });
  }, [days, startDate, endDate, completeCoverage, countMode, incomeMode]);

  return <div aria-label={`${label} overview`} aria-busy={loading || updating} className="w-full min-w-0 border-t border-[var(--color-border)] pt-2 sm:w-48 sm:shrink-0 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
    <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--ref-on-surface-variant)]">
      <span>{label}</span>
      {!completeCoverage && <span title="Recorded totals only. Missing dates have unverified coverage.">Recorded only</span>}
    </div>
    {error ? <button type="button" onClick={onRetry} className="h-10 text-xs text-[var(--ref-primary)]">Retry trend</button>
      : loading ? <div role="status" className="flex h-10 items-center text-xs text-[var(--ref-on-surface-variant)]">Loading…</div>
      : !points.length ? <p className="flex h-10 items-center text-xs text-[var(--ref-on-surface-variant)]">{days?.length ? 'Narrow dates to see trend' : 'No trend available'}</p>
      : <div className={cn('relative h-10 w-full', updating && 'pointer-events-none opacity-40')}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart accessibilityLayer data={points} margin={{ top: 5, right: 3, left: 3, bottom: 3 }} onClick={(state) => {
            if (!updating && state?.activeLabel != null) onSelectDate(String(state.activeLabel));
          }}>
            <XAxis dataKey="date" hide />
            <Tooltip cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: '2 2' }} allowEscapeViewBox={{ x: true, y: true }} wrapperStyle={{ zIndex: 40, overflow: 'visible' }} content={({ active, payload, label: date }) => {
              if (!active || date == null) return null;
              const point = points.find((item) => item.date === String(date));
              const pointIndex = points.findIndex((item) => item.date === String(date));
              const flipLeft = pointIndex >= Math.max(1, points.length * 0.65);
              return <div role="tooltip" className={cn('pointer-events-none w-max rounded-lg border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-3 py-2 text-xs shadow-lg', flipLeft ? '-ml-2 -translate-x-full' : 'ml-2')}>
                <p className="font-semibold">{dateLabel(String(date))} · WIB</p>
                <p className="mt-1">{point?.value == null ? 'Coverage unverified' : `${label}: ${countMode ? Number(payload?.[0]?.value ?? 0).toLocaleString() : formatCurrency(Number(payload?.[0]?.value ?? 0))}`}</p>
                <p className="mt-1 text-[var(--ref-on-surface-variant)]">Click to view this day</p>
              </div>;
            }} />
            <Area dataKey="value" name={label} type="linear" stroke={color} strokeWidth={1.75} fill={color} fillOpacity={0.08} connectNulls={false} dot={points.length === 1 ? { r: 2 } : false} activeDot={{ r: 3 }} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>}
  </div>;
}
