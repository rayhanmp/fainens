import { useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { toast } from '../../../components/ui/useToast';
import { cn } from '../../../lib/utils';
import { BOOKING_ICONS } from './booking-icons';
import { PlanForm } from './PlanForm';
import { useUpdatePlanMutation, type Trip } from './queries';
import { calendarLanes, clockOf, dayLabel, minutesOf, wallDay, wallTime, type DayItem, type TripPlan as Plan } from './trip-utils';

const HOUR = 48;
const ROLE: Record<string, string> = { leave: 'Leaves', arrive: 'Lands', 'check-in': 'Check in', 'check-out': 'Check out', on: '' };
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

type CalendarDay = { key: string; index: number; noon: number; items: DayItem[] };
type Block = { id: string; item: DayItem; start: number; end: number };

/** How long a thing takes up on the calendar: a flight until it lands that day, a check-in or out a moment, the rest an hour. */
function blockOf(item: DayItem): Block | null {
  if (item.time === null) return null;
  const start = minutesOf(item.time);
  let end = start + 60;
  if (item.type === 'booking') {
    const { booking } = item;
    if (item.role === 'check-in' || item.role === 'check-out') end = start + 45;
    else if (item.role !== 'arrive' && booking.endAt !== null && booking.startAt !== null && wallDay(booking.endAt) === wallDay(booking.startAt) && wallTime(booking.endAt)) end = Math.max(start + 30, minutesOf(wallTime(booking.endAt)!));
  }
  const id = item.type === 'plan' ? `plan-${item.plan.id}` : `${item.role}-${item.booking.id}`;
  return { id, item, start, end: Math.min(24 * 60, end) };
}

const blockTitle = (item: DayItem) => (item.type === 'plan' ? item.plan.title : `${ROLE[item.role] ? `${ROLE[item.role]}: ` : ''}${item.booking.title}`);

/**
 * The trip as a calendar: a column for each day with its city, hours down the side, bookings and
 * plans as blocks at their times (side by side when they overlap) and untimed plans along the top.
 * Click an empty slot to add a plan there, click a plan to change it, or drag it to another day or
 * time. A day's header opens that day on its own.
 */
export function TripCalendar({ goalId, trip, days, cities, today, onOpenDay }: {
  goalId: number;
  trip: Trip;
  days: CalendarDay[];
  cities: string[];
  today: string;
  onOpenDay: (day: string) => void;
}) {
  const update = useUpdatePlanMutation();
  const [dialog, setDialog] = useState<{ day: string; time: string | null; plan?: Plan } | null>(null);
  const [dragged, setDragged] = useState<Plan | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const keys = days.map((day) => day.key);
  const blocks = days.map((day) => day.items.map(blockOf).filter((block): block is Block => block !== null));
  const allStarts = blocks.flat().map((block) => block.start);
  const allEnds = blocks.flat().map((block) => block.end);
  const from = Math.max(0, Math.min(7, ...allStarts.map((start) => Math.floor(start / 60))));
  const to = Math.min(24, Math.max(22, ...allEnds.map((end) => Math.ceil(end / 60))));
  const height = (to - from) * HOUR;
  const columns = `52px repeat(${days.length}, minmax(124px, 1fr))`;

  const timeAt = (event: React.MouseEvent | React.DragEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const minutes = from * 60 + Math.round(((event.clientY - rect.top) / HOUR) * 60 / 30) * 30;
    return clockOf(Math.max(from * 60, Math.min(to * 60 - 30, minutes)));
  };
  const move = (plan: Plan, day: string, time: string | null) => {
    if (plan.day === day && plan.time === time) return;
    update.mutate({ id: plan.id, day, time }, { onError: (error) => toast.error(errorText(error, 'Could not move the plan')) });
  };
  const dropOn = (day: string, time: string | null) => {
    if (dragged) move(dragged, day, time);
    setDragged(null);
    setOverDay(null);
  };
  const dragProps = (plan: Plan) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent) => { event.stopPropagation(); event.dataTransfer.setData('text/plain', String(plan.id)); event.dataTransfer.effectAllowed = 'move'; setDragged(plan); },
    onDragEnd: () => { setDragged(null); setOverDay(null); },
  });

  return (
    <>
      <div className="overflow-x-auto">
        <div className="grid" style={{ gridTemplateColumns: columns, minWidth: 52 + days.length * 124 }}>
          {/* Day headers, with the city; each opens that day. */}
          <div className="sticky left-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-surface)]" />
          {days.map((day, at) => (
            <button key={day.key} type="button" onClick={() => onOpenDay(day.key)} className={cn('border-b border-l border-[var(--color-border)] px-2 py-2 text-left hover:bg-[var(--ref-surface-container-low)]', day.key === today && 'bg-[var(--ref-primary)]/10')}>
              <span className={cn('block text-[11px] font-bold uppercase tracking-wide', day.key === today ? 'text-[var(--ref-primary)]' : 'text-[var(--ref-on-surface-variant)]')}>Day {day.index}{day.key === today ? ' · today' : ''}</span>
              <span className="block text-sm font-semibold text-[var(--ref-on-surface)]">{new Date(day.noon).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              <span className="block truncate text-xs text-[var(--ref-on-surface-variant)]">{cities[at] || '—'}</span>
            </button>
          ))}

          {/* Plans without a time, and the stay for the night. */}
          <div className="sticky left-0 z-20 flex items-start border-b border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-2 text-[10px] font-bold uppercase leading-tight tracking-wide text-[var(--ref-on-surface-variant)]">Any time</div>
          {days.map((day) => {
            const untimed = day.items.filter((item) => item.time === null);
            return (
              <div
                key={day.key}
                onDragOver={(event) => { if (dragged) event.preventDefault(); }}
                onDrop={(event) => { event.preventDefault(); dropOn(day.key, null); }}
                onClick={(event) => { if (event.target === event.currentTarget) setDialog({ day: day.key, time: null }); }}
                className={cn('min-h-[40px] space-y-1 border-b border-l border-[var(--color-border)] p-1.5', day.key === today && 'bg-[var(--ref-primary)]/5')}
              >
                {untimed.map((item) => {
                  if (item.type === 'plan') return <button key={`plan-${item.plan.id}`} type="button" {...dragProps(item.plan)} onClick={() => setDialog({ day: day.key, time: null, plan: item.plan })} className="block w-full truncate rounded-md bg-[var(--ref-primary)]/15 px-2 py-1 text-left text-xs font-medium text-[var(--ref-on-surface)] hover:bg-[var(--ref-primary)]/25">{item.plan.title}</button>;
                  const Icon = BOOKING_ICONS[item.booking.kind];
                  return <span key={`${item.role}-${item.booking.id}`} className="flex items-center gap-1 truncate rounded-md bg-[var(--ref-surface-container-high)] px-2 py-1 text-xs text-[var(--ref-on-surface)]"><Icon className="h-3 w-3 shrink-0" aria-hidden />{blockTitle(item)}</span>;
                })}
              </div>
            );
          })}

          {/* The hours. */}
          <div className="sticky left-0 z-20 bg-[var(--color-surface)]" style={{ height }}>
            {Array.from({ length: to - from }, (_, hour) => (
              <span key={hour} className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-[var(--ref-on-surface-variant)]" style={{ top: hour * HOUR }}>{hour === 0 ? '' : clockOf((from + hour) * 60)}</span>
            ))}
          </div>
          {days.map((day, at) => (
            <div
              key={day.key}
              role="presentation"
              onClick={(event) => { if (event.target === event.currentTarget) setDialog({ day: day.key, time: timeAt(event) }); }}
              onDragOver={(event) => { if (!dragged) return; event.preventDefault(); if (overDay !== day.key) setOverDay(day.key); }}
              onDrop={(event) => { event.preventDefault(); if (dragged) dropOn(day.key, timeAt(event)); }}
              className={cn('relative cursor-copy border-l border-[var(--color-border)]', day.key === today && 'bg-[var(--ref-primary)]/5', overDay === day.key && 'bg-[var(--ref-primary)]/10')}
              style={{ height, backgroundImage: `repeating-linear-gradient(to bottom, var(--color-border) 0, var(--color-border) 1px, transparent 1px, transparent ${HOUR}px)` }}
              title={`Click to add a plan on ${dayLabel(day.key)}`}
            >
              {calendarLanes(blocks[at]).map((block) => {
                const top = ((block.start - from * 60) / 60) * HOUR;
                const tall = Math.max(22, ((block.end - block.start) / 60) * HOUR - 2);
                const style = { top, height: tall, left: `calc(${(block.lane / block.lanes) * 100}% + 2px)`, width: `calc(${100 / block.lanes}% - 4px)` };
                const { item } = block;
                if (item.type === 'plan') {
                  return (
                    <button
                      key={block.id}
                      type="button"
                      {...dragProps(item.plan)}
                      onClick={() => setDialog({ day: day.key, time: item.plan.time, plan: item.plan })}
                      className={cn('absolute z-10 overflow-hidden rounded-md bg-[var(--ref-primary)]/20 px-1.5 py-0.5 text-left text-xs text-[var(--ref-on-surface)] ring-1 ring-inset ring-[var(--ref-primary)]/30 hover:bg-[var(--ref-primary)]/30', dragged?.id === item.plan.id && 'opacity-40')}
                      style={style}
                    >
                      <span className="block truncate font-semibold">{item.plan.title}</span>
                      {tall > 34 && <span className="block truncate text-[10px] text-[var(--ref-on-surface-variant)]">{item.time}{item.plan.place ? ` · ${item.plan.place}` : ''}</span>}
                    </button>
                  );
                }
                const Icon = BOOKING_ICONS[item.booking.kind];
                return (
                  <span key={block.id} className="pointer-events-none absolute z-10 overflow-hidden rounded-md bg-[var(--ref-surface-container-high)] px-1.5 py-0.5 text-xs text-[var(--ref-on-surface)] ring-1 ring-inset ring-[var(--color-border)]" style={style}>
                    <span className="flex items-center gap-1 truncate font-semibold"><Icon className="h-3 w-3 shrink-0" aria-hidden />{blockTitle(item)}</span>
                    {tall > 34 && <span className="block truncate text-[10px] text-[var(--ref-on-surface-variant)]">{item.time}</span>}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {dialog && (
        <Modal isOpen onClose={() => setDialog(null)} title={dialog.plan ? 'Change the plan' : `Add a plan · ${dayLabel(dialog.day)}`}>
          <PlanForm goalId={goalId} trip={trip} day={dialog.day} days={keys} plan={dialog.plan} initialTime={dialog.time} onDone={() => setDialog(null)} />
        </Modal>
      )}
    </>
  );
}
