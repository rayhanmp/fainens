import { useState } from 'react';
import { BedDouble, CalendarPlus, ChevronLeft, ChevronRight, ExternalLink, GripVertical, Plus, Printer } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { toast } from '../../../components/ui/useToast';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { cn } from '../../../lib/utils';
import { Segmented } from '../../savings/fields';
import { Dropdown } from '../../settings/controls';
import { Section } from '../../subscriptions/PageParts';
import { BOOKING_ICONS } from './booking-icons';
import { PlanForm } from './PlanForm';
import { useMovePlansMutation, type Trip } from './queries';
import { TripCalendar } from './TripCalendar';
import { downloadCalendar, printItinerary } from './trip-export';
import { useUpdateGoalMutation } from '../queries';
import { costText, dayCities, dayKey, dayLabel, itinerary, mapsUrl, partOfDay, PARTS_OF_DAY, type DayItem, type PartOfDay, type TripPlan as Plan } from './trip-utils';

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const ROLE: Record<string, string> = { leave: 'Leaves', arrive: 'Lands', 'check-in': 'Check in', 'check-out': 'Check out' };

function ItemRow({ item, onEdit, dragging, onDragStart, onDragEnd, onDragOverPlan, dropBefore }: {
  item: DayItem;
  onEdit: (plan: Plan) => void;
  dragging: boolean;
  onDragStart: (plan: Plan) => void;
  onDragEnd: () => void;
  onDragOverPlan: (plan: Plan) => void;
  dropBefore: boolean;
}) {
  const { formatAmount } = useBalanceVisibility();
  if (item.type === 'booking') {
    const Icon = BOOKING_ICONS[item.booking.kind];
    const to = typeof item.booking.details.to === 'string' ? item.booking.details.to : null;
    return (
      <li className="flex items-start gap-3 py-2">
        <span className="w-11 shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-[var(--ref-on-surface-variant)]">{item.time ?? ''}</span>
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ref-on-surface-variant)]" aria-hidden />
        <span className="min-w-0 flex-1 text-sm text-[var(--ref-on-surface)]">
          {ROLE[item.role] && <span className="font-semibold">{ROLE[item.role]}: </span>}
          {item.booking.title}
          {item.booking.kind === 'flight' && (item.booking.place || to) && <span className="text-[var(--ref-on-surface-variant)]"> · {[item.booking.place, to].filter(Boolean).join(' → ')}</span>}
        </span>
      </li>
    );
  }
  const { plan } = item;
  return (
    <li
      draggable
      onDragStart={(event) => { event.dataTransfer.setData('text/plain', String(plan.id)); event.dataTransfer.effectAllowed = 'move'; onDragStart(plan); }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); onDragOverPlan(plan); }}
      className={cn('group relative flex items-start gap-3 py-2', dragging && 'opacity-40', dropBefore && 'before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:rounded-full before:bg-[var(--ref-primary)]')}
    >
      <span className="w-11 shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-[var(--ref-on-surface-variant)]">{plan.time ?? ''}</span>
      <GripVertical className="mt-0.5 h-4 w-4 shrink-0 cursor-grab text-[var(--ref-on-surface-variant)] opacity-50 group-hover:opacity-100" aria-hidden />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => onEdit(plan)} className="block max-w-full text-left text-sm text-[var(--ref-on-surface)] hover:underline">{plan.title}</button>
        {plan.place && <a href={mapsUrl(plan.place)} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-center gap-0.5 text-xs font-medium text-[var(--ref-primary)] hover:underline"><span className="truncate">{plan.place}</span><ExternalLink className="h-3 w-3 shrink-0" aria-hidden /></a>}
      </div>
      {plan.cost > 0 && (
        <span className="shrink-0 text-right text-xs tabular-nums text-[var(--ref-on-surface-variant)]">
          {plan.costCurrency !== 'IDR' && <span className="block">{costText(plan.cost, plan.costCurrency)}</span>}
          <span className="block font-semibold text-[var(--ref-on-surface)]">{plan.rupiah > 0 ? formatAmount(plan.rupiah) : '—'}</span>
        </span>
      )}
    </li>
  );
}

/** The city a day is spent in: pick one of the trip's places, or type another. */
function CityPicker({ city, places, onChange }: { city: string; places: string[]; onChange: (city: string) => void }) {
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState(city);
  if (typing || !places.length) {
    return (
      <form onSubmit={(event) => { event.preventDefault(); if (draft.trim()) onChange(draft.trim()); setTyping(false); }} className="flex items-center gap-1.5">
        <input aria-label="City" autoFocus={typing} className="brutalist-input h-[30px] w-[150px] text-sm" placeholder="Which city?" value={draft} maxLength={80} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft.trim() && draft.trim() !== city) onChange(draft.trim()); setTyping(false); }} />
      </form>
    );
  }
  return (
    <div className="w-[170px]">
      <Dropdown
        ariaLabel="City"
        value={places.includes(city) ? city : '__other'}
        options={[...places.map((place) => ({ value: place, label: place })), ...(!places.includes(city) && city ? [{ value: '__other', label: city }] : []), { value: '__type', label: 'Another city…' }]}
        onChange={(value) => { if (value === '__type') { setDraft(''); setTyping(true); } else if (value !== '__other') onChange(value); }}
      />
    </div>
  );
}

/**
 * The trip day by day: a strip of its days (with the city and how full each is) to pick one, then
 * that day as morning, afternoon, evening and any time, with its bookings where they fall
 * (leaving, landing, check-in, check-out, tickets), your plans with their time, place and cost,
 * where you sleep, its budget and, once it's passed, what was spent. Drag a plan onto another
 * day in the strip to move it there, or open it and pick the day.
 */
export function ItinerarySection({ goalId, goalName, trip, typeData, now }: { goalId: number; goalName: string; trip: Trip; typeData: Record<string, unknown>; now: number }) {
  const { formatAmount } = useBalanceVisibility();
  const move = useMovePlansMutation(goalId);
  const updateGoal = useUpdateGoalMutation();
  const [view, setView] = useState<'calendar' | 'day'>('calendar');
  const [editing, setEditing] = useState<number | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [dragged, setDragged] = useState<Plan | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const { days, elsewhere } = itinerary(trip.basics, trip.bookings, trip.plans);
  const keys = days.map((day) => day.key);
  const today = dayKey(now);
  const [picked, setPicked] = useState<string | null>(null);
  const selected = days.find((day) => day.key === picked) ?? days.find((day) => day.key === today) ?? days[0];
  const chosen = typeData.dayPlaces && typeof typeData.dayPlaces === 'object' ? typeData.dayPlaces as Record<string, unknown> : {};
  const cities = dayCities(keys, trip.basics.places, chosen);
  const people = Math.max(1, trip.travellers.length);
  const allowance = trip.basics.dailyBudget * people;
  const spentOn = new Map((trip.spending?.byDay ?? []).map((row) => [row.day, row.total]));

  const moveTo = (day: string) => {
    if (!dragged || dragged.day === day) return;
    const order = [...trip.plans.filter((plan) => plan.day === day).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id).map((plan) => plan.id), dragged.id];
    move.mutate({ day, ids: order }, { onError: (error) => toast.error(errorText(error, 'Could not move the plan')) });
    setDragged(null);
    setOverDay(null);
  };
  const setCity = (day: string, city: string) => updateGoal.mutate({ id: goalId, typeData: { ...typeData, dayPlaces: { ...chosen, [day]: city } } }, { onError: (error) => toast.error(errorText(error, 'Could not save the city')) });

  const exportMenu = days.length > 0 && (
    <span className="flex flex-wrap items-center gap-2">
      <Segmented ariaLabel="Show" value={view} onChange={setView} options={[{ value: 'calendar', label: 'Calendar' }, { value: 'day', label: 'One day' }]} />
      <Button type="button" size="sm" variant="secondary" className="h-[30px] px-2 text-xs" title="Save as a calendar file" onClick={() => downloadCalendar(goalName, trip.bookings, trip.plans)}><CalendarPlus className="mr-1 inline h-3.5 w-3.5" aria-hidden />.ics</Button>
      <Button type="button" size="sm" variant="secondary" className="h-[30px] px-2 text-xs" onClick={() => printItinerary(goalName, trip.basics, trip.bookings, trip.plans, formatAmount)}><Printer className="mr-1 inline h-3.5 w-3.5" aria-hidden />Print</Button>
    </span>
  );

  const index = selected ? days.indexOf(selected) : -1;
  const spent = selected && selected.key <= today ? spentOn.get(selected.key) ?? 0 : null;
  const parts = selected ? (Object.keys(PARTS_OF_DAY) as PartOfDay[]).map((part) => ({ part, items: selected.items.filter((item) => partOfDay(item.time) === part) })) : [];

  return (
    <Section title="Day by day" aside={exportMenu || undefined}>
      {!selected ? (
        <p className="px-4 py-4 text-sm text-[var(--ref-on-surface-variant)] sm:px-5">Add when you leave and come back in Trip to plan each day. Bookings with a date show up on their day.</p>
      ) : view === 'calendar' ? (
        <>
          <TripCalendar goalId={goalId} trip={trip} days={days} cities={cities} today={today} onOpenDay={(day) => { setPicked(day); setView('day'); }} />
          <p className="border-t border-[var(--color-border)] px-4 py-2.5 text-xs text-[var(--ref-on-surface-variant)] sm:px-5">Click a free spot to add a plan then, or a plan to change it; drag a plan to another day or time. Drag a free spot sideways to move the calendar. A day’s name opens it on its own.</p>
        </>
      ) : (
        <>
          {/* The days to pick from; drop a plan on one to move it there. */}
          <div className="flex gap-2 overflow-x-auto border-b border-[var(--color-border)] px-4 py-3 [scrollbar-width:none] sm:px-5" role="tablist" aria-label="Days">
            {days.map((day, at) => {
              const count = day.items.length;
              const isSelected = day.key === selected.key;
              return (
                <button
                  key={day.key}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  ref={isSelected ? (node) => node?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) : undefined}
                  onClick={() => { setPicked(day.key); setEditing(null); }}
                  onDragOver={(event) => { if (!dragged) return; event.preventDefault(); if (overDay !== day.key) setOverDay(day.key); }}
                  onDragLeave={() => { if (overDay === day.key) setOverDay(null); }}
                  onDrop={(event) => { event.preventDefault(); moveTo(day.key); }}
                  className={cn(
                    'flex w-[92px] shrink-0 flex-col rounded-xl border px-2.5 py-2 text-left transition-colors',
                    isSelected ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)]/10' : 'border-[var(--color-border)] hover:bg-[var(--ref-surface-container-low)]',
                    overDay === day.key && 'border-[var(--ref-primary)] ring-2 ring-[var(--ref-primary)]/30',
                  )}
                >
                  <span className={cn('text-[11px] font-bold uppercase tracking-wide', isSelected ? 'text-[var(--ref-primary)]' : 'text-[var(--ref-on-surface-variant)]')}>Day {day.index}{day.key === today ? ' · today' : ''}</span>
                  <span className="text-sm font-semibold text-[var(--ref-on-surface)]">{new Date(day.noon).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}</span>
                  <span className="truncate text-xs text-[var(--ref-on-surface-variant)]">{cities[at] || '—'}</span>
                  {/* How full the day is: a dot a thing, up to four. */}
                  <span className="mt-1.5 flex h-1.5 gap-0.5" aria-label={`${count} thing${count === 1 ? '' : 's'}`}>
                    {count === 0 ? <span className="h-1.5 w-1.5 rounded-full border border-[var(--ref-outline)]" /> : Array.from({ length: Math.min(4, count) }, (_, dot) => <span key={dot} className="h-1.5 w-1.5 rounded-full bg-[var(--ref-primary)]" />)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="px-4 py-4 sm:px-5" role="tabpanel">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-headline text-lg font-bold text-[var(--ref-on-surface)]">Day {selected.index} · {dayLabel(selected.key)}</h3>
                <p className="mt-0.5 text-xs tabular-nums text-[var(--ref-on-surface-variant)]">
                  {[
                    allowance > 0 ? `${formatAmount(allowance)} spending money` : null,
                    selected.planned > 0 ? `${formatAmount(selected.planned)} planned` : null,
                  ].filter(Boolean).join(' · ') || 'No spending money set'}
                  {spent !== null && spent > 0 && <span className={cn('font-semibold', allowance > 0 && spent > allowance + selected.planned ? 'text-[var(--color-warning)]' : 'text-[var(--ref-on-surface)]')}> · {formatAmount(spent)} spent</span>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <CityPicker key={`${selected.key}:${cities[index]}`} city={cities[index] ?? ''} places={trip.basics.places} onChange={(city) => setCity(selected.key, city)} />
                <span className="flex">
                  <button type="button" aria-label="The day before" disabled={index <= 0} onClick={() => setPicked(days[index - 1].key)} className="grid h-[30px] w-[30px] place-items-center rounded-lg text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)] disabled:opacity-30"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
                  <button type="button" aria-label="The day after" disabled={index >= days.length - 1} onClick={() => setPicked(days[index + 1].key)} className="grid h-[30px] w-[30px] place-items-center rounded-lg text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)] disabled:opacity-30"><ChevronRight className="h-4 w-4" aria-hidden /></button>
                </span>
              </div>
            </div>

            {/* The day by its parts, so it reads like the day itself. */}
            <div className="mt-4 space-y-3">
              {parts.filter(({ part, items }) => items.length > 0 || part !== 'any').map(({ part, items }) => (
                <div key={part} className="grid grid-cols-[78px_minmax(0,1fr)] gap-3">
                  <p className="pt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ref-on-surface-variant)]">{PARTS_OF_DAY[part]}</p>
                  {items.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-2 text-xs text-[var(--ref-on-surface-variant)]">Nothing yet</p>
                  ) : (
                    <ul className="rounded-lg bg-[var(--ref-surface-container-low)] px-2">
                      {items.map((item) => (
                        item.type === 'plan' && editing === item.plan.id
                          ? <li key={`plan-${item.plan.id}`}><PlanForm goalId={goalId} trip={trip} day={selected.key} days={keys} plan={item.plan} onDone={() => setEditing(null)} /></li>
                          : (
                            <ItemRow
                              key={item.type === 'plan' ? `plan-${item.plan.id}` : `${item.role}-${item.booking.id}`}
                              item={item}
                              onEdit={(plan) => setEditing(plan.id)}
                              dragging={item.type === 'plan' && dragged?.id === item.plan.id}
                              onDragStart={setDragged}
                              onDragEnd={() => { setDragged(null); setOverDay(null); }}
                              onDragOverPlan={() => {}}
                              dropBefore={false}
                            />
                          )
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
            {selected.sleep && <p className="mt-3 flex items-center gap-1.5 text-sm text-[var(--ref-on-surface-variant)]"><BedDouble className="h-4 w-4" aria-hidden />Night at <span className="font-medium text-[var(--ref-on-surface)]">{selected.sleep.title}</span></p>}

            <div className="mt-4 border-t border-[var(--color-border)] pt-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--ref-on-surface)]"><Plus className="h-4 w-4" aria-hidden />Add to this day</p>
              <PlanForm key={`${selected.key}:${formKey}`} goalId={goalId} trip={trip} day={selected.key} days={keys} onDone={() => setFormKey((value) => value + 1)} />
              <p className="text-xs text-[var(--ref-on-surface-variant)]">Without a time it goes under Any time. Drag a plan onto another day above to move it.</p>
            </div>
          </div>
        </>
      )}
      {elsewhere.length > 0 && (
        <div className="border-t border-[var(--color-border)] px-4 py-3 sm:px-5">
          <p className="text-xs font-semibold text-[var(--ref-on-surface-variant)]">Not on a day of the trip any more. Open one to move it.</p>
          <ul className="mt-1">
            {elsewhere.map((plan) => (
              editing === plan.id
                ? <li key={plan.id}><PlanForm goalId={goalId} trip={trip} day={keys[0] ?? plan.day} days={keys} plan={plan} onDone={() => setEditing(null)} /></li>
                : <li key={plan.id}><button type="button" onClick={() => setEditing(plan.id)} className="py-1 text-left text-sm text-[var(--ref-on-surface)] hover:underline">{dayLabel(plan.day)} · {plan.title}</button></li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}
