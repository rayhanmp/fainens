import { AlertTriangle } from 'lucide-react';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { cn } from '../../../lib/utils';
import { InfoHint } from '../../savings/InfoHint';
import { Section } from '../../subscriptions/PageParts';
import { GOAL_COLORS } from '../colors';
import type { Trip } from './queries';
import { BOOKING_KIND_KEYS, BOOKING_KINDS, tripBudget } from './trip-utils';

/** The three things a trip costs, in the goals' own colour order. */
const SLICES = [
  { key: 'booked', label: 'Booked', color: GOAL_COLORS[0] },
  { key: 'plans', label: 'Day plans', color: GOAL_COLORS[1] },
  { key: 'spendingMoney', label: 'Spending money', color: GOAL_COLORS[2] },
] as const;

/**
 * What the trip adds up to against the goal's target: what's booked (and paid), what the days'
 * plans cost, and spending money for everyone, with what's still to plan or how far over it is,
 * and each paying person's share.
 */
export function TripBudget({ trip, target }: { trip: Trip; target: number }) {
  const { formatAmount } = useBalanceVisibility();
  const budget = tripBudget(trip.basics, trip.bookings, trip.plans, trip.travellers, target);
  const scale = Math.max(target, budget.total, 1);
  const over = budget.left < 0;

  return (
    <Section
      title="Budget"
      aside={<InfoHint label="About the budget" align="right">Bookings count at what they cost in rupiah; plans at what you expect them to cost; spending money is each person’s amount a day for every day of the trip. Together they’re set against the goal’s target.</InfoHint>}
    >
      <div className="px-4 py-4 sm:px-5">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-headline text-2xl font-black tabular-nums text-[var(--ref-on-surface)]">{formatAmount(budget.total)}</span>
          <span className="text-sm text-[var(--ref-on-surface-variant)]">planned of {formatAmount(target)}</span>
        </p>
        <p className={cn('mt-1 text-sm font-semibold', over ? 'text-[var(--color-warning)]' : 'text-[var(--ref-on-surface)]')}>
          {over ? `${formatAmount(-budget.left)} over the target` : budget.left === 0 ? 'Exactly the target' : `${formatAmount(budget.left)} of the target not planned yet`}
        </p>

        {/* The target as a track; what's planned fills it, a marker shows the target when it's passed. */}
        <div className="relative mt-4 flex h-3 gap-[2px] overflow-hidden rounded-full bg-[var(--ref-surface-container-high)]" role="img" aria-label={`${formatAmount(budget.total)} planned of ${formatAmount(target)}`}>
          {SLICES.map((slice) => budget[slice.key] > 0 && (
            <span key={slice.key} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(budget[slice.key] / scale) * 100}%`, background: slice.color }} title={`${slice.label}: ${formatAmount(budget[slice.key])}`} />
          ))}
          {over && <span className="absolute inset-y-0 w-0.5 bg-[var(--ref-on-surface)]" style={{ left: `${(target / scale) * 100}%` }} aria-hidden />}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ref-on-surface-variant)]">
          {SLICES.map((slice) => (
            <li key={slice.key} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: slice.color }} aria-hidden />
              {slice.label} <span className="font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(budget[slice.key])}</span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)] text-sm">
          {BOOKING_KIND_KEYS.filter((kind) => budget.byKind[kind] > 0).map((kind) => (
            <div key={kind} className="flex justify-between gap-3 py-2">
              <dt className="text-[var(--ref-on-surface-variant)]">{BOOKING_KINDS[kind].plural}</dt>
              <dd className="tabular-nums text-[var(--ref-on-surface)]">{formatAmount(budget.byKind[kind])}</dd>
            </div>
          ))}
          {budget.booked > 0 && (
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-[var(--ref-on-surface-variant)]">Bookings paid</dt>
              <dd className="tabular-nums text-[var(--ref-on-surface)]">{formatAmount(budget.paid)} <span className="text-[var(--ref-on-surface-variant)]">of {formatAmount(budget.booked)}</span></dd>
            </div>
          )}
          <div className="flex justify-between gap-3 py-2">
            <dt className="text-[var(--ref-on-surface-variant)]">Spending money</dt>
            <dd className="text-right tabular-nums text-[var(--ref-on-surface)]">
              {budget.spendingMoney > 0
                ? <>{formatAmount(trip.basics.dailyBudget)} × {budget.people} {budget.people === 1 ? 'person' : 'people'} × {budget.days} days</>
                : <span className="text-[var(--ref-on-surface-variant)]">{budget.days ? 'Set it in Trip' : 'Needs the trip’s dates'}</span>}
            </dd>
          </div>
          {/* With one person paying, their share is the whole of it. */}
          {budget.payers > 1 && (
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-[var(--ref-on-surface-variant)]">Each paying person</dt>
              <dd className="tabular-nums font-semibold text-[var(--ref-on-surface)]">{formatAmount(budget.perPayer)}<span className="font-normal text-[var(--ref-on-surface-variant)]"> · {budget.payers} paying</span></dd>
            </div>
          )}
        </dl>
        {budget.unconverted > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--color-warning)]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{budget.unconverted} cost{budget.unconverted === 1 ? ' isn’t' : 's aren’t'} counted until the trip’s rate is set.</p>
        )}
      </div>
    </Section>
  );
}
