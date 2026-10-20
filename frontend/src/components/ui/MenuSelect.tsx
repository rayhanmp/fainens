import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { usePhoneSheets } from '../../hooks/usePhoneSheets';
import { ActionSheet } from './ActionSheet';

export type MenuSelectOption<T extends string> = { value: T; label: string };

/**
 * A compact styled replacement for a native `<select>`: a pill trigger and an anchored listbox
 * with arrow-key, Home/End, Enter and Escape support.
 */
export function MenuSelect<T extends string>({ value, options, onChange, ariaLabel, icon, align = 'left', className, compactOnMobile = false, variant = 'pill', disabled = false, id }: {
  value: T;
  options: readonly MenuSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  icon?: ReactNode;
  align?: 'left' | 'right';
  className?: string;
  /** Below `sm`, show only the icon in a round button, so it can share a row with other controls. */
  compactOnMobile?: boolean;
  /** `field` draws a bordered, full-width trigger that sits in a form beside text fields. */
  variant?: 'pill' | 'field';
  disabled?: boolean;
  /** Id for the trigger, so a visible `<label htmlFor>` can name it. */
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];
  // Phones pick from a bottom sheet instead of a small anchored list.
  const asSheet = usePhoneSheets();

  useEffect(() => {
    if (!open || asSheet) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    listRef.current?.focus({ preventScroll: true });
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open, asSheet]);

  const openMenu = () => {
    setHighlight(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  };
  const choose = (next: T) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${ariaLabel}: ${selected?.label ?? ''}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openMenu(); }
        }}
        className={cn(
          variant === 'field'
            ? 'flex h-[34px] w-full items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-left text-sm text-[var(--ref-on-surface)] transition-colors hover:border-[var(--color-border-strong)] focus-visible:border-[var(--ref-primary-container)] focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ref-primary-container)_22%,transparent)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[var(--color-border)]'
            : 'inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--ref-on-surface)] transition-colors hover:bg-[var(--ref-surface-container-low)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)]',
          compactOnMobile && 'max-sm:h-9 max-sm:w-9 max-sm:justify-center max-sm:bg-[var(--ref-surface-container-low)] max-sm:px-0',
          open && (variant === 'field' ? 'border-[var(--ref-primary-container)]' : 'bg-[var(--ref-surface-container-low)]'),
        )}
      >
        {icon}
        <span className={cn(compactOnMobile && 'max-sm:hidden', variant === 'field' && 'min-w-0 flex-1 truncate')}>{selected?.label}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-[var(--ref-on-surface-variant)] transition-transform', open && 'rotate-180', compactOnMobile && 'max-sm:hidden')} aria-hidden />
      </button>
      {asSheet && (
        <ActionSheet
          isOpen={open}
          onClose={() => setOpen(false)}
          title={ariaLabel}
          actions={options.map((option) => ({ key: option.value, label: option.label, selected: option.value === value, onSelect: () => onChange(option.value) }))}
        />
      )}
      {open && !asSheet && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel}
          aria-activedescendant={`${listId}-${highlight}`}
          onKeyDown={(event) => {
            // Escape closes only this menu, not a dialog the menu sits in.
            if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); } setOpen(false); triggerRef.current?.focus(); return; }
            const last = options.length - 1;
            const next = event.key === 'ArrowDown' ? Math.min(last, highlight + 1) : event.key === 'ArrowUp' ? Math.max(0, highlight - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? last : null;
            if (next != null) { event.preventDefault(); setHighlight(next); return; }
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); const option = options[highlight]; if (option) choose(option.value); }
          }}
          className={cn(
            'ui-popover absolute top-[calc(100%+0.4rem)] z-30 min-w-44 rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-1.5 shadow-xl outline-none',
            align === 'right' ? 'right-0' : 'left-0',
            variant === 'field' && 'max-h-72 min-w-full overflow-y-auto',
          )}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <div
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={isSelected}
                onPointerEnter={() => setHighlight(index)}
                onClick={() => choose(option.value)}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm font-semibold',
                  index === highlight ? 'bg-[var(--ref-surface-container-low)]' : '',
                  isSelected ? 'text-[var(--ref-primary)]' : 'text-[var(--ref-on-surface)]',
                )}
              >
                {option.label}
                {isSelected && <Check className="h-4 w-4" aria-hidden />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
