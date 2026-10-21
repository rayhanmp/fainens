import { useState } from 'react';
import { BedDouble, CalendarPlus, ExternalLink, GripVertical, Plus, Printer, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { toast } from '../../../components/ui/useToast';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { cn } from '../../../lib/utils';
import { MoneyField, Segmented } from '../../savings/fields';
import { Dropdown } from '../../settings/controls';
import { Section } from '../../subscriptions/PageParts';
import { BOOKING_ICONS } from './booking-icons';
import { useAddPlanMutation, useDeletePlanMutation, useMovePlansMutation, useUpdatePlanMutation, type Trip } from './queries';
import { downloadCalendar, printItinerary } from './trip-export';
import { costText, dayKey, dayLabel, itinerary, mapsUrl, type DayItem, type TripPlan as Plan } from './trip-utils';

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const ROLE: Record<string, string> = { leave: 'Leaves', arrive: 'Lands', 'check-in': 'Check in', 'check-out': 'Check out' };

/** Adds a plan to a day, or edits one (and moves it to another day). */
function PlanForm({ goalId, trip, day, days, plan, onDone }: { goalId: number; trip: Trip; day: string; days: string[]; plan?: Plan; onDone: () => void }) {
  const add = useAddPlanMutation();
  const update = useUpdatePlanMutation();
  const remove = useDeletePlanMutation();
  const foreign = trip.basics.currency;
  const [title, setTitle] = useState(plan?.title ?? '');
  const [time, setTime] = useState(plan?.time ?? '');
  const [place, setPlace] = useState(plan?.place ?? '');
  const [cost, setCost] = useState(plan?.cost ?? 0);
  const [currency, setCurrency] = useState(plan?.costCurrency ?? foreign ?? 'IDR');
  const [onDay, setOnDay] = useState(plan?.day ?? day);

  const save = async () => {
    if (!title.trim()) return;
    const body = { day: onDay, time: time || null, title: title.trim(), place: place.trim() || null, cost, costCurrency: currency };
    try {
      if (plan) await update.mutateAsync({ id: plan.id, ...body });
      else await add.mutateAsync({ goalId, ...body });
      onDone();
    } catch (error) {
      toast.error(errorText(error, 'Could not save the plan'));
    }
  };

  return (
    <form onSubmit={(event) => { event.preventDefault(); void save(); }} onKeyDown={(event) => { if (event.key === 'Escape') onDone(); }} className="my-2 space-y-2 rounded-xl bg-[var(--ref-surface-container-low)] p-3">
      <div className="flex flex-wrap gap-2">
        <input aria-label="Time" type="time" className="brutalist-input h-[34px] w-[110px]" value={time} onChange={(event) => setTime(event.target.value)} />
        <input aria-label="Plan" autoFocus className="brutalist-input h-[34px] min-w-0 flex-1" placeholder="Fushimi Inari at sunrise" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <input aria-label="Where" className="brutalist-input h-[34px] min-w-0 flex-1" placeholder="Where (for the map)" value={place} maxLength={200} onChange={(event) => setPlace(event.target.value)} />
        {foreign && <Segmented ariaLabel="Currency" value={currency} options={[{ value: 'IDR', label: 'Rp' }, { value: foreign, label: foreign }]} onChange={setCurrency} />}
        <div className="w-[150px]">
          {currency === 'IDR'
            ? <MoneyField ariaLabel="Expected cost" value={cost} onChange={setCost} />
            : <input aria-label="Expected cost" inputMode="decimal" className="brutalist-input h-[34px] w-full text-right tabular-nums" placeholder="0" value={cost ? String(cost) : ''} onChange={(event) => { const value = Number(event.target.value.replace(/[^\d.,]/g, '').replace(',', '.')); setCost(Number.isFinite(value) ? value : 0); }} />}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {plan ? (
          <div className="flex items-center gap-2">
            <div className="w-[170px]"><Dropdown ariaLabel="Day" value={onDay} options={[...new Set([...days, plan.day])].map((key) => ({ value: key, label: days.includes(key) ? `Day ${days.indexOf(key) + 1} · ${dayLabel(key)}` : dayLabel(key) }))} onChange={setOnDay} /></div>
            <button type="button" aria-label="Remove plan" onClick={() => remove.mutate(plan.id, { onSuccess: onDone, onError: (error) => toast.error(errorText(error, 'Could not remove the plan')) })} className="grid h-[34px] w-[34px] place-items-center rounded-lg text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-high)]"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
          </div>
        ) : <span />}
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={onDone}>Cancel</Button>
          <Button type="submit" size="sm" isLoading={add.isPending || update.isPending} disabled={!title.trim()}>{plan ? 'Save' : 'Add'}</Button>
        </div>
      </div>
    </form>
  );
}

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

/**
 * The trip day by day. Each day shows its bookings where they fall (flights, check-in and
 * check-out, tickets), your own plans with their time, place and expected cost, and where you
 * sleep. Plans drag between days, or move by editing. Each day's plans are set against its
 * spending money, and once the day has passed, what was spent.
 */
export function ItinerarySection({ goalId, goalName, trip, now }: { goalId: number; goalName: string; trip: Trip; now: number }) {
  const { formatAmount } = useBalanceVisibility();
  const move = useMovePlansMutation(goalId);
  const [adding, setAdding] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [dragged, setDragged] = useState<Plan | null>(null);
  const [over, setOver] = useState<{ day: string; before: number | null } | null>(null);
  const { days, elsewhere } = itinerary(trip.basics, trip.bookings, trip.plans);
  const keys = days.map((day) => day.key);
  const today = dayKey(now);
  const people = Math.max(1, trip.travellers.length);
  const allowance = trip.basics.dailyBudget * people;
  const spentOn = new Map((trip.spending?.byDay ?? []).map((row) => [row.day, row.total]));

  const drop = (day: string) => {
    if (!dragged || !over) return;
    const order = trip.plans.filter((plan) => plan.day === day && plan.id !== dragged.id).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id).map((plan) => plan.id);
    const at = over.before === null ? order.length : Math.max(0, order.indexOf(over.before));
    order.splice(at, 0, dragged.id);
    move.mutate({ day, ids: order }, { onError: (error) => toast.error(errorText(error, 'Could not move the plan')) });
    setDragged(null);
    setOver(null);
  };

  const exportMenu = days.length > 0 && (
    <span className="flex gap-1">
      <Button type="button" size="sm" variant="secondary" className="h-[30px] px-2 text-xs" onClick={() => downloadCalendar(goalName, trip.bookings, trip.plans)}><CalendarPlus className="mr-1 inline h-3.5 w-3.5" aria-hidden />Calendar</Button>
      <Button type="button" size="sm" variant="secondary" className="h-[30px] px-2 text-xs" onClick={() => printItinerary(goalName, trip.basics, trip.bookings, trip.plans, formatAmount)}><Printer className="mr-1 inline h-3.5 w-3.5" aria-hidden />Print</Button>
    </span>
  );

  return (
    <Section title="Day by day" aside={exportMenu || undefined}>
      {days.length === 0 ? (
        <p className="px-4 py-4 text-sm text-[var(--ref-on-surface-variant)] sm:px-5">Add when you leave and come back in Trip to plan each day. Bookings with a date show up on their day.</p>
      ) : (
        <ol className="divide-y divide-[var(--color-border)]">
          {days.map((day) => {
            const isToday = day.key === today;
            const spent = day.key <= today ? spentOn.get(day.key) ?? 0 : null;
            return (
              <li
                key={day.key}
                onDragOver={(event) => { if (!dragged) return; event.preventDefault(); if (over?.day !== day.key || over.before !== null) setOver({ day: day.key, before: null }); }}
                onDrop={(event) => { event.preventDefault(); drop(day.key); }}
                className={cn('px-4 py-3 sm:px-5', isToday && 'bg-[var(--ref-primary)]/5', dragged && over?.day === day.key && over.before === null && 'bg-[var(--ref-surface-container-low)]')}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 className="text-sm font-semibold text-[var(--ref-on-surface)]">
                    Day {day.index} <span className="font-normal text-[var(--ref-on-surface-variant)]">· {dayLabel(day.key)}</span>
                    {isToday && <span className="ml-2 rounded-full bg-[var(--ref-primary)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-surface)]">Today</span>}
                  </h3>
                  <span className="text-xs tabular-nums text-[var(--ref-on-surface-variant)]">
                    {day.planned > 0 && <>{formatAmount(day.planned)} planned</>}
                    {day.planned > 0 && allowance > 0 && ' · '}
                    {allowance > 0 && <>{formatAmount(allowance)} spending money</>}
                    {spent !== null && spent > 0 && <span className={cn('font-semibold', allowance > 0 && spent > allowance + day.planned ? 'text-[var(--color-warning)]' : 'text-[var(--ref-on-surface)]')}> · {formatAmount(spent)} spent</span>}
                  </span>
                </div>
                {day.items.length > 0 && (
                  <ul className="mt-1">
                    {day.items.map((item) => (
                      item.type === 'plan' && editing === item.plan.id
                        ? <li key={`plan-${item.plan.id}`}><PlanForm goalId={goalId} trip={trip} day={day.key} days={keys} plan={item.plan} onDone={() => setEditing(null)} /></li>
                        : (
                          <ItemRow
                            key={item.type === 'plan' ? `plan-${item.plan.id}` : `${item.role}-${item.booking.id}`}
                            item={item}
                            onEdit={(plan) => { setAdding(null); setEditing(plan.id); }}
                            dragging={item.type === 'plan' && dragged?.id === item.plan.id}
                            onDragStart={setDragged}
                            onDragEnd={() => { setDragged(null); setOver(null); }}
                            onDragOverPlan={(plan) => { if (over?.before !== plan.id) setOver({ day: day.key, before: plan.id }); }}
                            dropBefore={item.type === 'plan' && dragged !== null && over?.before === item.plan.id && dragged.id !== item.plan.id}
                          />
                        )
                    ))}
                  </ul>
                )}
                {day.sleep && <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--ref-on-surface-variant)]"><BedDouble className="h-3.5 w-3.5" aria-hidden />Night at {day.sleep.title}</p>}
                {adding === day.key
                  ? <PlanForm goalId={goalId} trip={trip} day={day.key} days={keys} onDone={() => setAdding(null)} />
                  : <button type="button" onClick={() => { setEditing(null); setAdding(day.key); }} className="mt-1 inline-flex items-center gap-1 rounded-md py-1 text-xs font-semibold text-[var(--ref-primary)] hover:underline"><Plus className="h-3.5 w-3.5" aria-hidden />Plan</button>}
              </li>
            );
          })}
        </ol>
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
