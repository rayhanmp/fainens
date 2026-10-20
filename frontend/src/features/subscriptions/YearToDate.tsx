import { useMemo } from 'react';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn } from '../../lib/utils';
import { renews, startOfDay, upcomingRenewals } from './schedule';
import type { RenewalOccurrence, Subscription } from './queries';

type MonthlyCharge = { month: string; total: number };

const WIDTH = 600;
const HEIGHT = 96;
const TOP = 8;

/**
 * The calendar year as a running total: what subscriptions have actually charged since January
 * (solid), then the renewals still scheduled, past-due ones included, through December (dashed).
 */
export function YearToDate({ charges, renewing, overdue, now }: {
  charges: MonthlyCharge[];
  renewing: Subscription[];
  overdue: RenewalOccurrence[];
  now: number;
}) {
  const { formatAmount } = useBalanceVisibility();
  const today = new Date(now);
  const year = today.getFullYear();
  const current = today.getMonth();

  const { paid, scheduled } = useMemo(() => {
    const paid = Array.from({ length: 12 }, (_, month) => charges.find((item) => item.month === `${year}-${String(month + 1).padStart(2, '0')}`)?.total ?? 0);
    const scheduled = Array.from({ length: 12 }, () => 0);
    // Still owed: past-due renewals land in this month, upcoming ones in the month they renew.
    for (const occurrence of overdue) scheduled[current] += occurrence.amount;
    const overdueIds = new Set(overdue.map((item) => item.subscriptionId));
    const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999).getTime();
    for (const subscription of renewing) {
      if (!renews(subscription)) continue;
      const from = overdueIds.has(subscription.id) ? startOfDay(now) + 1 : startOfDay(now);
      for (const dueAt of upcomingRenewals(subscription, from, yearEnd)) scheduled[new Date(dueAt).getMonth()] += subscription.amount;
    }
    return { paid, scheduled };
  }, [charges, renewing, overdue, now, year, current]);

  // Running totals: paid through this month, then paid plus scheduled to December.
  const running: number[] = [];
  let total = 0;
  for (let month = 0; month < 12; month += 1) {
    total += paid[month] + (month >= current ? scheduled[month] : 0);
    running.push(total);
  }
  const paidSoFar = paid.slice(0, current + 1).reduce((sum, value) => sum + value, 0);
  const byYearEnd = running[11];
  const max = Math.max(1, byYearEnd);
  const x = (month: number) => ((month + 0.5) / 12) * WIDTH;
  const y = (value: number) => TOP + (1 - value / max) * (HEIGHT - TOP);
  const paidRunning = running.map((value, month) => (month < current ? value : paidSoFar));
  const solid = Array.from({ length: current + 1 }, (_, month) => `${x(month)},${y(paidRunning[month])}`).join(' ');
  const dashed = [`${x(current)},${y(paidSoFar)}`, ...Array.from({ length: 11 - current }, (_, index) => `${x(current + 1 + index)},${y(running[current + 1 + index])}`)].join(' ');
  const area = `${x(0)},${HEIGHT} ${solid} ${x(current)},${HEIGHT}`;

  return (
    <div aria-label={`This year: ${formatAmount(paidSoFar)} paid so far, about ${formatAmount(byYearEnd)} by the end of December`}>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">Paid in {year} so far</p>
          <p className="mt-0.5 truncate text-xl font-bold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(paidSoFar)}</p>
        </div>
        <div className="min-w-0 text-right">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">By 31 Dec</p>
          <p className="mt-0.5 truncate text-xl font-bold tabular-nums text-[var(--ref-on-surface-variant)]">≈ {formatAmount(byYearEnd)}</p>
        </div>
      </div>

      <div className="relative mt-3 h-24">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          <line x1="0" x2={WIDTH} y1={HEIGHT} y2={HEIGHT} stroke="var(--color-border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <polygon points={area} fill="var(--color-accent)" fillOpacity="0.12" />
          <polyline points={solid} fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {current < 11 && <polyline points={dashed} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeDasharray="5 5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity="0.6" />}
        </svg>
        {/* Today, as an HTML dot so it stays round however the chart stretches. */}
        <span className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--ref-surface-container-low)] bg-[var(--color-accent)]" style={{ left: `${(x(current) / WIDTH) * 100}%`, top: `${(y(paidSoFar) / HEIGHT) * 100}%` }} aria-hidden />
        {/* One hover column per month. */}
        <div className="absolute inset-0 grid grid-cols-12">
          {running.map((value, month) => {
            const future = month > current;
            const thisMonth = paid[month] + (month >= current ? scheduled[month] : 0);
            // The point on the line for this month: the tooltip and its dot sit right on it.
            const top = `${(y(month <= current ? paidRunning[month] : value) / HEIGHT) * 100}%`;
            return (
              <div key={month} className="group relative">
                <span className="absolute inset-y-0 left-1/2 hidden w-px bg-[var(--color-border)] group-hover:block" aria-hidden />
                <span className="absolute left-1/2 hidden h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--ref-surface-container-low)] bg-[var(--color-accent)] group-hover:block" style={{ top }} aria-hidden />
                <span role="tooltip" style={{ top }} className={cn('pointer-events-none absolute z-20 mt-[-10px] hidden w-max max-w-56 -translate-y-full rounded-lg border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-2.5 py-1.5 text-xs shadow-lg group-hover:block', month > 8 ? 'right-1/2' : month < 3 ? 'left-1/2' : 'left-1/2 -translate-x-1/2')}>
                  <span className="block font-semibold text-[var(--ref-on-surface)]">{new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long' })}</span>
                  <span className="block text-[var(--ref-on-surface-variant)]">
                    {month === current
                      ? `${formatAmount(paid[month])} paid${scheduled[month] > 0 ? `, ${formatAmount(scheduled[month])} still due` : ''}`
                      : `${formatAmount(thisMonth)} ${future ? 'scheduled' : 'paid'}`}
                  </span>
                  <span className="block text-[var(--ref-on-surface-variant)]">{formatAmount(value)} in the year by then</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-1.5 grid grid-cols-12 text-center text-[10px] font-semibold" aria-hidden>
        {Array.from({ length: 12 }, (_, month) => (
          <span key={month} className={month === current ? 'text-[var(--color-accent)]' : month > current ? 'text-[var(--ref-outline)]' : 'text-[var(--ref-on-surface-variant)]'}>
            {new Date(year, month, 1).toLocaleDateString('en-US', { month: 'narrow' })}
          </span>
        ))}
      </div>
    </div>
  );
}
