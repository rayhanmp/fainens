import type { ElementType, ReactNode } from 'react';
import { CalendarDays, CloudSun, Coins, MapPin, Pencil, Users, Wallet } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { cn } from '../../../lib/utils';
import { Section } from '../../subscriptions/PageParts';
import type { Trip } from './queries';
import { TripSettings } from './TripSettings';
import { CURRENCIES, daysBetween, shortDate, tripLength, tripPhase } from './trip-utils';

/** "10–16 Mar 2027", "28 Feb – 6 Mar 2027" or across years in full. */
function dateRange(start: number, end: number | null) {
  const from = new Date(start);
  if (end === null) return shortDate(start);
  const to = new Date(end);
  if (from.getFullYear() !== to.getFullYear()) return `${shortDate(start)} – ${shortDate(end)}`;
  if (from.getMonth() !== to.getMonth()) return `${from.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${shortDate(end)}`;
  return `${from.getDate()}–${shortDate(end)}`;
}

/** One fact about the trip, or a prompt to add it. */
function Fact({ icon: Icon, label, children, empty, onAdd }: { icon: ElementType; label: string; children?: ReactNode; empty: string; onAdd: () => void }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 sm:px-5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ref-on-surface-variant)]" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-[var(--ref-on-surface-variant)]">{label}</p>
        <div className="mt-0.5 text-sm text-[var(--ref-on-surface)]">{children ?? <button type="button" onClick={onAdd} className="font-medium text-[var(--ref-primary)] hover:underline">{empty}</button>}</div>
      </div>
    </div>
  );
}

const WEATHER = { cold: 'Cold', warm: 'Warm', mixed: 'Some of each' } as const;

/**
 * The trip beside its page: where, when and how long until, the money there and its rate,
 * spending money a day, who's going and the weather. Edit opens its settings; who's going opens
 * the People tab.
 */
export function TripSummary({ trip, now, onEdit, onPeople }: { trip: Trip; now: number; onEdit: () => void; onPeople: () => void }) {
  const { formatAmount } = useBalanceVisibility();
  const { basics } = trip;
  const phase = tripPhase(basics, now);
  const days = tripLength(basics);
  const symbol = CURRENCIES.find((item) => item.code === basics.currency)?.symbol;
  const when = phase === 'before' ? `in ${daysBetween(now, basics.startDate!)} days` : phase === 'during' ? `day ${daysBetween(basics.startDate!, now) + 1} of ${days || '?'}` : phase === 'after' ? 'back home' : null;
  return (
    <Section title="Trip" aside={<Button type="button" size="sm" variant="secondary" onClick={onEdit}><Pencil className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />Edit</Button>}>
      <div className="divide-y divide-[var(--color-border)]">
        <Fact icon={MapPin} label="Where" empty="Add where you’re going" onAdd={onEdit}>{basics.places.length ? <span className="font-semibold">{basics.places.join(' → ')}</span> : undefined}</Fact>
        <Fact icon={CalendarDays} label="When" empty="Add dates" onAdd={onEdit}>
          {basics.startDate !== null ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{dateRange(basics.startDate, basics.endDate)}{days > 0 && <span className="text-[var(--ref-on-surface-variant)]"> · {days} days</span>}</span>
              {when && <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', phase === 'during' ? 'bg-[var(--ref-primary)] text-[var(--color-surface)]' : 'bg-[var(--ref-surface-container-high)] text-[var(--ref-on-surface-variant)]')}>{when}</span>}
            </span>
          ) : undefined}
        </Fact>
        <Fact icon={Coins} label="Money there" empty="Add the currency" onAdd={onEdit}>
          {basics.currency ? <span>{basics.currency}{basics.rate ? <span className="text-[var(--ref-on-surface-variant)]"> · Rp{basics.rate.toLocaleString('id-ID')} for {symbol ?? basics.currency}1</span> : <span className="text-[var(--color-warning)]"> · no rate yet</span>}</span> : undefined}
        </Fact>
        <Fact icon={Wallet} label="Spending money" empty="Add a day’s spending money" onAdd={onEdit}>
          {basics.dailyBudget > 0 ? <span className="tabular-nums">{formatAmount(basics.dailyBudget)} <span className="text-[var(--ref-on-surface-variant)]">a person a day</span></span> : undefined}
        </Fact>
        <Fact icon={Users} label="Who’s going" empty="Add who’s going" onAdd={onPeople}>
          {trip.travellers.length ? <button type="button" onClick={onPeople} className="text-left hover:underline">{trip.travellers.map((traveller) => traveller.name).join(', ')}</button> : undefined}
        </Fact>
        <Fact icon={CloudSun} label="Weather" empty="Say what it’s like" onAdd={onEdit}>{basics.climate ? WEATHER[basics.climate] : undefined}</Fact>
      </div>
    </Section>
  );
}

/** The trip's settings in a dialog; each change saves as it's made. */
export function TripSettingsDialog({ goalId, trip, onClose }: { goalId: number; trip: Trip; onClose: () => void }) {
  return (
    <Modal isOpen onClose={onClose} title="Trip" footer={<div className="flex justify-end"><Button type="button" size="sm" onClick={onClose}>Done</Button></div>}>
      <p className="mb-2 text-sm text-[var(--ref-on-surface-variant)]">Changes save as you make them.</p>
      <TripSettings goalId={goalId} trip={trip} />
    </Modal>
  );
}
