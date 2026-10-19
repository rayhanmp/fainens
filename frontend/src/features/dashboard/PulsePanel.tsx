import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, BellRing, CalendarClock, CalendarDays, Check, ChevronDown, CircleDollarSign, Clock, CreditCard,
  Flame, Gauge, HandCoins, Hourglass, Landmark, Percent, PieChart, Plus, ReceiptText, Repeat, RotateCcw,
  Scale, Settings2, Tag, TrendingUp, Users, X, type LucideIcon,
} from 'lucide-react';
import { cn, formatDecimal } from '../../lib/utils';
import { tooltipSurface } from './panel-styles';
import { Modal } from '../../components/ui/Modal';
import { usePhoneSheets } from '../../hooks/usePhoneSheets';
import {
  addPulseMetric, choosePulseMetric, defaultPulseMetrics, MAX_PULSE_METRICS, MIN_PULSE_METRICS, movePulseMetric,
  pulseMetricGroups, pulseMetricLabels, pulseMetricShortLabels, pulseMetricValue, removePulseMetric,
  type PulseInputs, type PulseMetricId,
} from './pulse-metrics';

const metricIcons: Record<PulseMetricId, LucideIcon> = {
  cashFlow: CircleDollarSign, savingsRate: Percent, burn: Flame, runway: CalendarClock,
  income: ArrowDownLeft, spending: ArrowUpRight, dailySpend: CalendarDays, safePace: Gauge,
  budgetUsed: PieChart, topCategory: Tag, upcoming: BellRing, netWorth: Landmark,
  debt: CreditCard, transactions: ReceiptText, daysLeft: Hourglass,
  spendVsLast: Scale, netWorthChange: TrendingUp, owedToYou: Users, reimbursementsDue: HandCoins,
  subscriptionsMonthly: Repeat, pendingReview: Clock,
};

/**
 * Columns follow the strip's own width (container queries), so it adapts to panel resizing:
 * two per row when narrow, everything in one row once there is room for it.
 */
const columnsByCount: Record<number, string> = {
  1: 'grid-cols-2',
  2: 'grid-cols-2',
  3: 'grid-cols-2 @xl:grid-cols-3',
  4: 'grid-cols-2 @3xl:grid-cols-4',
  5: 'grid-cols-2 @xl:grid-cols-3 @5xl:grid-cols-5',
  6: 'grid-cols-2 @xl:grid-cols-3 @6xl:grid-cols-6',
  7: 'grid-cols-2 @xl:grid-cols-4 @6xl:grid-cols-7',
};

/** Small pill that sits on the strip's top border. */
const pillClass = 'inline-flex h-6 items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-2 text-[11px] font-semibold shadow-sm transition-[background-color,color,border-color,opacity] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)]';

type Drag = { from: number; pointerId: number; startX: number; startY: number; dx: number; dy: number; over: number | null; moved: boolean };

/**
 * A compact strip of 2–6 key numbers. Each label swaps its metric in place. A separate edit toggle
 * turns on reordering (drag, or arrow keys on the handle), removing and adding tiles.
 */
export function PulsePanel({ metrics, onChangeMetrics, inputs, formatAmount }: {
  metrics: PulseMetricId[];
  onChangeMetrics: (next: PulseMetricId[]) => void;
  inputs: PulseInputs;
  formatAmount: (cents: number) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);
  const format = { amount: formatAmount, decimal: (value: number) => formatDecimal(value) };
  const preview = (id: PulseMetricId) => {
    const value = pulseMetricValue(id, inputs, format).value;
    // Some metrics fetch their data only once they are on the strip.
    return value === 'Loading…' && !metrics.includes(id) ? 'Loads when added' : value;
  };
  const canAdd = editing && metrics.length < MAX_PULSE_METRICS;
  const canRemove = metrics.length > MIN_PULSE_METRICS;
  const reset = () => onChangeMetrics([...defaultPulseMetrics]);
  const focusTile = (slot: number) => requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-pulse-slot="${slot}"]`)?.focus());
  const move = (from: number, to: number) => {
    if (to < 0 || to >= metrics.length || from === to) return;
    onChangeMetrics(movePulseMetric(metrics, from, to));
    setAnnouncement(`${pulseMetricLabels[metrics[from]!]} moved to position ${to + 1} of ${metrics.length}.`);
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>, slot: number) => {
    if (!editing || event.button !== 0) return;
    // Buttons inside the tile (metric picker, remove) keep their own behaviour; anywhere else starts a drag.
    if ((event.target as HTMLElement).closest('button, [role="listbox"]')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ from: slot, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, dx: 0, dy: 0, over: null, moved: false });
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const target = document.elementsFromPoint(event.clientX, event.clientY)
      .map((element) => element.closest<HTMLElement>('[data-pulse-slot]'))
      .find((element) => element && gridRef.current?.contains(element) && Number(element.dataset.pulseSlot) !== drag.from);
    const over = target ? Number(target.dataset.pulseSlot) : null;
    setDrag({ ...drag, dx, dy, over, moved: drag.moved || Math.hypot(dx, dy) > 4 });
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.moved && drag.over != null) move(drag.from, drag.over);
    setDrag(null);
  };

  const onTileKey = (event: KeyboardEvent<HTMLDivElement>, slot: number) => {
    if (!editing || event.target !== event.currentTarget) return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && canRemove) {
      event.preventDefault();
      remove(slot);
      focusTile(Math.max(0, slot - 1));
      return;
    }
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    const to = slot + step;
    if (to < 0 || to >= metrics.length) return;
    move(slot, to);
    focusTile(to);
  };
  const remove = (slot: number) => {
    onChangeMetrics(removePulseMetric(metrics, slot));
    setAnnouncement(`${pulseMetricLabels[metrics[slot]!]} removed.`);
  };

  // Escape leaves edit mode (an open picker handles Escape itself first).
  useEffect(() => {
    if (!editing) return undefined;
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) setEditing(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editing]);

  return (
    <section aria-label="Financial pulse" className="group/pulse @container relative rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-1.5 shadow-sm">
      {/* Edit mode keeps every tile exactly where and how big it will be; controls float on top instead of taking space. */}
      <div ref={gridRef} className={cn('grid gap-1', columnsByCount[metrics.length] ?? columnsByCount[4])}>
        {metrics.map((id, slot) => {
          const metric = pulseMetricValue(id, inputs, format);
          const Icon = metricIcons[id];
          const dragging = drag?.from === slot && drag.moved;
          const dropTarget = drag?.moved && drag.over === slot;
          const style: CSSProperties | undefined = dragging ? { transform: `translate(${drag.dx}px, ${drag.dy}px) scale(1.02)` } : undefined;
          return (
            <div
              key={id}
              data-pulse-slot={slot}
              style={style}
              tabIndex={editing ? 0 : undefined}
              aria-roledescription={editing ? 'movable tile' : undefined}
              aria-label={editing ? `${pulseMetricLabels[id]}, position ${slot + 1} of ${metrics.length}. Arrow keys move it${canRemove ? ', Delete removes it' : ''}.` : undefined}
              onKeyDown={(event) => onTileKey(event, slot)}
              onPointerDown={(event) => startDrag(event, slot)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={() => setDrag(null)}
              className={cn(
                'group/metric relative min-w-0 rounded-xl px-3.5 py-2.5 transition-[background-color,box-shadow,outline-color]',
                editing
                  ? 'cursor-grab touch-none select-none outline-1 outline-dashed -outline-offset-1 outline-[var(--color-border-strong)] hover:bg-[var(--ref-surface-container-low)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--ref-primary)]'
                  : '',
                dragging && 'relative z-20 cursor-grabbing bg-[var(--ref-surface-container-lowest)] shadow-xl outline-[var(--ref-primary)] transition-none',
                dropTarget && 'bg-[var(--ref-primary)]/8 outline-2 outline-solid outline-[var(--ref-primary)]',
              )}
            >
              <MetricPicker
                current={id}
                shown={metrics}
                align={slot % 2 === 1 ? 'right' : 'left'}
                preview={preview}
                ariaLabel={`${pulseMetricLabels[id]}. Change metric`}
                triggerClassName="-ml-1.5 flex max-w-full items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-xs text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-high)] hover:text-[var(--ref-on-surface)]"
                onChoose={(next) => onChangeMetrics(choosePulseMetric(metrics, slot, next))}
                onReset={reset}
                onEdit={editing ? undefined : () => setEditing(true)}
                trigger={(open) => <>
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate"><span className="sm:hidden">{pulseMetricShortLabels[id] ?? pulseMetricLabels[id]}</span><span className="hidden sm:inline">{pulseMetricLabels[id]}</span></span>
                  {/* Quiet until the tile is hovered, so the strip reads as numbers first. */}
                  <ChevronDown className={cn('h-3 w-3 shrink-0 opacity-40 transition-[opacity,transform] group-hover/metric:opacity-100', open && 'rotate-180 opacity-100')} aria-hidden />
                </>}
              />
              <p className="mt-0.5 flex min-w-0 items-baseline gap-1.5" tabIndex={editing ? -1 : 0} aria-describedby={`pulse-hint-${id}`}>
                <span className={cn('truncate text-base font-bold tabular-nums sm:text-lg', metric.tone === 'positive' && 'text-[var(--color-success)]', metric.tone === 'negative' && 'text-[var(--color-danger)]')}>{metric.value}</span>
                {metric.detail && <span className="truncate text-[11px] text-[var(--ref-on-surface-variant)]">{metric.detail}</span>}
              </p>
              {/* The explanation shows on hover or keyboard focus of the value, never while editing or picking. */}
              {!editing && <span id={`pulse-hint-${id}`} role="tooltip" className={cn(tooltipSurface, 'left-3 top-[calc(100%-0.25rem)] group-hover/metric:block group-has-[p:focus-visible]/metric:block group-has-[[aria-expanded=true]]/metric:hidden!')}>{metric.hint}</span>}
              {/* Remove badge sits on the tile's corner, outside its content, so values keep their full width. */}
              {editing && canRemove && !dragging && (
                <button
                  type="button"
                  onClick={() => remove(slot)}
                  aria-label={`Remove ${pulseMetricLabels[id]}`}
                  title="Remove"
                  className="absolute -left-1.5 -top-1.5 z-10 grid h-5 w-5 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] text-[var(--ref-on-surface-variant)] shadow-sm transition-colors hover:border-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)]"
                ><X className="h-3 w-3" strokeWidth={2.5} aria-hidden /></button>
              )}
            </div>
          );
        })}
      </div>
      {/*
        Controls ride on the strip's top border, so they never take space from the tiles.
        At rest the toggle appears only while the strip is hovered or focused; touch screens
        enter edit mode from a metric picker instead.
      */}
      <div className={cn(
        'absolute -right-2 -top-3 z-20 flex items-center gap-1 transition-opacity',
        !editing && 'opacity-0 has-[:focus-visible]:opacity-100 group-hover/pulse:opacity-100 [@media(hover:none)]:hidden',
      )}>
        {canAdd && (
          <MetricPicker
            current={null}
            shown={metrics}
            align="right"
            preview={preview}
            ariaLabel="Add a metric"
            triggerClassName={pillClass + ' text-[var(--ref-primary)] hover:border-[var(--ref-primary)]'}
            onChoose={(id) => { onChangeMetrics(addPulseMetric(metrics, id)); setAnnouncement(`${pulseMetricLabels[id]} added.`); }}
            onReset={reset}
            trigger={() => <><Plus className="h-3 w-3" strokeWidth={2.5} aria-hidden />Add metric</>}
          />
        )}
        <button
          type="button"
          aria-pressed={editing}
          onClick={() => { setEditing((value) => !value); setDrag(null); }}
          aria-label={editing ? 'Done editing metrics' : 'Edit metrics'}
          title={editing ? 'Done' : 'Add, remove or reorder metrics'}
          className={cn(
            pillClass,
            editing
              ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)] text-white'
              : 'w-6 justify-center px-0 text-[var(--ref-outline)] hover:text-[var(--ref-on-surface)]',
          )}
        >
          {editing ? <><Check className="h-3 w-3" strokeWidth={2.5} aria-hidden />Done</> : <Settings2 className="h-3 w-3" aria-hidden />}
        </button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{editing ? announcement || 'Editing metrics. Drag a tile, or focus it and use the arrow keys, to reorder.' : ''}</p>
    </section>
  );
}

/**
 * Grouped metric list with a live preview of each value. `current` null adds a new tile
 * (only metrics not yet shown are offered); otherwise it swaps the current one, and choosing a
 * metric shown elsewhere swaps the two tiles.
 */
function MetricPicker({ current, shown, align, preview, ariaLabel, className, triggerClassName, trigger, onChoose, onReset, onEdit }: {
  current: PulseMetricId | null;
  shown: readonly PulseMetricId[];
  align: 'left' | 'right';
  preview: (id: PulseMetricId) => string;
  ariaLabel: string;
  className?: string;
  triggerClassName: string;
  trigger: (open: boolean) => ReactNode;
  onChoose: (id: PulseMetricId) => void;
  onReset: () => void;
  /** Enters edit mode (add, remove, reorder); the way in on touch screens, where the hover toggle is unavailable. */
  onEdit?: () => void;
}) {
  const adding = current == null;
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const groups = pulseMetricGroups
    .map((group) => ({ ...group, ids: adding ? group.ids.filter((id) => !shown.includes(id)) : group.ids }))
    .filter((group) => group.ids.length > 0);
  const options = groups.flatMap((group) => group.ids);

  // Phones choose from a bottom sheet (which closes itself) instead of the anchored list.
  const asSheet = usePhoneSheets();
  useEffect(() => {
    if (!open || asSheet) return undefined;
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    listRef.current?.focus({ preventScroll: true });
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open, asSheet]);

  // Keep the highlighted option in view while moving with the keyboard.
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${highlight}`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight, listId, open]);

  const openMenu = () => { setHighlight(adding ? 0 : Math.max(0, options.indexOf(current))); setOpen(true); };
  const close = () => { setOpen(false); triggerRef.current?.focus(); };
  const choose = (id: PulseMetricId) => { onChoose(id); close(); };
  const surface = (list: ReactNode) => (asSheet
    ? <Modal isOpen onClose={close} title={adding ? 'Add a metric' : 'Change metric'} contentClassName="p-2">{list}</Modal>
    : list);

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); openMenu(); } }}
        className={cn('transition-[background-color,color,border-color] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)]', triggerClassName, open && !adding && 'bg-[var(--ref-surface-container-high)] text-[var(--ref-on-surface)]')}
      >
        {trigger(open)}
      </button>
      {open && surface(
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={adding ? 'Add a metric' : 'Change metric'}
          aria-activedescendant={options.length ? `${listId}-${highlight}` : undefined}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); close(); return; }
            if (event.key === 'Tab') { setOpen(false); return; }
            const last = options.length - 1;
            const next = event.key === 'ArrowDown' ? Math.min(last, highlight + 1) : event.key === 'ArrowUp' ? Math.max(0, highlight - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? last : null;
            if (next != null) { event.preventDefault(); setHighlight(next); return; }
            if ((event.key === 'Enter' || event.key === ' ') && options[highlight]) { event.preventDefault(); choose(options[highlight]); }
          }}
          className={cn(
            asSheet
              ? 'text-left outline-none [&_[role=option]]:min-h-12'
              : 'ui-popover absolute top-[calc(100%+0.4rem)] z-50 max-h-[min(26rem,70vh)] w-72 overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-1.5 text-left shadow-2xl outline-none',
            !asSheet && (align === 'right' ? 'right-0' : 'left-0'),
          )}
        >
          {adding && <p className="px-2.5 pb-0.5 pt-1.5 text-xs font-bold text-[var(--ref-on-surface)]">Add a metric</p>}
          {groups.map((group) => (
            <div key={group.label} role="group" aria-label={group.label} className="py-1">
              <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--ref-outline)]" aria-hidden>{group.label}</p>
              {group.ids.map((id) => {
                const index = options.indexOf(id);
                const Icon = metricIcons[id];
                const selected = !adding && id === current;
                const elsewhere = !adding && !selected && shown.includes(id);
                return (
                  <div
                    key={id}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={selected}
                    onPointerEnter={() => setHighlight(index)}
                    onClick={() => choose(id)}
                    className={cn('flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm', index === highlight && 'bg-[var(--ref-surface-container-low)]')}
                  >
                    <Icon className={cn('h-4 w-4 shrink-0', selected ? 'text-[var(--ref-primary)]' : 'text-[var(--ref-on-surface-variant)]')} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate font-semibold', selected && 'text-[var(--ref-primary)]')}>{pulseMetricLabels[id]}</span>
                      <span className="block truncate text-[11px] tabular-nums text-[var(--ref-on-surface-variant)]">{preview(id)}</span>
                    </span>
                    {selected
                      ? <Check className="h-4 w-4 shrink-0 text-[var(--ref-primary)]" aria-hidden />
                      : elsewhere
                        ? <span className="shrink-0 rounded-full bg-[var(--ref-surface-container-low)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ref-on-surface-variant)]" title="Choosing it swaps the two tiles">Swap</span>
                        : adding && <Plus className="h-4 w-4 shrink-0 text-[var(--ref-on-surface-variant)]" aria-hidden />}
                  </div>
                );
              })}
            </div>
          ))}
          {options.length === 0 && <p className="px-2.5 py-3 text-xs text-[var(--ref-on-surface-variant)]">Every metric is already shown.</p>}
          <div className="mt-1 space-y-0.5 border-t border-[var(--color-border)] px-1 pt-1.5">
            {onEdit && <button type="button" onClick={() => { setOpen(false); onEdit(); }} className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-xs font-semibold text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)] hover:text-[var(--ref-on-surface)]">
              <Settings2 className="h-3.5 w-3.5" aria-hidden />Add, remove or reorder
            </button>}
            <button type="button" onClick={() => { onReset(); close(); }} className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-xs font-semibold text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)] hover:text-[var(--ref-on-surface)]">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />Reset to default metrics
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
