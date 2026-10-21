import { useState, type ElementType, type ReactNode } from 'react';
import { CalendarDays, Check, Coins, MapPin, Pencil, Users } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
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
import { PackingSection, PeopleSection } from './PeopleSection';
import type { Trip } from './queries';
import { TripBudget } from './TripBudget';
import { TripSettings } from './TripSettings';
import { TodayPanel, TripRecap } from './TripStatus';
import { CURRENCIES, dayLabel, daysBetween, nextUp, shortDate, tripLength, tripPhase, type NextItem } from './trip-utils';

type Tab = 'overview' | 'bookings' | 'days' | 'people' | 'packing' | 'notes' | 'files';
const ROLE: Record<string, string> = { leave: 'Leaves', arrive: 'Lands', 'check-in': 'Check in', 'check-out': 'Check out', on: '' };

/** "10–16 Mar 2027", "28 Feb – 6 Mar 2027" or across years in full. */
function dateRange(start: number, end: number | null) {
  const from = new Date(start);
  if (end === null) return shortDate(start);
  const to = new Date(end);
  if (from.getFullYear() !== to.getFullYear()) return `${shortDate(start)} – ${shortDate(end)}`;
  if (from.getMonth() !== to.getMonth()) return `${from.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${shortDate(end)}`;
  return `${from.getDate()}–${shortDate(end)}`;
}

/** One fact about the trip in the strip, or a prompt to add it. */
function Fact({ icon: Icon, children, empty, onEdit }: { icon: ElementType; children?: ReactNode; empty?: string; onEdit: () => void }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-sm">
      <Icon className="h-4 w-4 shrink-0 text-[var(--ref-on-surface-variant)]" aria-hidden />
      {children ?? <button type="button" onClick={onEdit} className="font-medium text-[var(--ref-primary)] hover:underline">{empty}</button>}
    </span>
  );
}

/** The trip in one line: where, when (and how long until), the money there and who's going; Edit opens its settings. */
function TripStrip({ trip, now, onEdit, onPeople }: { trip: Trip; now: number; onEdit: () => void; onPeople: () => void }) {
  const { basics } = trip;
  const phase = tripPhase(basics, now);
  const days = tripLength(basics);
  const symbol = CURRENCIES.find((item) => item.code === basics.currency)?.symbol;
  const when = phase === 'before' ? `in ${daysBetween(now, basics.startDate!)} days` : phase === 'during' ? `day ${daysBetween(basics.startDate!, now) + 1} of ${days || '?'}` : phase === 'after' ? 'back home' : null;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 sm:px-5">
      <Fact icon={MapPin} empty="Add where you’re going" onEdit={onEdit}>{basics.places.length ? <span className="truncate font-semibold text-[var(--ref-on-surface)]">{basics.places.join(' → ')}</span> : undefined}</Fact>
      <Fact icon={CalendarDays} empty="Add dates" onEdit={onEdit}>
        {basics.startDate !== null ? (
          <span className="text-[var(--ref-on-surface)]">
            {dateRange(basics.startDate, basics.endDate)}
            {days > 0 && <span className="text-[var(--ref-on-surface-variant)]"> · {days} days</span>}
            {when && <span className={cn('ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold', phase === 'during' ? 'bg-[var(--ref-primary)] text-[var(--color-surface)]' : 'bg-[var(--ref-surface-container-high)] text-[var(--ref-on-surface-variant)]')}>{when}</span>}
          </span>
        ) : undefined}
      </Fact>
      <Fact icon={Coins} empty="Add the money there" onEdit={onEdit}>
        {basics.currency ? <span className="text-[var(--ref-on-surface)]">{basics.currency}{basics.rate ? <span className="text-[var(--ref-on-surface-variant)]"> · Rp{basics.rate.toLocaleString('id-ID')} for {symbol ?? basics.currency}1</span> : <span className="text-[var(--color-warning)]"> · no rate yet</span>}</span> : undefined}
      </Fact>
      <Fact icon={Users} empty="Add who’s going" onEdit={onPeople}>{trip.travellers.length ? <span className="text-[var(--ref-on-surface)]">{trip.travellers.map((traveller) => traveller.name).join(', ')}</span> : undefined}</Fact>
      <Button type="button" size="sm" variant="secondary" className="ml-auto" onClick={onEdit}><Pencil className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />Edit trip</Button>
    </div>
  );
}

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
 * A holiday goal's page below its top card: the trip in one line, then tabs: an overview (today's
 * plans on the trip, how it went after, the budget, what's next, what's left to set up, and the
 * goal's own money: how it's growing and its breakdown), bookings, the days, who's going,
 * packing, notes and files.
 */
export function TripWorkspace({ detail, trip, now, color, canPay, onPayPart, onPayBreakdown }: {
  detail: GoalDetail;
  trip: Trip;
  now: number;
  color: string;
  canPay: boolean;
  onPayPart: (partId: number) => void;
  onPayBreakdown: (part: GoalPart) => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
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
      <TripStrip trip={trip} now={now} onEdit={() => setEditing(true)} onPeople={() => go('people')} />

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
            <GettingStarted trip={trip} onEdit={() => setEditing(true)} go={go} />
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
        <ItinerarySection goalId={goal.id} goalName={goal.name} trip={trip} now={now} />
      </div>
      <div role="tabpanel" hidden={tab !== 'people'}>
        <PeopleSection goalId={goal.id} trip={trip} now={now} />
      </div>
      <div role="tabpanel" hidden={tab !== 'packing'}>
        <PackingSection goalId={goal.id} trip={trip} />
      </div>
      <div role="tabpanel" hidden={tab !== 'notes'}>
        <NotesWorkspace key={goal.id} detail={detail} bookings={trip.bookings} />
      </div>
      <div role="tabpanel" hidden={tab !== 'files'}>
        <FilesSection detail={detail} />
      </div>

      {editing && (
        <Modal isOpen onClose={() => setEditing(false)} title="Trip" footer={<div className="flex justify-end"><Button type="button" size="sm" onClick={() => setEditing(false)}>Done</Button></div>}>
          <p className="mb-2 text-sm text-[var(--ref-on-surface-variant)]">Changes save as you make them.</p>
          <TripSettings goalId={goal.id} trip={trip} />
        </Modal>
      )}
    </div>
  );
}
