import type { ElementType, ReactNode } from 'react';
import { CalendarDays, Check, CloudSun, Coins, MapPin, Pencil, Users, Wallet } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { cn } from '../../../lib/utils';
import { Section } from '../../subscriptions/PageParts';
import { guessClimate, guessText, WEATHER } from './climate';
import { useTripSave, type Trip } from './queries';
import { DatesEditor, MoneyEditor, PlacesEditor, SpendingEditor, WeatherEditor } from './TripSettings';
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

/** One fact about the trip: its value, its field while editing, or a prompt to add it. */
function Fact({ icon: Icon, label, children, empty, onAdd, editor }: { icon: ElementType; label: string; children?: ReactNode; empty: string; onAdd: () => void; editor?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 sm:px-5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ref-on-surface-variant)]" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={cn('text-xs text-[var(--ref-on-surface-variant)]', editor && 'mb-1.5 font-semibold')}>{label}</p>
        {editor || <div className="mt-0.5 text-sm text-[var(--ref-on-surface)]">{children ?? <button type="button" onClick={onAdd} className="font-medium text-[var(--ref-primary)] hover:underline">{empty}</button>}</div>}
      </div>
    </div>
  );
}

/**
 * The trip beside its page: where, when and how long until, the money there and its rate,
 * spending money a day, who's going and the weather (guessed from where and when, unless said).
 * Edit turns each into its field right here; changes save as they're made.
 */
export function TripSummary({ goalId, trip, now, editing, onEditing, onPeople }: { goalId: number; trip: Trip; now: number; editing: boolean; onEditing: (editing: boolean) => void; onPeople: () => void }) {
  const { formatAmount } = useBalanceVisibility();
  const save = useTripSave(goalId);
  const { basics } = trip;
  const phase = tripPhase(basics, now);
  const days = tripLength(basics);
  const symbol = CURRENCIES.find((item) => item.code === basics.currency)?.symbol;
  const guess = guessClimate(basics.places, basics.startDate, basics.endDate);
  const when = phase === 'before' ? `in ${daysBetween(now, basics.startDate!)} days` : phase === 'during' ? `day ${daysBetween(basics.startDate!, now) + 1} of ${days || '?'}` : phase === 'after' ? 'back home' : null;
  const edit = () => onEditing(true);
  return (
    <Section
      title="Trip"
      aside={editing
        ? <Button type="button" size="sm" onClick={() => onEditing(false)}><Check className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />Done</Button>
        : <Button type="button" size="sm" variant="secondary" onClick={edit}><Pencil className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />Edit</Button>}
    >
      <div className={cn('divide-y divide-[var(--color-border)]', editing && 'settings-compact')}>
        <Fact icon={MapPin} label="Where" empty="Add where you’re going" onAdd={edit} editor={editing && <PlacesEditor places={basics.places} save={(places) => save({ places })} />}>
          {basics.places.length ? <span className="font-semibold">{basics.places.join(' → ')}</span> : undefined}
        </Fact>
        <Fact icon={CalendarDays} label="When" empty="Add dates" onAdd={edit} editor={editing && <DatesEditor trip={trip} save={save} />}>
          {basics.startDate !== null ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{dateRange(basics.startDate, basics.endDate)}{days > 0 && <span className="text-[var(--ref-on-surface-variant)]"> · {days} days</span>}</span>
              {when && <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', phase === 'during' ? 'bg-[var(--ref-primary)] text-[var(--color-surface)]' : 'bg-[var(--ref-surface-container-high)] text-[var(--ref-on-surface-variant)]')}>{when}</span>}
            </span>
          ) : undefined}
        </Fact>
        <Fact icon={Coins} label="Money there" empty="Add the currency" onAdd={edit} editor={editing && <MoneyEditor key={`${basics.currency}:${basics.rate}`} trip={trip} save={save} />}>
          {basics.currency ? <span>{basics.currency}{basics.rate ? <span className="text-[var(--ref-on-surface-variant)]"> · Rp{basics.rate.toLocaleString('id-ID')} for {symbol ?? basics.currency}1</span> : <span className="text-[var(--color-warning)]"> · no rate yet</span>}</span> : undefined}
        </Fact>
        <Fact icon={Wallet} label="Spending money" empty="Add a day’s spending money" onAdd={edit} editor={editing && <SpendingEditor key={basics.dailyBudget} trip={trip} save={save} />}>
          {basics.dailyBudget > 0 ? <span className="tabular-nums">{formatAmount(basics.dailyBudget)} <span className="text-[var(--ref-on-surface-variant)]">a person a day</span></span> : undefined}
        </Fact>
        <Fact icon={Users} label="Who’s going" empty="Add who’s going" onAdd={onPeople}>
          {trip.travellers.length ? <button type="button" onClick={onPeople} className="text-left hover:underline">{trip.travellers.map((traveller) => traveller.name).join(', ')}</button> : undefined}
        </Fact>
        <Fact icon={CloudSun} label="Weather" empty="Say what it’s like" onAdd={edit} editor={editing && <WeatherEditor trip={trip} save={save} />}>
          {basics.climate ? WEATHER[basics.climate] : guess ? (
            <span title={guess.sources}>
              {WEATHER[guess.climate]}
              <span className="text-[var(--ref-on-surface-variant)]"> · {guessText(guess)}</span>
            </span>
          ) : undefined}
        </Fact>
      </div>
    </Section>
  );
}
