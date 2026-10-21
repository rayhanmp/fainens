import { CalendarDays, Check } from 'lucide-react';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { cn } from '../../../lib/utils';
import { Section } from '../../subscriptions/PageParts';
import { FilesSection } from '../detail/FilesSection';
import { GrowthChart } from '../detail/GrowthChart';
import { PartsSection } from '../detail/PartsSection';
import { NotesWorkspace } from '../notes/NotesWorkspace';
import type { GoalDetail, GoalPart } from '../queries';
import { BOOKING_ICONS } from './booking-icons';
import { BookingsSection } from './BookingsSection';
import { ItinerarySection } from './ItinerarySection';
import { PackingPanel } from './PackingPanel';
import { PeopleSection } from './PeopleSection';
import type { Trip } from './queries';
import { TripBudget } from './TripBudget';
import { TodayPanel, TripRecap } from './TripStatus';
import { dayLabel, daysBetween, nextUp, shortDate, tripLength, tripPhase, type NextItem } from './trip-utils';

export type TripTab = 'overview' | 'bookings' | 'days' | 'people' | 'packing' | 'notes' | 'files';
type Tab = TripTab;
const ROLE: Record<string, string> = { leave: 'Leaves', arrive: 'Lands', 'check-in': 'Check in', 'check-out': 'Check out', on: '' };


function nextLabel(item: NextItem) {
  if (item.type === 'plan') return { icon: CalendarDays, text: item.plan.title };
  return { icon: BOOKING_ICONS[item.booking.kind], text: `${ROLE[item.role] ? `${ROLE[item.role]}: ` : ''}${item.booking.title}` };
}

/** What comes next on the trip, and what's still open: bookings to pay, free cancellation ending, things to pack. */
function NextUp({ trip, now, go }: { trip: Trip; now: number; go: (tab: Tab) => void }) {
  const { formatAmount } = useBalanceVisibility();
  const items = nextUp(trip.bookings, trip.plans, now);
  const unpaid = trip.bookings.filter((booking) => booking.partId !== null && booking.paidAt === null);
  const cancelSoon = trip.bookings.filter((booking) => booking.cancelBy !== null && booking.cancelBy >= now && daysBetween(now, booking.cancelBy) <= 7);
  const unpacked = trip.packing.filter((item) => !item.done).length;
  const open = [
    unpaid.length ? { key: 'unpaid', text: `${unpaid.length} booking${unpaid.length === 1 ? '' : 's'} not paid · ${formatAmount(unpaid.reduce((sum, booking) => sum + booking.rupiah, 0))}`, tab: 'bookings' as Tab } : null,
    ...cancelSoon.map((booking) => ({ key: `cancel-${booking.id}`, text: `Free cancellation for ${booking.title} ends ${shortDate(booking.cancelBy!)}`, tab: 'bookings' as Tab, warn: true })),
    unpacked ? { key: 'packing', text: `${unpacked} thing${unpacked === 1 ? '' : 's'} to pack`, tab: 'packing' as Tab } : null,
  ].filter(Boolean) as Array<{ key: string; text: string; tab: Tab; warn?: boolean }>;

  return (
    <Section title="Next up" aside={items.length > 0 ? <button type="button" onClick={() => go('days')} className="text-xs font-semibold text-[var(--ref-primary)] hover:underline">Every day</button> : undefined}>
      <div className="px-4 py-3 sm:px-5">
        {items.length === 0 ? (
          <p className="py-1 text-sm text-[var(--ref-on-surface-variant)]">Nothing on the calendar yet. Bookings and plans with a date show up here.</p>
        ) : (
          <ul className="space-y-2.5">
            {items.map((item) => {
              const { icon: Icon, text } = nextLabel(item);
              return (
                <li key={`${item.type}-${item.type === 'plan' ? item.plan.id : `${item.booking.id}-${item.role}`}`} className="flex items-start gap-3">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ref-on-surface-variant)]" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--ref-on-surface)]">{text}</span>
                  <span className="shrink-0 text-xs tabular-nums text-[var(--ref-on-surface-variant)]">{dayLabel(item.day)}{item.time ? `, ${item.time}` : ''}</span>
                </li>
              );
            })}
          </ul>
        )}
        {open.length > 0 && (
          <ul className="mt-3 space-y-1.5 border-t border-[var(--color-border)] pt-3">
            {open.map((entry) => (
              <li key={entry.key}>
                <button type="button" onClick={() => go(entry.tab)} className={cn('text-left text-sm hover:underline', entry.warn ? 'text-[var(--color-warning)]' : 'text-[var(--ref-on-surface)]')}>{entry.text}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

/** The first things a trip needs, ticked as they're done; gone once they all are. */
function GettingStarted({ trip, onEdit, go }: { trip: Trip; onEdit: () => void; go: (tab: Tab) => void }) {
  const steps = [
    { label: 'Where you’re going', done: trip.basics.places.length > 0, act: onEdit },
    { label: 'When you leave and come back', done: trip.basics.startDate !== null && trip.basics.endDate !== null, act: onEdit },
    { label: 'Who’s going', done: trip.travellers.length > 0, act: () => go('people') },
    { label: 'Spending money a day', done: trip.basics.dailyBudget > 0, act: onEdit },
    { label: 'A first booking', done: trip.bookings.length > 0, act: () => go('bookings') },
    { label: 'A packing list', done: trip.packing.length > 0, act: () => go('packing') },
  ];
  const done = steps.filter((step) => step.done).length;
  if (done === steps.length) return null;
  return (
    <Section title="Getting started" aside={<span className="text-xs font-semibold tabular-nums text-[var(--ref-on-surface-variant)]">{done} of {steps.length}</span>}>
      <ul className="grid grid-cols-1 gap-1 px-2 py-2 @md:grid-cols-2 sm:px-3">
        {steps.map((step) => (
          <li key={step.label}>
            <button type="button" onClick={step.act} disabled={step.done} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm hover:bg-[var(--ref-surface-container-low)] disabled:hover:bg-transparent">
              <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full border', step.done ? 'border-[var(--color-success)] bg-[var(--color-success)] text-[var(--color-surface)]' : 'border-[var(--ref-outline)]')}>{step.done && <Check className="h-3 w-3" aria-hidden />}</span>
              <span className={step.done ? 'text-[var(--ref-on-surface-variant)] line-through' : 'font-medium text-[var(--ref-on-surface)]'}>{step.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * A holiday goal's page below its top card, in tabs: an overview (today's plans on the trip, how
 * it went after, the budget, what's next, what's left to set up, and the goal's own money: how
 * it's growing and its breakdown), bookings, the days, who's going, packing, notes and files.
 * The trip's settings sit beside, in the rail.
 */
export function TripWorkspace({ detail, trip, now, color, canPay, tab, onTab, onEdit, onPayPart, onPayBreakdown }: {
  detail: GoalDetail;
  trip: Trip;
  now: number;
  color: string;
  canPay: boolean;
  tab: TripTab;
  onTab: (tab: TripTab) => void;
  onEdit: () => void;
  onPayPart: (partId: number) => void;
  onPayBreakdown: (part: GoalPart) => void;
}) {
  const setTab = onTab;
  const { goal } = detail;
  const phase = tripPhase(trip.basics, now);
  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'bookings', label: 'Bookings', count: trip.bookings.length },
    { key: 'days', label: 'Days', count: tripLength(trip.basics) || undefined },
    { key: 'people', label: 'People', count: trip.travellers.length || undefined },
    { key: 'packing', label: 'Packing', count: trip.packing.length ? trip.packing.filter((item) => !item.done).length || undefined : undefined },
    { key: 'notes', label: 'Notes' },
    { key: 'files', label: 'Files', count: detail.attachments.length || undefined },
  ];
  const go = (next: Tab) => setTab(next);

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Trip" className="-mx-1 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-[var(--color-border)] px-1 [scrollbar-width:none]">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => setTab(item.key)}
            className={cn('-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors', tab === item.key ? 'border-[var(--ref-primary)] text-[var(--ref-primary)]' : 'border-transparent text-[var(--ref-on-surface-variant)] hover:text-[var(--ref-on-surface)]')}
          >
            {item.label}
            {item.count ? <span className="rounded-full bg-[var(--ref-surface-container-high)] px-1.5 text-[11px] tabular-nums text-[var(--ref-on-surface-variant)]">{item.count}</span> : null}
          </button>
        ))}
      </div>

      {/* Every tab stays mounted, so notes being typed and forms half filled survive a switch. */}
      <div role="tabpanel" hidden={tab !== 'overview'} className="@container space-y-6">
        {phase === 'during' && <TodayPanel trip={trip} now={now} />}
        {phase === 'after' && <TripRecap goalId={goal.id} trip={trip} target={goal.targetAmount} files={detail.attachments} />}
        <div className="grid grid-cols-1 items-start gap-6 @3xl:grid-cols-2">
          <TripBudget trip={trip} target={goal.targetAmount} />
          <div className="space-y-6">
            <NextUp trip={trip} now={now} go={go} />
            <GettingStarted trip={trip} onEdit={onEdit} go={go} />
          </div>
        </div>
        {/* The goal's own money, always on the page it opens to. */}
        <GrowthChart detail={detail} color={color} />
        <PartsSection detail={detail} onPay={onPayBreakdown} />
      </div>
      <div role="tabpanel" hidden={tab !== 'bookings'}>
        <BookingsSection goalId={goal.id} trip={trip} files={detail.attachments} canPay={canPay} onPay={onPayPart} now={now} />
      </div>
      <div role="tabpanel" hidden={tab !== 'days'}>
        <ItinerarySection goalId={goal.id} goalName={goal.name} trip={trip} typeData={goal.typeData} now={now} />
      </div>
      <div role="tabpanel" hidden={tab !== 'people'}>
        <PeopleSection goalId={goal.id} trip={trip} now={now} />
      </div>
      <div role="tabpanel" hidden={tab !== 'packing'}>
        <PackingPanel goalId={goal.id} trip={trip} />
      </div>
      <div role="tabpanel" hidden={tab !== 'notes'}>
        <NotesWorkspace key={goal.id} detail={detail} bookings={trip.bookings} />
      </div>
      <div role="tabpanel" hidden={tab !== 'files'}>
        <FilesSection detail={detail} />
      </div>
    </div>
  );
}
