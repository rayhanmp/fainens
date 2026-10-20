import { useEffect, useMemo, useRef } from 'react';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn, formatDate } from '../../lib/utils';
import { shortRupiah } from '../categories/short-rupiah';
import { cycleLabel, renews, startOfDay, upcomingRenewals } from './schedule';
import { SubscriptionIcon } from './PageParts';
import type { RenewalOccurrence, Subscription } from './queries';

type MonthlyCharge = { month: string; total: number; items: Array<{ subscriptionId: number; amount: number }> };
type MarkState = 'paid' | 'late' | 'scheduled';
type Mark = { amount: number; state: MarkState; count: number; dates: number[] };

const FUTURE_MONTHS = 6;

const monthKey = (ms: number) => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const MARK_STYLE: Record<MarkState, string> = {
  paid: 'bg-[var(--ref-primary)]',
  late: 'bg-amber-400 dark:bg-amber-300',
  scheduled: 'border-2 border-[var(--ref-primary)] bg-transparent',
};
const MARK_LABEL: Record<MarkState, string> = { paid: 'Paid', late: 'Past due', scheduled: 'Scheduled' };

/**
 * Every subscription's payments as a row across the last year and the next six months: a dot per
 * month it charged, sized by the amount. Filled is paid, a ring is scheduled, amber is past due and
 * not recorded; a gap is a month it skipped or didn't bill. Month totals run along the top.
 */
export function PaymentTimeline({ charges, subscriptions, overdue, now }: {
  charges: MonthlyCharge[];
  subscriptions: Subscription[];
  overdue: RenewalOccurrence[];
  now: number;
}) {
  const { formatAmount, balancesHidden } = useBalanceVisibility();
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentKey = monthKey(now);

  const { months, rows, totals, maxAmount } = useMemo(() => {
    const today = new Date(now);
    const months = [
      ...charges.map((month) => month.month),
      ...Array.from({ length: FUTURE_MONTHS }, (_, index) => monthKey(new Date(today.getFullYear(), today.getMonth() + index + 1, 1).getTime())),
    ];
    const marks = new Map<number, Map<string, Mark>>();
    const add = (subscriptionId: number, key: string, amount: number, state: MarkState, date?: number) => {
      const row = marks.get(subscriptionId) ?? new Map<string, Mark>();
      const mark = row.get(key);
      // A month with a past-due renewal shows amber even if another charge was paid in it.
      row.set(key, mark
        ? { amount: mark.amount + amount, state: state === 'late' || mark.state === 'late' ? 'late' : mark.state === 'paid' ? 'paid' : state, count: mark.count + 1, dates: date ? [...mark.dates, date] : mark.dates }
        : { amount, state, count: 1, dates: date ? [date] : [] });
      marks.set(subscriptionId, row);
    };
    for (const month of charges) for (const item of month.items) add(item.subscriptionId, month.month, item.amount, 'paid');
    for (const occurrence of overdue) add(occurrence.subscriptionId, monthKey(occurrence.dueAt), occurrence.amount, 'late', occurrence.dueAt);
    const until = new Date(today.getFullYear(), today.getMonth() + FUTURE_MONTHS + 1, 0, 23, 59, 59, 999).getTime();
    const overdueIds = new Set(overdue.map((item) => item.subscriptionId));
    for (const subscription of subscriptions) {
      if (subscription.status === 'archived' || !renews(subscription)) continue;
      // Past-due renewals are already marked; the schedule carries on after them.
      const from = overdueIds.has(subscription.id) ? startOfDay(now) + 1 : startOfDay(now);
      for (const dueAt of upcomingRenewals(subscription, from, until)) add(subscription.id, monthKey(dueAt), subscription.amount, 'scheduled', dueAt);
    }
    const byId = new Map(subscriptions.map((subscription) => [subscription.id, subscription]));
    const rows = [...marks.entries()]
      .map(([id, row]) => ({ subscription: byId.get(id), row }))
      .filter((entry): entry is { subscription: Subscription; row: Map<string, Mark> } => entry.subscription != null)
      .sort((a, b) => (renews(b.subscription) ? b.subscription.monthlyEquivalent : 0) - (renews(a.subscription) ? a.subscription.monthlyEquivalent : 0) || a.subscription.name.localeCompare(b.subscription.name));
    const totals = months.map((key) => rows.reduce((sum, entry) => sum + (entry.row.get(key)?.amount ?? 0), 0));
    const maxAmount = Math.max(1, ...rows.flatMap((entry) => [...entry.row.values()].map((mark) => mark.amount / mark.count)));
    return { months, rows, totals, maxAmount };
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

  const maxTotal = Math.max(1, ...totals);
  const short = (value: number) => (balancesHidden ? '•••' : shortRupiah(value));
  const columns = `minmax(9.5rem, 13rem) repeat(${months.length}, minmax(2.25rem, 1fr))`;

  return (
    <div>
      <div ref={scrollRef} className="overflow-x-auto">
        <div className="min-w-[46rem] px-2 pb-2 sm:px-3" role="table" aria-label="Subscription payments by month">
          <div className="grid items-end" style={{ gridTemplateColumns: columns }} role="row">
            <span className="sticky left-0 z-10 bg-[var(--color-surface)] px-2 pb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]" role="columnheader">Month total</span>
            {months.map((key, index) => {
              const future = key > currentKey;
              return (
                <div key={key} role="columnheader" data-current-month={key === currentKey || undefined} className={cn('flex flex-col items-center gap-1 px-0.5 pb-2', key === currentKey && 'rounded-t-xl bg-[var(--ref-primary)]/8')}>
                  <span className="text-[10px] tabular-nums text-[var(--ref-on-surface-variant)]">{totals[index] > 0 ? short(totals[index]) : ''}</span>
                  <span className="flex h-8 w-3 items-end" aria-hidden>
                    <span className={cn('w-full rounded-t-[3px]', future ? 'bg-[var(--ref-primary)]/30' : 'bg-[var(--ref-primary)]/70')} style={{ height: `${Math.max(totals[index] > 0 ? 8 : 0, (totals[index] / maxTotal) * 100)}%` }} />
                  </span>
                  <span className={cn('text-[11px] font-semibold', key === currentKey ? 'text-[var(--ref-primary)]' : 'text-[var(--ref-on-surface-variant)]')}>
                    {new Date(`${key}-01T12:00:00`).toLocaleDateString('en-US', { month: 'short' })}
                  </span>
                </div>
              );
            })}
          </div>

          {rows.map(({ subscription, row }) => (
            <div key={subscription.id} className="grid items-center border-t border-[var(--color-border)]" style={{ gridTemplateColumns: columns }} role="row">
              <div className="sticky left-0 z-10 flex min-w-0 items-center gap-2 bg-[var(--color-surface)] px-2 py-2" role="rowheader">
                <SubscriptionIcon iconKey={subscription.iconKey} />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-[var(--ref-on-surface)]">{subscription.name}</span>
                  <span className="block truncate text-[11px] text-[var(--ref-on-surface-variant)]">{renews(subscription) ? `${cycleLabel(subscription)} · ${formatAmount(subscription.monthlyEquivalent)}/mo` : subscription.status === 'paused' ? 'Paused' : 'Ended'}</span>
                </span>
              </div>
              {months.map((key) => {
                const mark = row.get(key);
                const size = mark ? 10 + Math.sqrt(mark.amount / mark.count / maxAmount) * 16 : 0;
                return (
                  <div key={key} role="cell" className={cn('group relative flex h-full min-h-12 items-center justify-center', key === currentKey && 'bg-[var(--ref-primary)]/8')}>
                    {mark ? (
                      <>
                        <span tabIndex={0} aria-label={`${subscription.name}, ${new Date(`${key}-01T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}: ${MARK_LABEL[mark.state]} ${formatAmount(mark.amount)}`} className={cn('block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--ref-primary)] focus-visible:ring-offset-2', MARK_STYLE[mark.state])} style={{ width: size, height: size }} />
                        <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden w-max max-w-56 -translate-x-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-2.5 py-1.5 text-xs shadow-lg group-hover:block group-focus-within:block">
                          <span className="block font-semibold text-[var(--ref-on-surface)]">{MARK_LABEL[mark.state]} · {formatAmount(mark.amount)}</span>
                          <span className="block text-[var(--ref-on-surface-variant)]">{mark.dates.length > 0 ? mark.dates.map((date) => formatDate(date)).join(', ') : new Date(`${key}-01T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}{mark.count > 1 ? ` · ${mark.count} charges` : ''}</span>
                        </span>
                      </>
                    ) : (
                      <span className="h-1 w-1 rounded-full bg-[var(--color-border)]" aria-hidden />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--color-border)] px-4 py-3 text-xs text-[var(--ref-on-surface-variant)] sm:px-5" aria-hidden>
        {(['paid', 'scheduled', 'late'] as const).map((state) => (
          <span key={state} className="flex items-center gap-1.5"><span className={cn('h-2.5 w-2.5 rounded-full', MARK_STYLE[state], state === 'scheduled' && 'border-[1.5px]')} />{MARK_LABEL[state]}</span>
        ))}
        <span>Bigger dot, bigger charge. A gap is a month it skipped or didn’t bill.</span>
      </div>
    </div>
  );
}
