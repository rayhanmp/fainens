import { useRef, useState } from 'react';
import { toast } from '../../../components/ui/useToast';
import { cn } from '../../../lib/utils';
import { BOOKING_ICONS } from './booking-icons';
import { PlanDialog } from './PlanForm';
import { useUpdatePlanMutation, type Trip } from './queries';
import { calendarLanes, clockOf, minutesOf, wallDay, wallTime, type DayItem, type TripPlan as Plan } from './trip-utils';

const HOUR = 48;
const SNAP = 15;
const ROLE: Record<string, string> = { leave: 'Leaves', arrive: 'Lands', 'check-in': 'Check in', 'check-out': 'Check out', on: '' };
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const snap = (minutes: number) => Math.round(minutes / SNAP) * SNAP;

type CalendarDay = { key: string; index: number; noon: number; items: DayItem[] };
type Block = { id: string; item: DayItem; start: number; end: number };

/** How long a thing takes up: a plan until its end (an hour without one), a flight until it lands that day, a check-in or out a moment. */
function blockOf(item: DayItem): Block | null {
  if (item.time === null) return null;
  const start = minutesOf(item.time);
  let end = start + 60;
  if (item.type === 'plan') {
    if (item.plan.endTime) end = Math.max(start + SNAP, minutesOf(item.plan.endTime));
  } else {
    const { booking } = item;
    if (item.role === 'check-in' || item.role === 'check-out') end = start + 45;
    else if (item.role !== 'arrive' && booking.endAt !== null && booking.startAt !== null && wallDay(booking.endAt) === wallDay(booking.startAt) && wallTime(booking.endAt)) end = Math.max(start + 30, minutesOf(wallTime(booking.endAt)!));
  }
  const id = item.type === 'plan' ? `plan-${item.plan.id}` : `${item.role}-${item.booking.id}`;
  return { id, item, start, end: Math.min(24 * 60, end) };
}

const blockTitle = (item: DayItem) => (item.type === 'plan' ? item.plan.title : `${ROLE[item.role] ? `${ROLE[item.role]}: ` : ''}${item.booking.title}`);
const span = (start: number, end: number) => `${clockOf(start)} – ${clockOf(end)}`;

/** What a press on the calendar is turning into: undecided until it moves, then blocking time, moving or resizing a plan, or scrolling. */
type Gesture =
  | { kind: 'press-empty'; x: number; y: number; day: number; minute: number; left: number; touch: boolean }
  | { kind: 'press-plan'; x: number; y: number; plan: Plan; offset: number; touch: boolean }
  | { kind: 'pan'; x: number; left: number }
  | { kind: 'create'; day: number; anchor: number }
  | { kind: 'move'; plan: Plan; offset: number; duration: number }
  | { kind: 'resize'; plan: Plan; day: number; start: number };

/** What the calendar shows while a press is under way. */
type Preview =
  | { kind: 'create'; day: number; start: number; end: number }
  | { kind: 'move'; planId: number; day: number; start: number | null; end: number }
  | { kind: 'resize'; planId: number; day: number; start: number; end: number };

/**
 * The trip as a calendar, worked like a calendar app: a column for each day with its city, hours
 * down the side, bookings and plans as blocks at their times and untimed plans along the top.
 * Press and drag down a free stretch to block out time for a plan; drag a plan to move it to
 * another day or time (or to Any time), or its bottom edge to make it longer or shorter; drag a
 * free stretch sideways to move along the days. A click adds or opens a plan. Times snap to a
 * quarter hour.
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
  const scroller = useRef<HTMLDivElement>(null);
  const columns = useRef<Array<HTMLDivElement | null>>([]);
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [panning, setPanning] = useState(false);
  const [dialog, setDialog] = useState<{ day: string; time: string | null; end?: string | null; plan?: Plan } | null>(null);
  const keys = days.map((day) => day.key);
  const blocks = days.map((day) => day.items.map(blockOf).filter((block): block is Block => block !== null));
  const from = Math.max(0, Math.min(7, ...blocks.flat().map((block) => Math.floor(block.start / 60))));
  const to = Math.min(24, Math.max(22, ...blocks.flat().map((block) => Math.ceil(block.end / 60))));
  const height = (to - from) * HOUR;
  const grid = `52px repeat(${days.length}, minmax(124px, 1fr))`;
  const plans = new Map(trip.plans.map((plan) => [plan.id, plan]));

  /** The day column and minute under a point; minute is null above the hours (the Any time row). */
  const slotAt = (x: number, y: number) => {
    const rects = columns.current.map((column) => column?.getBoundingClientRect());
    let day = rects.findIndex((rect) => rect && x >= rect.left && x < rect.right);
    if (day === -1) day = x < (rects[0]?.left ?? 0) ? 0 : rects.length - 1;
    const rect = rects[day];
    if (!rect) return null;
    if (y < rect.top) return { day, minute: null };
    const minute = from * 60 + ((y - rect.top) / HOUR) * 60;
    return { day, minute: Math.max(from * 60, Math.min(to * 60, minute)) };
  };

  const save = (plan: Plan, body: { day: string; time: string | null; endTime: string | null }) => {
    if (plan.day === body.day && plan.time === body.time && (plan.endTime ?? null) === body.endTime) return;
    update.mutate({ id: plan.id, ...body }, { onError: (error) => toast.error(errorText(error, 'Could not move the plan')) });
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    const touch = event.pointerType === 'touch';
    const resize = target.closest<HTMLElement>('[data-resize]');
    const planEl = target.closest<HTMLElement>('[data-plan]');
    const column = target.closest<HTMLElement>('[data-col]');
    if (resize && !touch) {
      const plan = plans.get(Number(resize.dataset.resize));
      const block = plan && blockOf({ type: 'plan', plan, time: plan.time });
      if (!plan || !block) return;
      gesture.current = { kind: 'resize', plan, day: keys.indexOf(plan.day), start: block.start };
    } else if (planEl) {
      const plan = plans.get(Number(planEl.dataset.plan));
      if (!plan) return;
      const slot = slotAt(event.clientX, event.clientY);
      const start = plan.time ? minutesOf(plan.time) : null;
      gesture.current = { kind: 'press-plan', x: event.clientX, y: event.clientY, plan, offset: start !== null && slot?.minute != null ? slot.minute - start : 0, touch };
    } else if (column) {
      const slot = slotAt(event.clientX, event.clientY);
      if (!slot || slot.minute === null) return;
      gesture.current = { kind: 'press-empty', x: event.clientX, y: event.clientY, day: slot.day, minute: slot.minute, left: scroller.current?.scrollLeft ?? 0, touch };
    } else {
      return;
    }
    if (!touch) event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current) return;
    if (current.kind === 'press-empty' || current.kind === 'press-plan') {
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (Math.hypot(dx, dy) < 5 || current.touch) return;
      if (current.kind === 'press-plan') {
        const block = blockOf({ type: 'plan', plan: current.plan, time: current.plan.time });
        gesture.current = { kind: 'move', plan: current.plan, offset: current.offset, duration: block ? block.end - block.start : 60 };
      } else if (Math.abs(dx) > Math.abs(dy)) {
        gesture.current = { kind: 'pan', x: current.x, left: current.left };
        setPanning(true);
      } else {
        gesture.current = { kind: 'create', day: current.day, anchor: snap(current.minute) };
      }
    }
    const active = gesture.current;
    if (!active) return;
    if (active.kind === 'pan') {
      if (scroller.current) scroller.current.scrollLeft = active.left - (event.clientX - active.x);
      return;
    }
    const slot = slotAt(event.clientX, event.clientY);
    if (!slot) return;
    if (active.kind === 'create') {
      const minute = snap(slot.minute ?? from * 60);
      const start = Math.min(active.anchor, minute);
      const end = Math.max(active.anchor, minute);
      setPreview({ kind: 'create', day: active.day, start, end: Math.max(end, start + SNAP) });
    } else if (active.kind === 'move') {
      if (slot.minute === null) return setPreview({ kind: 'move', planId: active.plan.id, day: slot.day, start: null, end: 0 });
      const start = Math.max(from * 60, Math.min(24 * 60 - active.duration, snap(slot.minute - active.offset)));
      setPreview({ kind: 'move', planId: active.plan.id, day: slot.day, start, end: start + active.duration });
    } else if (active.kind === 'resize') {
      const end = Math.max(active.start + SNAP, Math.min(24 * 60, snap(slot.minute ?? active.start)));
      setPreview({ kind: 'resize', planId: active.plan.id, day: active.day, start: active.start, end });
    }
  };

  const onPointerUp = () => {
    const current = gesture.current;
    const shown = preview;
    gesture.current = null;
    setPreview(null);
    setPanning(false);
    if (!current) return;
    if (current.kind === 'press-empty') {
      // A click: a plan at that half hour.
      const start = Math.floor(current.minute / 30) * 30;
      setDialog({ day: keys[current.day], time: clockOf(start), end: clockOf(Math.min(24 * 60 - 1, start + 60)) });
    } else if (current.kind === 'press-plan') {
      setDialog({ day: current.plan.day, time: current.plan.time, plan: current.plan });
    } else if (current.kind === 'create' && shown?.kind === 'create') {
      setDialog({ day: keys[shown.day], time: clockOf(shown.start), end: clockOf(Math.min(24 * 60 - 1, shown.end)) });
    } else if (current.kind === 'move' && shown?.kind === 'move') {
      save(current.plan, shown.start === null
        ? { day: keys[shown.day], time: null, endTime: null }
        : { day: keys[shown.day], time: clockOf(shown.start), endTime: current.plan.endTime ? clockOf(Math.min(24 * 60 - 1, shown.end)) : null });
    } else if (current.kind === 'resize' && shown?.kind === 'resize') {
      save(current.plan, { day: current.plan.day, time: current.plan.time, endTime: clockOf(Math.min(24 * 60 - 1, shown.end)) });
    }
  };

  const ghost = (start: number, end: number, label: string, solid = false) => (
    <span
      className={cn('pointer-events-none absolute inset-x-1 z-20 overflow-hidden rounded-md px-1.5 py-0.5 text-xs', solid ? 'bg-[var(--ref-primary)] text-[var(--color-surface)] shadow-lg' : 'border border-dashed border-[var(--ref-primary)] bg-[var(--ref-primary)]/15 font-semibold text-[var(--ref-primary)]')}
      style={{ top: ((start - from * 60) / 60) * HOUR + 1, height: Math.max(18, ((end - start) / 60) * HOUR - 2) }}
    >
      <span className="block truncate font-semibold">{label}</span>
      <span className="block truncate text-[10px] opacity-80">{span(start, end)}</span>
    </span>
  );

  return (
    <>
      <div
        ref={scroller}
        className={cn('select-none overflow-x-auto [scrollbar-color:var(--ref-outline)_transparent] [scrollbar-width:thin]', panning && 'cursor-grabbing', preview?.kind === 'resize' && 'cursor-ns-resize', preview?.kind === 'move' && 'cursor-grabbing')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { gesture.current = null; setPreview(null); setPanning(false); }}
      >
        <div className="grid" style={{ gridTemplateColumns: grid, minWidth: 52 + days.length * 124 }}>
          {/* Day headers, with the city; each opens that day. */}
          <div className="sticky left-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-surface)]" />
          {days.map((day, at) => (
            <button key={day.key} type="button" onClick={() => onOpenDay(day.key)} className={cn('border-b border-l border-[var(--color-border)] px-2 py-2 text-left hover:bg-[var(--ref-surface-container-low)]', day.key === today && 'bg-[var(--ref-primary)]/10')}>
              <span className={cn('block text-[11px] font-bold uppercase tracking-wide', day.key === today ? 'text-[var(--ref-primary)]' : 'text-[var(--ref-on-surface-variant)]')}>Day {day.index}{day.key === today ? ' · today' : ''}</span>
              <span className="block text-sm font-semibold text-[var(--ref-on-surface)]">{new Date(day.noon).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              <span className="block truncate text-xs text-[var(--ref-on-surface-variant)]">{cities[at] || '—'}</span>
            </button>
          ))}

          {/* Plans without a time; drop a plan here to take its time away. */}
          <div className="sticky left-0 z-30 flex items-start border-b border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-2 text-[10px] font-bold uppercase leading-tight tracking-wide text-[var(--ref-on-surface-variant)]">Any time</div>
          {days.map((day, at) => {
            const untimed = day.items.filter((item) => item.time === null);
            const dropping = preview?.kind === 'move' && preview.start === null && preview.day === at;
            return (
              <div
                key={day.key}
                onClick={(event) => { if (event.target === event.currentTarget) setDialog({ day: day.key, time: null }); }}
                className={cn('group min-h-[40px] cursor-pointer space-y-1 border-b border-l border-[var(--color-border)] p-1.5', day.key === today && 'bg-[var(--ref-primary)]/5', dropping && 'bg-[var(--ref-primary)]/15 ring-2 ring-inset ring-[var(--ref-primary)]')}
              >
                {untimed.map((item) => {
                  if (item.type === 'plan') {
                    const moving = preview?.kind === 'move' && preview.planId === item.plan.id;
                    return (
                      <button
                        key={`plan-${item.plan.id}`}
                        type="button"
                        data-plan={item.plan.id}
                        onClick={(event) => { if (event.detail === 0) setDialog({ day: day.key, time: null, plan: item.plan }); }}
                        className={cn('block w-full cursor-grab truncate rounded-md bg-[var(--ref-primary)]/15 px-2 py-1 text-left text-xs font-medium text-[var(--ref-on-surface)] hover:bg-[var(--ref-primary)]/25', moving && 'opacity-30')}
                      >
                        {item.plan.title}
                      </button>
                    );
                  }
                  const Icon = BOOKING_ICONS[item.booking.kind];
                  return <span key={`${item.role}-${item.booking.id}`} className="flex items-center gap-1 truncate rounded-md bg-[var(--ref-surface-container-high)] px-2 py-1 text-xs text-[var(--ref-on-surface)]"><Icon className="h-3 w-3 shrink-0" aria-hidden />{blockTitle(item)}</span>;
                })}
              </div>
            );
          })}

          {/* The hours. */}
          <div className="sticky left-0 z-30 bg-[var(--color-surface)]" style={{ height }}>
            {Array.from({ length: to - from }, (_, hour) => (
              <span key={hour} className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-[var(--ref-on-surface-variant)]" style={{ top: hour * HOUR }}>{hour === 0 ? '' : clockOf((from + hour) * 60)}</span>
            ))}
          </div>
          {days.map((day, at) => (
            <div
              key={day.key}
              ref={(node) => { columns.current[at] = node; }}
              data-col={at}
              className={cn('relative cursor-pointer border-l border-[var(--color-border)]', day.key === today && 'bg-[var(--ref-primary)]/5')}
              style={{ height, backgroundImage: `repeating-linear-gradient(to bottom, var(--color-border) 0, var(--color-border) 1px, transparent 1px, transparent ${HOUR / 2}px, color-mix(in srgb, var(--color-border) 45%, transparent) ${HOUR / 2}px, color-mix(in srgb, var(--color-border) 45%, transparent) ${HOUR / 2 + 1}px, transparent ${HOUR / 2 + 1}px, transparent ${HOUR}px)` }}
            >
              {calendarLanes(blocks[at]).map((block) => {
                const top = ((block.start - from * 60) / 60) * HOUR;
                const tall = Math.max(22, ((block.end - block.start) / 60) * HOUR - 2);
                const style = { top, height: tall, left: `calc(${(block.lane / block.lanes) * 100}% + 2px)`, width: `calc(${100 / block.lanes}% - 4px)` };
                const { item } = block;
                if (item.type === 'plan') {
                  const busy = preview && 'planId' in preview && preview.planId === item.plan.id;
                  return (
                    <button
                      key={block.id}
                      type="button"
                      data-plan={item.plan.id}
                      onClick={(event) => { if (event.detail === 0) setDialog({ day: day.key, time: item.plan.time, plan: item.plan }); }}
                      className={cn('group/plan absolute z-10 cursor-grab overflow-hidden rounded-md bg-[var(--ref-primary)]/20 px-1.5 py-0.5 text-left text-xs text-[var(--ref-on-surface)] ring-1 ring-inset ring-[var(--ref-primary)]/30 hover:bg-[var(--ref-primary)]/30', busy && 'opacity-30')}
                      style={style}
                    >
                      <span className="block truncate font-semibold">{item.plan.title}</span>
                      {tall > 34 && <span className="block truncate text-[10px] text-[var(--ref-on-surface-variant)]">{span(block.start, block.end)}{item.plan.place ? ` · ${item.plan.place}` : ''}</span>}
                      {/* Drag the bottom edge to make it longer or shorter. */}
                      <span data-resize={item.plan.id} className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize" aria-hidden>
                        <span className="mx-auto mt-0.5 block h-0.5 w-6 rounded-full bg-[var(--ref-primary)] opacity-0 group-hover/plan:opacity-70" />
                      </span>
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

              {/* What's being made, moved or stretched, and where a click would add a plan. */}
              {preview?.kind === 'create' && preview.day === at && ghost(preview.start, preview.end, 'New plan')}
              {preview?.kind === 'move' && preview.day === at && preview.start !== null && ghost(preview.start, preview.end, plans.get(preview.planId)?.title ?? '', true)}
              {preview?.kind === 'resize' && preview.day === at && ghost(preview.start, preview.end, plans.get(preview.planId)?.title ?? '', true)}
            </div>
          ))}
        </div>
      </div>

      {dialog && <PlanDialog goalId={goalId} trip={trip} day={dialog.day} days={keys} plan={dialog.plan} initialTime={dialog.time} initialEnd={dialog.end} onClose={() => setDialog(null)} />}
    </>
  );
}
