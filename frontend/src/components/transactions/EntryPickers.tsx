import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Check, ChevronDown, Plus, Search, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { entryTypes, type EntryType } from './entry-types';

/*
 * Form controls for the Add transaction dialog: a compact type switch, labelled fields with one
 * shared look, and a searchable dropdown that renders through a portal so the scrolling dialog
 * never clips it.
 */

export const fieldLabel = 'mb-1.5 flex items-center justify-between text-[13px] font-medium text-[var(--ref-on-surface-variant)]';
export const fieldControl = 'h-10 w-full rounded-lg border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-3 text-sm text-[var(--ref-on-surface)] outline-none transition-colors placeholder:text-[var(--ref-outline)] hover:border-[var(--color-border-strong)] focus:border-[var(--ref-primary)] focus:ring-2 focus:ring-[var(--ref-primary)]/20';

/** A compact segmented control, centred in the form. */
export function EntryTypeSwitch({ value, onChange }: { value: EntryType; onChange: (next: EntryType) => void }) {
  return (
    <div className="flex justify-center">
      <div
        role="radiogroup"
        aria-label="Entry type"
        // Equal auto-sized columns, so the control hugs its labels instead of stretching across the dialog.
        className="ui-segmented ui-segmented--4 inline-grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-[var(--ref-surface-container)] p-1"
        data-segment-index={entryTypes.findIndex((entry) => entry.value === value)}
      >
        {entryTypes.map(({ value: type, label, short, icon: Icon }) => (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={value === type}
            onClick={() => onChange(type)}
            onKeyDown={(event) => {
              const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              if (!step) return;
              event.preventDefault();
              const index = (entryTypes.findIndex((entry) => entry.value === value) + step + entryTypes.length) % entryTypes.length;
              onChange(entryTypes[index]!.value);
            }}
            tabIndex={value === type ? 0 : -1}
            className={cn(
              'relative z-[1] flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition-colors sm:min-w-[7.5rem]',
              value === type ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
            )}
          >
            <Icon className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden />
            <span className="sm:hidden">{short}</span>
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A labelled field. A small icon before the label tells fields apart at a glance; `hint` sits at the right end of the label line. */
export function Field({ label, icon: Icon, htmlFor, hint, className, children }: { label: ReactNode; icon?: LucideIcon; htmlFor?: string; hint?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className={fieldLabel}>
        <span className="flex items-center gap-1.5">{Icon && <Icon className="h-3.5 w-3.5 text-[var(--ref-outline)]" aria-hidden />}{label}</span>
        {hint}
      </label>
      {children}
    </div>
  );
}

export type PickerOption = {
  id: string;
  label: string;
  /** Secondary text, e.g. a balance. */
  detail?: string;
  /** Small leading visual: an emoji, an icon, or a colour dot. */
  leading?: ReactNode;
  group?: string;
  disabled?: boolean;
  disabledReason?: string;
};

type Placement = { style: CSSProperties; sheet: boolean };

/**
 * A searchable dropdown. The list renders in a portal positioned under the trigger (above it when
 * there is no room), and as a bottom sheet on phones. Arrow keys move, Enter picks, Escape closes
 * without closing the dialog behind it.
 */
export function ComboBox({ id, value, selectedIds, options, onChange, placeholder, searchPlaceholder, emptyHint, disabled, triggerContent, triggerClassName, onCreate }: {
  id?: string;
  value: string;
  /** Multi-select: the chosen ids. Choosing toggles one and keeps the list open. */
  selectedIds?: string[];
  options: PickerOption[];
  onChange: (id: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyHint?: ReactNode;
  disabled?: boolean;
  /** A custom trigger (e.g. an "All tags" link) in place of the field-styled one. */
  triggerContent?: ReactNode;
  triggerClassName?: string;
  /** Offers an "Add “…”" row when the search matches no option exactly. */
  onCreate?: (label: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const multiple = selectedIds != null;
  const isChosen = (option: PickerOption) => (multiple ? selectedIds.includes(option.id) : option.id === value);
  const selected = options.find((option) => option.id === value) ?? null;
  const chosenLabels = multiple ? options.filter(isChosen).map((option) => option.label) : [];
  const trimmedQuery = query.trim();
  const filtered = options.filter((option) => option.label.toLowerCase().includes(trimmedQuery.toLowerCase()));
  const groups = [...new Set(filtered.map((option) => option.group ?? ''))];
  const canCreate = !!onCreate && trimmedQuery !== '' && !options.some((option) => option.label.toLowerCase() === trimmedQuery.toLowerCase());
  const createIndex = filtered.length;
  const lastIndex = filtered.length - 1 + (canCreate ? 1 : 0);
  const create = async () => {
    if (!canCreate || !onCreate) return;
    await onCreate(trimmedQuery);
    setQuery('');
    setHighlight(0);
  };

  const close = (refocus = true) => {
    setOpen(false);
    setQuery('');
    if (refocus) triggerRef.current?.focus();
  };
  const choose = (next: string) => { onChange(next); if (!multiple) close(); };

  // Place the list relative to the trigger; recompute while open if the window changes.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      if (window.matchMedia('(max-width: 639px)').matches) {
        // A bottom sheet that stays above the soft keyboard: the visual viewport shrinks when it opens.
        const viewport = window.visualViewport;
        const keyboard = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
        const visibleHeight = viewport?.height ?? window.innerHeight;
        setPlacement({ sheet: true, style: { position: 'fixed', left: 8, right: 8, bottom: keyboard + 8, maxHeight: Math.round(visibleHeight * 0.72) } });
        return;
      }
      const width = Math.max(rect.width, 288);
      const left = Math.min(rect.left, window.innerWidth - width - 8);
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const wanted = 360;
      const above = spaceBelow < Math.min(wanted, 240) && spaceAbove > spaceBelow;
      setPlacement({
        sheet: false,
        style: above
          ? { position: 'fixed', left, width, bottom: window.innerHeight - rect.top + 6, maxHeight: Math.min(wanted, spaceAbove) }
          : { position: 'fixed', left, width, top: rect.bottom + 6, maxHeight: Math.min(wanted, spaceBelow) },
      });
    };
    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    // Not for the sheet's backdrop: it closes on click, after the press has been swallowed.
    // The dialog body scrolling under the list would leave it floating; close instead.
    const onScroll = (event: Event) => {
      if (popoverRef.current?.contains(event.target as Node)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${highlight}`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight, listId, open]);

  const openList = () => {
    if (disabled) return;
    setHighlight(Math.max(0, filtered.findIndex(isChosen)));
    setOpen(true);
  };

  const item = (option: PickerOption) => {
    const index = filtered.indexOf(option);
    const isSelected = isChosen(option);
    return (
      <button
        key={option.id}
        type="button"
        role="option"
        id={`${listId}-${index}`}
        aria-selected={isSelected}
        disabled={option.disabled}
        title={option.disabled ? option.disabledReason : undefined}
        onPointerEnter={() => setHighlight(index)}
        onClick={() => choose(option.id)}
        className={cn(
          // Taller rows on touch screens, so each option is an easy tap.
          'flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-9',
          index === highlight && 'bg-[var(--ref-surface-container-low)]',
          isSelected && 'text-[var(--ref-primary)]',
        )}
      >
        {option.leading && <span className="shrink-0" aria-hidden>{option.leading}</span>}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{option.label}</span>
          {(option.detail || option.disabledReason) && <span className="block truncate text-xs tabular-nums text-[var(--ref-on-surface-variant)]">{option.disabled ? option.disabledReason : option.detail}</span>}
        </span>
        {isSelected && <Check className="h-4 w-4 shrink-0" aria-hidden />}
      </button>
    );
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openList(); } }}
        className={triggerContent
          ? triggerClassName
          : cn(fieldControl, 'flex items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50', open && 'border-[var(--ref-primary)] ring-2 ring-[var(--ref-primary)]/20')}
      >
        {triggerContent ?? <>
          {selected?.leading && <span className="shrink-0" aria-hidden>{selected.leading}</span>}
          <span className={cn('min-w-0 flex-1 truncate', !selected && chosenLabels.length === 0 && 'text-[var(--ref-outline)]')}>
            {multiple
              ? (chosenLabels.length > 0 ? chosenLabels.join(', ') : placeholder)
              : selected ? <>{selected.label}{selected.detail && <span className="text-[var(--ref-on-surface-variant)]"> · {selected.detail}</span>}</> : placeholder}
          </span>
        </>}
        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', !triggerContent && 'text-[var(--ref-outline)]', open && 'rotate-180')} aria-hidden />
      </button>
      {open && placement && createPortal(
        <>
        {/* On phones a dimmed backdrop takes stray taps, so they never land on fields under the sheet. */}
        {placement.sheet && <div className="fixed inset-0 z-[119] bg-[#101c36]/40" aria-hidden onPointerDown={(event) => event.stopPropagation()} onClick={() => close(false)} />}
        <div
          ref={popoverRef}
          style={placement.style}
          className={cn('ui-popover z-[120] flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] shadow-2xl', placement.sheet && 'rounded-2xl')}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
            if (event.key === 'Tab') { close(false); return; }
            const next = event.key === 'ArrowDown' ? Math.min(lastIndex, highlight + 1) : event.key === 'ArrowUp' ? Math.max(0, highlight - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? lastIndex : null;
            if (next != null) { event.preventDefault(); setHighlight(next); return; }
            if (event.key === 'Enter') {
              event.preventDefault();
              if (canCreate && (highlight === createIndex || filtered.length === 0)) { void create(); return; }
              const option = filtered[highlight] ?? filtered.find((candidate) => !candidate.disabled);
              if (option && !option.disabled) choose(option.id);
            }
          }}
        >
          <div className="p-2 pb-0">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ref-outline)]" aria-hidden />
              <input
                // On touch screens the keyboard waits until the search box is tapped, keeping the list in view.
                autoFocus={!placement.sheet}
                value={query}
                onChange={(event) => { setQuery(event.target.value); setHighlight(0); }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                aria-controls={listId}
                aria-activedescendant={filtered[highlight] ? `${listId}-${highlight}` : undefined}
                className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] pl-8 pr-3 text-sm outline-none focus:border-[var(--ref-primary)]"
              />
            </label>
          </div>
          <div id={listId} role="listbox" aria-multiselectable={multiple || undefined} aria-label={searchPlaceholder} className="min-h-0 flex-1 overflow-y-auto p-2">
            {options.length === 0 && !canCreate && <p className="px-2 py-4 text-sm text-[var(--ref-on-surface-variant)]">{emptyHint}</p>}
            {options.length > 0 && filtered.length === 0 && !canCreate && <p className="px-2 py-4 text-center text-sm text-[var(--ref-on-surface-variant)]">No match for “{query}”.</p>}
            {groups.map((group) => (
              <div key={group || 'all'} role="group" aria-label={group || undefined}>
                {group && <p className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--ref-outline)]">{group}</p>}
                {filtered.filter((option) => (option.group ?? '') === group).map(item)}
              </div>
            ))}
            {canCreate && (
              <button
                type="button"
                role="option"
                id={`${listId}-${createIndex}`}
                aria-selected={false}
                onPointerEnter={() => setHighlight(createIndex)}
                onClick={() => void create()}
                className={cn('flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm font-semibold text-[var(--ref-primary)] transition-colors sm:min-h-9', highlight === createIndex && 'bg-[var(--ref-surface-container-low)]')}
              >
                <Plus className="h-4 w-4 shrink-0" aria-hidden />
                Add “{trimmedQuery}”
              </button>
            )}
          </div>
        </div>
        </>,
        document.body,
      )}
    </>
  );
}

/**
 * The date is the real choice, so it gets the field and the Today/Yesterday shortcuts; the time
 * only orders entries within a day, so it sits beside it as a small secondary control.
 * `value` stays a single `YYYY-MM-DDTHH:mm` string.
 */
export function DateTimeField({ id, value, onChange, className }: { id?: string; value: string; onChange: (next: string) => void; className?: string }) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const localDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const localTime = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const dayOf = (offset: number) => { const date = new Date(); date.setDate(date.getDate() + offset); return localDay(date); };
  const today = dayOf(0);
  const yesterday = dayOf(-1);
  const day = value.slice(0, 10);
  const time = value.slice(11, 16) || localTime(new Date());
  const quick = (label: string, target: string) => (
    <button
      type="button"
      aria-pressed={day === target}
      onClick={() => onChange(`${target}T${time}`)}
      className={cn('rounded px-1.5 py-0.5 text-xs font-semibold transition-colors', day === target ? 'bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]' : 'text-[var(--ref-on-surface-variant)] hover:text-[var(--ref-primary)]')}
    >
      {label}
    </button>
  );
  return (
    <Field label="Date" icon={CalendarDays} htmlFor={id} className={className} hint={<span className="flex gap-0.5">{quick('Today', today)}{quick('Yesterday', yesterday)}</span>}>
      <div className="flex gap-2">
        <input id={id} type="date" value={day} max={today} onChange={(event) => { if (event.target.value) onChange(`${event.target.value}T${time}`); }} required className={cn(fieldControl, 'min-w-0 flex-1')} />
        <input type="time" value={time} onChange={(event) => { if (event.target.value) onChange(`${day}T${event.target.value}`); }} aria-label="Time" title="Time" className={cn(fieldControl, 'w-[6.5rem] shrink-0 text-[var(--ref-on-surface-variant)]')} />
      </div>
    </Field>
  );
}
