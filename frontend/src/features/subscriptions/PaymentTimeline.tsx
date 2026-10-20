import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn, formatDate } from '../../lib/utils';
import { cycleLabel, renews, startOfDay, upcomingRenewals } from './schedule';
import type { RenewalOccurrence, Subscription } from './queries';

type MonthlyCharge = { month: string; total: number; items: Array<{ subscriptionId: number; amount: number }> };
type Unpaid = { subscriptionId: number; dueAt: number; kind: 'skipped' | 'voided' };
type Past = { kind: 'paid' | 'late' | 'skipped' | 'voided'; amount: number; dates: number[] };

const FUTURE_MONTHS = 6;
/** At least this many past months show, so even a new subscription has some history around it. */
const MIN_PAST_MONTHS = 3;

const monthKey = (ms: number) => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const monthDate = (key: string) => new Date(`${key}-01T12:00:00`);
const monthLong = (key: string) => monthDate(key).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

/** "332rb", "1,2jt": an amount inside a chip, without the currency. */
function shortAmount(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })}jt`;
  if (value >= 1e3) return `${Math.round(value / 1e3).toLocaleString('id-ID')}rb`;
  return value.toLocaleString('id-ID');
}

const HATCH: CSSProperties = { backgroundImage: 'repeating-linear-gradient(135deg, color-mix(in srgb, var(--ref-on-surface) 14%, transparent) 0 2px, transparent 2px 7px)' };

function Tip({ title, lines, children, className, style }: { title: string; lines: string[]; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <span className={cn('group relative z-10 flex items-center', className)} style={style}>
      <span tabIndex={0} aria-label={`${title}: ${lines.join(', ')}`} className="flex h-full w-full items-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--ref-primary)] rounded-md">{children}</span>
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 hidden w-max max-w-60 -translate-x-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-2.5 py-1.5 text-xs shadow-lg group-hover:block group-focus-within:block">
        <span className="block font-semibold text-[var(--ref-on-surface)]">{title}</span>
        {lines.map((line) => <span key={line} className="block text-[var(--ref-on-surface-variant)]">{line}</span>)}
      </span>
    </span>
  );
}

/**
 * What each subscription did month by month. The past shows every real charge as a chip with its
 * amount, and says what happened when nothing was charged: skipped, voided, paused, or not yet
 * started. The future is one ribbon per run of the same price, labelled once. Totals sit under
 * the past months; everything still to pay is one figure under the future.
 */
export function PaymentTimeline({ charges, unpaid, subscriptions, overdue, now, onOpen }: {
  charges: MonthlyCharge[];
  unpaid: Unpaid[];
  subscriptions: Subscription[];
  overdue: RenewalOccurrence[];
  now: number;
  onOpen: (subscriptionId: number) => void;
}) {
  const { formatAmount, balancesHidden } = useBalanceVisibility();
  const scrollRef = useRef<HTMLDivElement>(null);

  const model = useMemo(() => {
    const today = new Date(now);
    const past = new Map<number, Map<string, Past>>();
    const addPast = (id: number, key: string, item: Past) => {
      const row = past.get(id) ?? new Map<string, Past>();
      const existing = row.get(key);
      // A month shows its most telling event: past due over paid over voided over skipped.
      const rank = { late: 3, paid: 2, voided: 1, skipped: 0 };
      if (!existing || rank[item.kind] > rank[existing.kind]) row.set(key, existing && existing.kind === item.kind ? { ...item, amount: existing.amount + item.amount, dates: [...existing.dates, ...item.dates] } : item);
      else if (existing.kind === item.kind) row.set(key, { ...existing, amount: existing.amount + item.amount, dates: [...existing.dates, ...item.dates] });
      past.set(id, row);
    };
    for (const month of charges) for (const item of month.items) addPast(item.subscriptionId, month.month, { kind: 'paid', amount: item.amount, dates: [] });
    for (const item of unpaid) addPast(item.subscriptionId, monthKey(item.dueAt), { kind: item.kind, amount: 0, dates: [item.dueAt] });
    for (const item of overdue) addPast(item.subscriptionId, monthKey(item.dueAt), { kind: 'late', amount: item.amount, dates: [item.dueAt] });

    // The window: from the first month anything happened (at least a few back), to six ahead.
    const firstActive = charges.findIndex((month) => month.total > 0);
    const firstUnpaid = unpaid.length > 0 ? charges.findIndex((month) => month.month === monthKey(unpaid[0].dueAt)) : -1;
    const firstIndex = [firstActive, firstUnpaid].filter((index) => index >= 0).reduce((min, index) => Math.min(min, index), charges.length);
    const pastCount = Math.max(MIN_PAST_MONTHS, charges.length - Math.min(firstIndex, charges.length));
    const months = Array.from({ length: pastCount + FUTURE_MONTHS }, (_, index) => monthKey(new Date(today.getFullYear(), today.getMonth() - pastCount + 1 + index, 1).getTime()));
    const currentIndex = pastCount - 1;
    const windowEnd = new Date(today.getFullYear(), today.getMonth() + FUTURE_MONTHS + 1, 0, 23, 59, 59, 999).getTime();
    const overdueIds = new Set(overdue.map((item) => item.subscriptionId));

    const rows = subscriptions
      .filter((subscription) => subscription.status !== 'archived' || past.has(subscription.id))
      .map((subscription) => {
        const events = past.get(subscription.id) ?? new Map<string, Past>();
        // Scheduled renewals from today on, grouped into runs of consecutive months at one price.
        const scheduled = new Map<number, { amount: number; dates: number[] }>();
        if (subscription.status !== 'archived' && renews(subscription)) {
          const from = overdueIds.has(subscription.id) ? startOfDay(now) + 1 : startOfDay(now);
          for (const dueAt of upcomingRenewals(subscription, from, windowEnd)) {
            const index = months.indexOf(monthKey(dueAt));
            if (index < 0 || (index <= currentIndex && events.has(months[index]))) continue;
            const entry = scheduled.get(index) ?? { amount: 0, dates: [] };
            scheduled.set(index, { amount: entry.amount + subscription.amount, dates: [...entry.dates, dueAt] });
          }
        }
        const runs: Array<{ start: number; length: number; amount: number; dates: number[] }> = [];
        for (const [index, entry] of [...scheduled.entries()].sort((a, b) => a[0] - b[0])) {
          const last = runs.at(-1);
          if (last && last.start + last.length === index && last.amount === entry.amount) {
            last.length += 1;
            last.dates.push(...entry.dates);
          } else runs.push({ start: index, length: 1, amount: entry.amount, dates: [...entry.dates] });
        }
        // Where its track begins: when it was added, or its first event if that was earlier.
        const eventIndexes = months.map((key, index) => (events.has(key) ? index : -1)).filter((index) => index >= 0);
        const createdIndex = months.findIndex((key) => key >= monthKey(subscription.createdAt));
        const start = Math.min(...eventIndexes, createdIndex < 0 ? months.length : createdIndex);
        // A paused subscription stopped at its next renewal; the months since then are paused.
        const pausedFrom = subscription.status === 'paused' ? Math.max(start, months.findIndex((key) => key >= monthKey(subscription.nextRenewalAt))) : -1;
        return { subscription, events, runs, start, pausedFrom };
      })
      .filter((row) => row.events.size > 0 || row.runs.length > 0 || row.pausedFrom >= 0)
      .sort((a, b) => (renews(b.subscription) ? b.subscription.monthlyEquivalent : 0) - (renews(a.subscription) ? a.subscription.monthlyEquivalent : 0) || a.subscription.name.localeCompare(b.subscription.name));

    const paidTotals = months.slice(0, currentIndex + 1).map((key) => rows.reduce((sum, row) => sum + (row.events.get(key)?.kind === 'paid' ? row.events.get(key)!.amount : 0), 0));
    const stillToPay = overdue.reduce((sum, item) => sum + item.amount, 0) + rows.reduce((sum, row) => sum + row.runs.reduce((runSum, run) => runSum + run.amount * run.length, 0), 0);
    return { months, currentIndex, rows, paidTotals, stillToPay };
  }, [charges, unpaid, subscriptions, overdue, now]);

  // Open with this month in view: on a phone the oldest months scroll off to the left.
  useEffect(() => {
    const scroller = scrollRef.current;
    const current = scroller?.querySelector<HTMLElement>('[data-current-month]');
    if (scroller && current) scroller.scrollLeft = Math.max(0, current.offsetLeft - scroller.clientWidth / 2);
  }, [model.months.length]);

  const { months, currentIndex, rows, paidTotals, stillToPay } = model;
  if (rows.length === 0) {
    return <p className="px-4 py-10 text-center text-sm text-[var(--ref-on-surface-variant)] sm:px-5">Payments show here month by month once subscriptions start renewing.</p>;
  }

  const short = (value: number) => (balancesHidden ? '•••' : shortAmount(value));
  const columns = `minmax(9rem, 13rem) repeat(${months.length}, minmax(3rem, 1fr))`;
  const at = (index: number, span = 1): CSSProperties => ({ gridColumn: `${index + 2} / span ${span}`, gridRow: 1 });
  const monthName = (key: string) => {
    const date = monthDate(key);
    return date.getMonth() === 0 ? `${date.toLocaleDateString('en-US', { month: 'short' })} ’${String(date.getFullYear()).slice(2)}` : date.toLocaleDateString('en-US', { month: 'short' });
  };

  return (
    <div>
      <div ref={scrollRef} className="overflow-x-auto">
        <div className="min-w-[40rem] px-3 pb-1 pt-3 sm:px-4" role="table" aria-label="Subscription payments by month">
          <div className="grid gap-x-1" style={{ gridTemplateColumns: columns }} role="row">
            <span className="sticky left-0 z-20 bg-[var(--color-surface)]" role="columnheader" />
            {months.map((key, index) => (
              <span key={key} role="columnheader" data-current-month={index === currentIndex || undefined} className="flex justify-center pb-2">
                <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', index === currentIndex ? 'bg-[var(--ref-primary)] text-white' : index > currentIndex ? 'text-[var(--ref-outline)]' : 'text-[var(--ref-on-surface-variant)]')}>
                  {monthName(key)}
                </span>
              </span>
            ))}
          </div>

          {rows.map(({ subscription, events, runs, start, pausedFrom }) => (
            <div key={subscription.id} className="grid items-center gap-x-1 py-1" style={{ gridTemplateColumns: columns, gridTemplateRows: '2rem' }} role="row">
              <button type="button" onClick={() => onOpen(subscription.id)} className="sticky left-0 z-20 min-w-0 bg-[var(--color-surface)] pr-3 text-left" style={{ gridColumn: 1, gridRow: 1 }} role="rowheader">
                <span className="block truncate text-sm text-[var(--ref-on-surface)] hover:underline">{subscription.name}</span>
                <span className="block truncate text-[11px] text-[var(--ref-on-surface-variant)]">{renews(subscription) ? cycleLabel(subscription) : subscription.status === 'paused' ? 'Paused' : 'Ended'}</span>
              </button>

              {/* Its track: a hairline from the month it began, so a blank month reads as "nothing billed", not "not yet". */}
              {start <= currentIndex && <span className="h-px self-center bg-[var(--color-border)]" style={at(start, months.length - start)} aria-hidden />}

              {pausedFrom >= 0 && pausedFrom <= currentIndex && (
                <Tip title="Paused" lines={[`Since ${formatDate(subscription.nextRenewalAt)}`, 'Nothing is due until you resume it']} className="h-7" style={at(pausedFrom, currentIndex - pausedFrom + 1)}>
                  <span className="h-full w-full rounded-md border border-[var(--color-border)]" style={HATCH} />
                </Tip>
              )}

              {months.slice(0, currentIndex + 1).map((key, index) => {
                const event = events.get(key);
                if (!event) return null;
                const when = event.dates.length > 0 ? event.dates.map((date) => formatDate(date)).join(', ') : monthLong(key);
                if (event.kind === 'paid') {
                  return (
                    <Tip key={key} title={subscription.name} lines={[`Paid ${formatAmount(event.amount)}`, monthLong(key)]} className="h-7" style={at(index)}>
                      <span className="flex h-full w-full items-center justify-center rounded-md bg-[var(--ref-primary)] text-[11px] font-semibold tabular-nums text-white">{short(event.amount)}</span>
                    </Tip>
                  );
                }
                if (event.kind === 'late') {
                  return (
                    <Tip key={key} title={`${subscription.name}: past due`} lines={[`${formatAmount(event.amount)} due ${when}`, 'Not recorded yet']} className="h-7" style={at(index)}>
                      <span className="flex h-full w-full items-center justify-center gap-0.5 rounded-md bg-amber-400/25 text-[11px] font-semibold tabular-nums text-amber-800 ring-1 ring-inset ring-amber-500/60 dark:text-amber-200">! {short(event.amount)}</span>
                    </Tip>
                  );
                }
                return (
                  <Tip key={key} title={`${subscription.name}: ${event.kind}`} lines={[event.kind === 'voided' ? `Posted, then voided · due ${when}` : `Due ${when}`, 'Nothing was charged']} className="h-7 justify-center" style={at(index)}>
                    {event.kind === 'skipped'
                      ? <span className="mx-auto h-3 w-3 rounded-full border-2 border-[var(--ref-outline)] bg-[var(--color-surface)]" />
                      : <span className="mx-auto grid h-4 w-4 place-items-center rounded-full border border-dashed border-[var(--ref-outline)] bg-[var(--color-surface)] text-[9px] leading-none text-[var(--ref-outline)]">×</span>}
                  </Tip>
                );
              })}

              {runs.map((run) => {
                const label = run.length > 1 ? `${short(run.amount)}${subscription.billingCycle === 'monthly' && subscription.intervalCount === 1 ? '/mo' : ' each'}` : short(run.amount);
                return (
                  <Tip
                    key={run.start}
                    title={`${subscription.name}: scheduled`}
                    lines={[run.length > 1 ? `${formatAmount(run.amount)} × ${run.length}, ${formatDate(run.dates[0])} to ${formatDate(run.dates.at(-1)!)}` : `${formatAmount(run.amount)} on ${formatDate(run.dates[0])}`]}
                    className="h-7"
                    style={at(run.start, run.length)}
                  >
                    <span className={cn('flex h-full w-full items-center rounded-md bg-[var(--ref-primary)]/12 text-[11px] font-semibold tabular-nums text-[var(--ref-primary)]', run.length > 1 ? 'px-2.5' : 'justify-center')}>{label}</span>
                  </Tip>
                );
              })}
            </div>
          ))}

          <div className="mt-1 grid items-center gap-x-1 border-t border-[var(--color-border)] pt-2" style={{ gridTemplateColumns: columns }} role="row">
            <span className="sticky left-0 z-20 bg-[var(--color-surface)] py-1 text-[11px] font-bold uppercase tracking-widest text-[var(--ref-outline)]" role="rowheader">Paid</span>
            {paidTotals.map((value, index) => (
              <span key={months[index]} role="cell" className="py-1 text-center text-xs font-semibold tabular-nums text-[var(--ref-on-surface)]">{value > 0 ? short(value) : ''}</span>
            ))}
            <span role="cell" className="py-1 text-right text-xs text-[var(--ref-on-surface-variant)]" style={{ gridColumn: `${currentIndex + 3} / span ${months.length - currentIndex - 1}` }}>
              Still to pay through {monthDate(months.at(-1)!).toLocaleDateString('en-US', { month: 'short' })} <span className="font-semibold tabular-nums text-[var(--ref-on-surface)]">≈ {formatAmount(stillToPay)}</span>
            </span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pb-3 pt-2 text-xs text-[var(--ref-on-surface-variant)] sm:px-5" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded bg-[var(--ref-primary)]" />Paid</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded bg-amber-400/25 ring-1 ring-inset ring-amber-500/60" />Past due</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-[var(--ref-outline)]" />Skipped</span>
        <span className="flex items-center gap-1.5"><span className="grid h-3.5 w-3.5 place-items-center rounded-full border border-dashed border-[var(--ref-outline)] text-[8px] leading-none">×</span>Voided</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded border border-[var(--color-border)]" style={HATCH} />Paused</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-8 rounded bg-[var(--ref-primary)]/12" />Scheduled</span>
      </div>
    </div>
  );
}
