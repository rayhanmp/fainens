import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn, formatDate, formatDayMonth, weekdayIndex, weekdayLabels } from '../../lib/utils';
import { nextRenewal, previousRenewal, relativeDue, startOfDay, withinEnd } from './schedule';
import type { RenewalOccurrence, Subscription } from './queries';

type RenewalState = 'done' | 'late' | 'due';
type Renewal = { subscription: Subscription; dueAt: number; state: RenewalState };

const MONTHS_EACH_WAY = 12;

/**
 * Renewals of `subscription` in [monthStart, monthEnd]. Those before its next renewal were already
 * recorded or skipped; from the next one on they are due, and past-due ones wait for a decision.
 */
function renewalsIn(subscription: Subscription, monthStart: number, monthEnd: number, now: number, hasLate: boolean): Renewal[] {
  const found: Renewal[] = [];
  const created = startOfDay(subscription.createdAt);
  let before = previousRenewal(subscription.nextRenewalAt, subscription);
  for (let guard = 0; guard < 400 && before >= monthStart && before >= created; guard += 1) {
    if (before <= monthEnd) found.push({ subscription, dueAt: before, state: 'done' });
    before = previousRenewal(before, subscription);
  }
  let dueAt = subscription.nextRenewalAt;
  for (let guard = 0; guard < 400 && dueAt <= monthEnd; guard += 1) {
    if (!withinEnd(subscription, dueAt)) break;
    if (dueAt >= monthStart) found.push({ subscription, dueAt, state: hasLate && dueAt <= now ? 'late' : 'due' });
    dueAt = nextRenewal(dueAt, subscription);
  }
  return found;
}

const DOT: Record<RenewalState, string> = {
  late: 'bg-[#ffc46b]',
  due: 'bg-[#ffffff]',
  done: 'bg-white/45',
};

const STATE_LABEL: Record<RenewalState, string> = { late: 'Past due', due: 'Due', done: 'Done' };

const pill = 'shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition disabled:opacity-50';
const pillQuiet = `${pill} border border-white/25 bg-white/10 hover:bg-white/20`;
const pillStrong = `${pill} bg-[#ffffff] text-[#10243e] hover:bg-slate-100`;

/**
 * A month of renewals on the accent card: a dot under each day per renewal, today ringed. Step or
 * swipe between months; choosing a day lists what renews then. While renewals are past due, the
 * panel under the calendar lists them first, each to record (even late) or skip.
 */
export function RenewalCalendar({ subscriptions, overdue, truncated, now, busy, onRecord, onSkip, onResolveAll }: {
  subscriptions: Subscription[];
  overdue: RenewalOccurrence[];
  truncated: boolean;
  now: number;
  busy: boolean;
  onRecord: (renewal: { subscriptionId: number; dueAt: number }) => void;
  onSkip: (occurrence: RenewalOccurrence) => void;
  onResolveAll: (action: 'post' | 'skip') => void;
}) {
  const { formatAmount } = useBalanceVisibility();
  const today = new Date(now);
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState<{ offset: number; day: number } | null>(null);
  const swipeFrom = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // A picked day lets go on Escape or a click anywhere outside the calendar.
  useEffect(() => {
    if (!picked) return undefined;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setPicked(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPicked(null); };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', escape, true);
    };
  }, [picked]);
  const overdueIds = useMemo(() => new Set(overdue.map((item) => item.subscriptionId)), [overdue]);
  // Renewals are resolved in order, so only each subscription's earliest past-due one can be acted on.
  const firstDue = useMemo(() => {
    const first = new Map<number, number>();
    for (const item of overdue) if (!first.has(item.subscriptionId) || item.dueAt < first.get(item.subscriptionId)!) first.set(item.subscriptionId, item.dueAt);
    return first;
  }, [overdue]);
  const byId = new Map(subscriptions.map((subscription) => [subscription.id, subscription]));

  const month = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const monthStart = month.getTime();
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const lead = weekdayIndex(month);
  const isThisMonth = offset === 0;

  const byDay = new Map<number, Renewal[]>();
  for (const subscription of subscriptions) {
    for (const renewal of renewalsIn(subscription, monthStart, monthEnd, now, overdueIds.has(subscription.id))) {
      const day = new Date(renewal.dueAt).getDate();
      byDay.set(day, [...(byDay.get(day) ?? []), renewal].sort((a, b) => b.subscription.amount - a.subscription.amount));
    }
  }
  const all = [...byDay.values()].flat();
  const monthTotal = all.reduce((sum, item) => sum + item.subscription.amount, 0);

  // With nothing picked: past-due renewals first; otherwise the next day something is due.
  const showPastDue = picked?.offset !== offset && overdue.length > 0;
  const nextDueDay = [...byDay.entries()]
    .filter(([day, items]) => items.some((item) => item.state === 'due') && (!isThisMonth || day >= today.getDate()))
    .map(([day]) => day).sort((a, b) => a - b)[0] ?? null;
  const selectedDay = picked?.offset === offset ? picked.day : showPastDue ? null : nextDueDay;
  const selected = selectedDay != null ? byDay.get(selectedDay) ?? [] : [];

  const step = (delta: number) => {
    setOffset((value) => Math.max(-MONTHS_EACH_WAY, Math.min(MONTHS_EACH_WAY, value + delta)));
    setPicked(null);
  };

  const lateActions = (subscriptionId: number, dueAt: number, occurrence: RenewalOccurrence | undefined) =>
    firstDue.get(subscriptionId) === dueAt && occurrence ? (
      <span className="flex shrink-0 gap-1.5">
        <button type="button" disabled={busy} onClick={() => onSkip(occurrence)} className={pillQuiet}>Skip</button>
        <button type="button" disabled={busy} onClick={() => onRecord({ subscriptionId, dueAt })} className={pillStrong}>Record</button>
      </span>
    ) : (
      <span className="shrink-0 text-[11px] text-white/70">After the {formatDayMonth(firstDue.get(subscriptionId) ?? dueAt)} one</span>
    );

  return (
    <div
      ref={rootRef}
      onPointerDown={(event) => { if (event.pointerType !== 'mouse') swipeFrom.current = event.clientX; }}
      onPointerUp={(event) => {
        if (swipeFrom.current == null) return;
        const distance = event.clientX - swipeFrom.current;
        swipeFrom.current = null;
        if (Math.abs(distance) > 48) step(distance < 0 ? 1 : -1);
      }}
      className="flex h-full touch-pan-y flex-col"
    >
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => step(-1)} disabled={offset <= -MONTHS_EACH_WAY} aria-label="Previous month" className="grid h-8 w-8 place-items-center rounded-full bg-white/10 transition-colors hover:bg-white/20 disabled:opacity-40">
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <div className="min-w-0 text-center">
          <p className="text-sm font-bold">{month.toLocaleDateString('en-US', { month: 'long', year: month.getFullYear() === today.getFullYear() ? undefined : 'numeric' })}</p>
          <p className="text-[11px] text-white/70">{all.length === 0 ? 'No renewals' : `${all.length} renewal${all.length === 1 ? '' : 's'} · ${formatAmount(monthTotal)}`}</p>
        </div>
        <button type="button" onClick={() => step(1)} disabled={offset >= MONTHS_EACH_WAY} aria-label="Next month" className="grid h-8 w-8 place-items-center rounded-full bg-white/10 transition-colors hover:bg-white/20 disabled:opacity-40">
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-white/70" aria-hidden>
        {(['late', 'due', 'done'] as const).map((state) => <span key={state} className="flex items-center gap-1.5"><span className={cn('h-1.5 w-1.5 rounded-full', DOT[state])} />{STATE_LABEL[state]}</span>)}
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[4px] ring-2 ring-inset ring-white/80" />Today</span>
      </div>

      <div className="mt-3 grid grid-cols-7 text-center text-[10px] font-bold uppercase text-white/55" aria-hidden>
        {weekdayLabels().map((label) => <span key={label}>{label.slice(0, 2)}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-y-0.5" role="grid" aria-label={`Renewals in ${month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`}>
        {Array.from({ length: lead }, (_, index) => <span key={`lead-${index}`} aria-hidden />)}
        {Array.from({ length: days }, (_, index) => {
          const day = index + 1;
          const items = byDay.get(day) ?? [];
          const isToday = isThisMonth && day === today.getDate();
          const isSelected = day === selectedDay;
          return (
            <button
              key={day}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              aria-label={`${day}${isToday ? ', today' : ''}${items.length ? `: ${items.map((item) => `${item.subscription.name}, ${STATE_LABEL[item.state].toLowerCase()}`).join('; ')}` : ''}`}
              // Choosing the chosen day again goes back to the overview.
              onClick={() => setPicked(picked?.offset === offset && picked.day === day ? null : { offset, day })}
              className={cn(
                'group relative mx-auto flex h-10 w-full max-w-10 flex-col items-center justify-center rounded-xl text-xs tabular-nums transition-colors',
                items.length ? 'font-bold text-white' : 'text-white/55',
                isSelected ? 'bg-white/25' : 'hover:bg-white/10',
                isToday && 'ring-2 ring-inset ring-white/80',
              )}
            >
              {day}
              <span className="mt-0.5 flex h-1.5 gap-0.5" aria-hidden>
                {items.slice(0, 3).map((item, dot) => <span key={dot} className={cn('h-1.5 w-1.5 rounded-full', DOT[item.state])} />)}
              </span>
              {items.length > 0 && (
                <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden w-max max-w-60 -translate-x-1/2 rounded-lg bg-[#0f2340] px-2.5 py-1.5 text-left text-[11px] font-normal text-white shadow-lg group-hover:block">
                  {items.map((item) => (
                    <span key={`${item.subscription.id}-${item.dueAt}`} className="flex items-center gap-1.5 py-px">
                      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[item.state])} />
                      <span className="truncate">{item.subscription.name}</span>
                      <span className="ml-auto shrink-0 pl-2 tabular-nums text-white/75">{formatAmount(item.subscription.amount)} · {STATE_LABEL[item.state]}</span>
                    </span>
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* One fixed height for every state of this panel, so choosing a day never moves the page. */}
      <div className="mt-4 h-[8.5rem] overflow-y-auto border-t border-white/15 pt-4 xl:mt-auto" aria-live="polite">
        {showPastDue ? (
          <>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#ffd59a]">Past due · not recorded yet</p>
              {overdue.length > 1 && (
                <span className="flex gap-1.5">
                  <button type="button" disabled={busy} onClick={() => onResolveAll('skip')} className={pillQuiet}>Skip all</button>
                  <button type="button" disabled={busy} onClick={() => onResolveAll('post')} className={pillStrong}>Record all</button>
                </span>
              )}
            </div>
            <ul className="space-y-2">
              {overdue.map((item) => (
                <li key={`${item.subscriptionId}-${item.dueAt}`} className="flex items-center gap-3">
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT.late)} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.subscriptionName}</p>
                    <p className="text-xs text-white/75">{formatDate(item.dueAt)} · {relativeDue(item.dueAt, now)} · {formatAmount(item.amount)}</p>
                  </div>
                  {lateActions(item.subscriptionId, item.dueAt, byId.has(item.subscriptionId) ? item : undefined)}
                </li>
              ))}
            </ul>
            {truncated && <p className="mt-2 text-[11px] text-white/70">More are waiting; record or skip these and the rest follow.</p>}
          </>
        ) : (
          <>
          {picked?.offset === offset && (
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">{picked.day} {month.toLocaleDateString('en-US', { month: 'long' })}</p>
              <button type="button" onClick={() => setPicked(null)} className={pillQuiet}>{overdue.length > 0 ? 'Back to past due' : 'Back'}</button>
            </div>
          )}
          {selectedDay == null || selected.length === 0 ? (
          <p className="text-sm text-white/75">{selectedDay == null ? 'Nothing else renews this month.' : 'Nothing renews on this day.'}</p>
        ) : (
          <ul className="space-y-2">
            {selected.map((item) => {
              const occurrence = overdue.find((entry) => entry.subscriptionId === item.subscription.id && entry.dueAt === item.dueAt);
              const payable = item.state === 'due' && item.dueAt === item.subscription.nextRenewalAt;
              return (
                <li key={`${item.subscription.id}-${item.dueAt}`} className="flex items-center gap-3">
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT[item.state])} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.subscription.name}</p>
                    <p className="text-xs text-white/75">{formatDate(item.dueAt)} · {item.state === 'done' ? 'Done' : relativeDue(item.dueAt, now)} · {formatAmount(item.subscription.amount)}</p>
                  </div>
                  {item.state === 'late' ? lateActions(item.subscription.id, item.dueAt, occurrence) : payable ? (
                    <button type="button" onClick={() => onRecord({ subscriptionId: item.subscription.id, dueAt: item.dueAt })} className={pillQuiet}>
                      {item.subscription.paymentMode === 'manual' ? 'Pay now' : 'Record'}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          )}
          </>
        )}
      </div>
    </div>
  );
}
