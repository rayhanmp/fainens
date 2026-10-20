import { useEffect, useMemo, useRef } from 'react';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn, formatDate } from '../../lib/utils';
import { cycleLabel, renews, startOfDay, upcomingRenewals } from './schedule';
import type { RenewalOccurrence, Subscription } from './queries';

type MonthlyCharge = { month: string; total: number; items: Array<{ subscriptionId: number; amount: number }> };
type ChipState = 'paid' | 'late' | 'scheduled';
type Chip = { amount: number; state: ChipState; dates: number[] };

const FUTURE_MONTHS = 6;
/** At least this many past months show, even before the first payment, so the strip has context. */
const MIN_PAST_MONTHS = 3;

const monthKey = (ms: number) => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const monthDate = (key: string) => new Date(`${key}-01T12:00:00`);

const CHIP: Record<ChipState, string> = {
  paid: 'bg-[var(--ref-primary)] text-white',
  scheduled: 'bg-[var(--ref-primary)]/12 text-[var(--ref-primary)]',
  late: 'bg-amber-400/25 text-amber-800 ring-1 ring-inset ring-amber-500/50 dark:text-amber-200',
};
const CHIP_LABEL: Record<ChipState, string> = { paid: 'Paid', scheduled: 'Scheduled', late: 'Past due' };

/** "332rb", "1,2jt": the amount inside a chip, without the currency. */
function chipAmount(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })}jt`;
  if (value >= 1e3) return `${Math.round(value / 1e3).toLocaleString('id-ID')}rb`;
  return value.toLocaleString('id-ID');
}

/**
 * Every subscription as a strip across the months: a chip for each month it charged, with the
 * amount in it. Solid is paid, tinted is scheduled, amber is past due and not recorded; a blank is a
 * month it skipped or didn't bill. A monthly plan reads as an unbroken strip, a yearly one as a
 * single chip. Month totals run along the foot.
 */
export function PaymentTimeline({ charges, subscriptions, overdue, now, onOpen }: {
  charges: MonthlyCharge[];
  subscriptions: Subscription[];
  overdue: RenewalOccurrence[];
  now: number;
  onOpen: (subscriptionId: number) => void;
}) {
  const { formatAmount, balancesHidden } = useBalanceVisibility();
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentKey = monthKey(now);

  const { months, rows } = useMemo(() => {
    const today = new Date(now);
    const chips = new Map<number, Map<string, Chip>>();
    const add = (subscriptionId: number, key: string, amount: number, state: ChipState, date?: number) => {
      const row = chips.get(subscriptionId) ?? new Map<string, Chip>();
      const chip = row.get(key);
      // A month holding a past-due renewal shows amber even if another charge was paid in it.
      const merged: ChipState = !chip ? state : state === 'late' || chip.state === 'late' ? 'late' : chip.state === 'paid' || state === 'paid' ? 'paid' : 'scheduled';
      row.set(key, { amount: (chip?.amount ?? 0) + amount, state: merged, dates: date ? [...(chip?.dates ?? []), date] : chip?.dates ?? [] });
      chips.set(subscriptionId, row);
    };
    for (const month of charges) for (const item of month.items) add(item.subscriptionId, month.month, item.amount, 'paid');
    for (const occurrence of overdue) add(occurrence.subscriptionId, monthKey(occurrence.dueAt), occurrence.amount, 'late', occurrence.dueAt);
    const until = new Date(today.getFullYear(), today.getMonth() + FUTURE_MONTHS + 1, 0, 23, 59, 59, 999).getTime();
    const overdueIds = new Set(overdue.map((item) => item.subscriptionId));
    for (const subscription of subscriptions) {
      if (subscription.status === 'archived' || !renews(subscription)) continue;
      // Past-due renewals are already on the strip; the schedule carries on after them.
      const from = overdueIds.has(subscription.id) ? startOfDay(now) + 1 : startOfDay(now);
      for (const dueAt of upcomingRenewals(subscription, from, until)) add(subscription.id, monthKey(dueAt), subscription.amount, 'scheduled', dueAt);
    }

    // From the first month anything was paid (at most a year back, at least a few months) to six ahead.
    const firstPaid = charges.findIndex((month) => month.total > 0);
    const pastCount = Math.max(MIN_PAST_MONTHS, firstPaid < 0 ? 0 : charges.length - firstPaid);
    const months = Array.from({ length: pastCount + FUTURE_MONTHS }, (_, index) => monthKey(new Date(today.getFullYear(), today.getMonth() - pastCount + 1 + index, 1).getTime()));

    const byId = new Map(subscriptions.map((subscription) => [subscription.id, subscription]));
    const rows = [...chips.entries()]
      .map(([id, row]) => ({ subscription: byId.get(id), row }))
      .filter((entry): entry is { subscription: Subscription; row: Map<string, Chip> } => entry.subscription != null && months.some((key) => entry.row.has(key)))
      .sort((a, b) => (renews(b.subscription) ? b.subscription.monthlyEquivalent : 0) - (renews(a.subscription) ? a.subscription.monthlyEquivalent : 0) || a.subscription.name.localeCompare(b.subscription.name));
    return { months, rows };
  }, [charges, subscriptions, overdue, now]);

  // Open with this month in view: on a phone the past scrolls off to the left.
  useEffect(() => {
    const scroller = scrollRef.current;
    const current = scroller?.querySelector<HTMLElement>('[data-current-month]');
    if (scroller && current) scroller.scrollLeft = Math.max(0, current.offsetLeft - scroller.clientWidth / 2);
  }, [months.length]);

  if (rows.length === 0) {
    return <p className="px-4 py-10 text-center text-sm text-[var(--ref-on-surface-variant)] sm:px-5">Payments show here month by month once subscriptions start renewing.</p>;
  }

  const totals = months.map((key) => rows.reduce((sum, entry) => sum + (entry.row.get(key)?.amount ?? 0), 0));
  const masked = (value: number) => (balancesHidden ? '•••' : chipAmount(value));
  const columns = `minmax(10rem, 14rem) repeat(${months.length}, minmax(3.25rem, 1fr))`;
  const monthName = (key: string) => {
    const date = monthDate(key);
    return date.getMonth() === 0 ? `${date.toLocaleDateString('en-US', { month: 'short' })} ’${String(date.getFullYear()).slice(2)}` : date.toLocaleDateString('en-US', { month: 'short' });
  };

  return (
    <div>
      <div ref={scrollRef} className="overflow-x-auto">
        <div className="min-w-[40rem] px-3 pb-1 pt-3 sm:px-4" role="table" aria-label="Subscription payments by month">
          <div className="grid gap-x-1" style={{ gridTemplateColumns: columns }} role="row">
            <span className="sticky left-0 z-10 bg-[var(--color-surface)]" role="columnheader" />
            {months.map((key) => (
              <span key={key} role="columnheader" data-current-month={key === currentKey || undefined} className="flex justify-center pb-2">
                <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', key === currentKey ? 'bg-[var(--ref-primary)] text-white' : key > currentKey ? 'text-[var(--ref-outline)]' : 'text-[var(--ref-on-surface-variant)]')}>
                  {monthName(key)}
                </span>
              </span>
            ))}
          </div>

          {rows.map(({ subscription, row }) => (
            <div key={subscription.id} className="grid items-center gap-x-1 py-1" style={{ gridTemplateColumns: columns }} role="row">
              <button type="button" onClick={() => onOpen(subscription.id)} className="sticky left-0 z-10 min-w-0 bg-[var(--color-surface)] py-1 pr-3 text-left" role="rowheader">
                <span className="block truncate text-sm text-[var(--ref-on-surface)] hover:underline">{subscription.name}</span>
                <span className="block truncate text-[11px] text-[var(--ref-on-surface-variant)]">{renews(subscription) ? cycleLabel(subscription) : subscription.status === 'paused' ? 'Paused' : 'Ended'}</span>
              </button>
              {months.map((key) => {
                const chip = row.get(key);
                if (!chip) return <span key={key} role="cell" className="h-8 border-b border-dashed border-[var(--color-border)]/70" aria-hidden />;
                const when = chip.dates.length > 0 ? chip.dates.map((date) => formatDate(date)).join(', ') : monthDate(key).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                return (
                  <span key={key} role="cell" className="group relative">
                    <span tabIndex={0} aria-label={`${subscription.name}, ${when}: ${CHIP_LABEL[chip.state]} ${formatAmount(chip.amount)}`} className={cn('flex h-8 items-center justify-center rounded-lg text-[11px] font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-[var(--ref-primary)] focus-visible:ring-offset-1', CHIP[chip.state])}>
                      {masked(chip.amount)}
                    </span>
                    <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden w-max max-w-56 -translate-x-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-2.5 py-1.5 text-xs shadow-lg group-hover:block group-focus-within:block">
                      <span className="block font-semibold text-[var(--ref-on-surface)]">{subscription.name}</span>
                      <span className="block text-[var(--ref-on-surface-variant)]">{CHIP_LABEL[chip.state]} {formatAmount(chip.amount)} · {when}</span>
                    </span>
                  </span>
                );
              })}
            </div>
          ))}

          <div className="mt-1 grid gap-x-1 border-t border-[var(--color-border)] pt-2" style={{ gridTemplateColumns: columns }} role="row">
            <span className="sticky left-0 z-10 bg-[var(--color-surface)] py-1 text-[11px] font-bold uppercase tracking-widest text-[var(--ref-outline)]" role="rowheader">Total</span>
            {months.map((key, index) => (
              <span key={key} role="cell" className={cn('py-1 text-center text-xs font-semibold tabular-nums', key > currentKey ? 'text-[var(--ref-on-surface-variant)]' : 'text-[var(--ref-on-surface)]')}>
                {totals[index] > 0 ? masked(totals[index]) : '–'}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-3 pt-2 text-xs text-[var(--ref-on-surface-variant)] sm:px-5" aria-hidden>
        {(['paid', 'scheduled', 'late'] as const).map((state) => (
          <span key={state} className="flex items-center gap-1.5"><span className={cn('h-3 w-5 rounded', CHIP[state])} />{CHIP_LABEL[state]}</span>
        ))}
      </div>
    </div>
  );
}
