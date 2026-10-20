import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn, formatDate, formatDayMonth, weekdayIndex, weekdayLabels } from '../../lib/utils';
import { relativeDue, renewalsBetween, type RenewalState } from './schedule';
import type { RenewalOccurrence, Subscription } from './queries';

type Renewal = { subscription: Subscription; dueAt: number; state: RenewalState };

const MONTHS_EACH_WAY = 12;

/** Renewals of `subscription` in [monthStart, monthEnd], each with how it stands. */
function renewalsIn(subscription: Subscription, monthStart: number, monthEnd: number, now: number, hasLate: boolean): Renewal[] {
  return renewalsBetween(subscription, monthStart, monthEnd, now, hasLate).map((renewal) => ({ subscription, ...renewal }));
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
  const trackRef = useRef<HTMLDivElement>(null);
  const [slidePosition, setSlidePosition] = useState({ set: '', index: 0 });
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

  // A new set of slides starts at its first one.
  const slideSet = `${offset}:${showPastDue}:${selectedDay}`;
  const slide = slidePosition.set === slideSet ? slidePosition.index : 0;
  useEffect(() => {
    trackRef.current?.scrollTo({ left: 0 });
  }, [slideSet]);

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

  type Slide = { key: string; dot: RenewalState | null; title: string; detail: string; action: React.ReactNode };
  const slides: Slide[] = showPastDue
    ? [
        ...overdue.map((item) => ({
          key: `${item.subscriptionId}-${item.dueAt}`,
          dot: 'late' as const,
          title: item.subscriptionName,
          detail: `${formatDate(item.dueAt)} · ${relativeDue(item.dueAt, now)} · ${formatAmount(item.amount)}`,
          action: lateActions(item.subscriptionId, item.dueAt, byId.has(item.subscriptionId) ? item : undefined),
        })),
        // Several past due: the last slide settles them all at once.
        ...(overdue.length > 1 ? [{
          key: 'all',
          dot: null,
          title: `All ${overdue.length}${truncated ? '+' : ''} past due`,
          detail: `${formatAmount(overdue.reduce((sum, item) => sum + item.amount, 0))} at their usual price and date`,
          action: (
            <span className="flex shrink-0 gap-1.5">
              <button type="button" disabled={busy} onClick={() => onResolveAll('skip')} className={pillQuiet}>Skip all</button>
              <button type="button" disabled={busy} onClick={() => onResolveAll('post')} className={pillStrong}>Record all</button>
            </span>
          ),
        }] : []),
      ]
    : selected.map((item) => {
        const occurrence = overdue.find((entry) => entry.subscriptionId === item.subscription.id && entry.dueAt === item.dueAt);
        const payable = item.state === 'due' && item.dueAt === item.subscription.nextRenewalAt;
        return {
          key: `${item.subscription.id}-${item.dueAt}`,
          dot: item.state,
          title: item.subscription.name,
          detail: `${formatDate(item.dueAt)} · ${item.state === 'done' ? 'Done' : relativeDue(item.dueAt, now)} · ${formatAmount(item.subscription.amount)}`,
          action: item.state === 'late' ? lateActions(item.subscription.id, item.dueAt, occurrence) : payable ? (
            <button type="button" onClick={() => onRecord({ subscriptionId: item.subscription.id, dueAt: item.dueAt })} className={pillQuiet}>
              {item.subscription.paymentMode === 'manual' ? 'Pay now' : 'Record'}
            </button>
          ) : null,
        };
      });
  const heading = showPastDue ? 'Past due · not recorded'
    : picked?.offset === offset ? `${picked.day} ${month.toLocaleDateString('en-US', { month: 'long' })}`
    : 'Next';
  const goTo = (index: number) => {
    const track = trackRef.current;
    if (track) track.scrollTo({ left: index * track.clientWidth, behavior: 'smooth' });
  };

  return (
    <div
      ref={rootRef}
      // Month swipes start on the calendar; the renewal slides below scroll on their own.
      onPointerDown={(event) => { if (event.pointerType !== 'mouse' && !(event.target as Element).closest('[data-slides]')) swipeFrom.current = event.clientX; }}
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

      {/* A heading row and one renewal row, whatever is shown: more renewals are slides beside it. */}
      <div className="mt-4 border-t border-white/15 pt-3 xl:mt-auto" aria-live="polite">
        <div className="flex h-7 items-center justify-between gap-2">
          <p className={cn('min-w-0 truncate text-[10px] font-bold uppercase tracking-widest', showPastDue ? 'text-[#ffd59a]' : 'text-white/70')}>
            {heading}{slides.length > 1 && <span className="font-semibold normal-case tracking-normal text-white/70"> · {Math.min(slide, slides.length - 1) + 1} of {slides.length}</span>}
          </p>
          <span className="flex shrink-0 items-center gap-1">
            {slides.length > 1 && (
              <>
                <button type="button" aria-label="Previous" disabled={slide === 0} onClick={() => goTo(slide - 1)} className="grid h-6 w-6 place-items-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" aria-hidden /></button>
                <button type="button" aria-label="Next" disabled={slide >= slides.length - 1} onClick={() => goTo(slide + 1)} className="grid h-6 w-6 place-items-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-40"><ChevronRight className="h-3.5 w-3.5" aria-hidden /></button>
              </>
            )}
            {picked?.offset === offset && <button type="button" onClick={() => setPicked(null)} className={cn(pillQuiet, 'ml-1 py-1')}>{overdue.length > 0 ? 'Back to past due' : 'Back'}</button>}
          </span>
        </div>
        <div
          ref={trackRef}
          data-slides
          onScroll={(event) => setSlidePosition({ set: slideSet, index: Math.round(event.currentTarget.scrollLeft / Math.max(1, event.currentTarget.clientWidth)) })}
          className="mt-1 flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {slides.length === 0 ? (
            <p className="flex h-12 w-full shrink-0 items-center text-sm text-white/75">{selectedDay == null ? 'Nothing else renews this month.' : 'Nothing renews on this day.'}</p>
          ) : slides.map((item) => (
            <div key={item.key} className="flex h-12 w-full shrink-0 snap-start items-center gap-3">
              {item.dot ? <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT[item.dot])} aria-hidden /> : null}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{item.title}</p>
                <p className="truncate text-xs text-white/75">{item.detail}</p>
              </div>
              {item.action}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
