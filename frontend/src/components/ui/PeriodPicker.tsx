import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

export type PeriodPickerOption = {
  id: number;
  name: string;
  status?: string;
};

type PeriodPickerProps = {
  periods: readonly PeriodPickerOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  label?: string;
  allOption?: { value: string; label: string };
  getPeriodLabel?: (period: PeriodPickerOption) => string;
  className?: string;
};

/** "October 2026" → "Oct 2026"; anything that isn't a month and year is kept as it is. */
const shortLabel = (label: string) => label.replace(/^([A-Za-z]{3})[A-Za-z]+(\s+\d{4})$/, '$1$2');

export function PeriodPicker({
  periods,
  value,
  onChange,
  ariaLabel = 'Salary period',
  label,
  allOption,
  getPeriodLabel = (period) => period.name,
  className,
}: PeriodPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedIndex = periods.findIndex((period) => String(period.id) === value);
  const olderPeriod = selectedIndex >= 0 ? periods[selectedIndex + 1] : undefined;
  const newerPeriod = selectedIndex > 0 ? periods[selectedIndex - 1] : undefined;
  const selectedPeriod = selectedIndex >= 0 ? periods[selectedIndex] : undefined;
  const displayValue = selectedPeriod
    ? getPeriodLabel(selectedPeriod)
    : allOption?.value === value
      ? allOption.label
      : 'Select period';

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  const choose = (nextValue: string) => {
    onChange(nextValue);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className={cn('min-w-0', className)}>
      {label && <p className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">{label}</p>}
      <div className="flex w-fit max-w-full shrink-0 items-center rounded-full border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-1 shadow-sm">
        <button
          type="button"
          disabled={!olderPeriod}
          onClick={() => olderPeriod && choose(String(olderPeriod.id))}
          className="grid h-9 w-8 shrink-0 place-items-center rounded-full text-[var(--ref-on-surface-variant)] transition-colors hover:bg-[var(--ref-surface-container-low)] disabled:cursor-not-allowed disabled:opacity-30 sm:w-9"
          aria-label="Previous period"
          title={olderPeriod ? `Previous: ${olderPeriod.name}` : 'No previous period'}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {/* The label gives way (and truncates) before the arrows do, so in a narrow column the pill
            keeps both arrows inside its border. */}
        <div ref={rootRef} className="relative w-[min(145px,calc(100vw-7rem))] min-w-0 shrink">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setIsOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setIsOpen(false);
                triggerRef.current?.focus();
              }
            }}
            className={cn(
              'relative flex h-9 w-full items-center justify-center rounded-lg px-1 text-center text-xs font-bold min-[400px]:pr-5 sm:pl-2 sm:pr-6 text-[var(--ref-on-surface)] transition-colors hover:bg-[var(--ref-surface-container-low)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)]',
              isOpen && 'bg-[var(--ref-surface-container-low)] text-[var(--ref-primary)]',
            )}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-label={ariaLabel}
          >
            {/* Phones get the short month ("Oct 2026") so the label fits between the arrows. */}
            <span className="min-w-0 truncate text-center sm:hidden">{shortLabel(displayValue)}</span>
            <span className="hidden min-w-0 truncate text-center sm:inline">{displayValue}</span>
            {/* On the narrowest phones the label alone opens the list; the chevron gives its room back. */}
            <ChevronDown className={cn('absolute right-1 hidden h-4 w-4 transition-transform min-[400px]:block sm:right-1.5', isOpen && 'rotate-180')} />
          </button>
          {isOpen && (
            <div role="listbox" aria-label={`${ariaLabel} options`} className="period-picker-scroll absolute left-0 top-[calc(100%+0.55rem)] z-50 max-h-60 w-full overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-1.5 shadow-2xl">
              {allOption && (
                <button type="button" role="option" aria-selected={value === allOption.value} onClick={() => choose(allOption.value)} className={cn('w-full rounded-xl px-3 py-2 text-left text-xs font-semibold transition-colors', value === allOption.value ? 'bg-[var(--ref-primary)] text-white shadow-sm' : 'text-[var(--ref-on-surface)] hover:bg-[var(--ref-surface-container-low)]')}>
                  {allOption.label}
                </button>
              )}
              {periods.map((period) => {
                const periodValue = String(period.id);
                const selected = periodValue === value;
                return (
                  <button key={period.id} type="button" role="option" aria-selected={selected} onClick={() => choose(periodValue)} className={cn('w-full rounded-xl px-3 py-2 text-left text-xs font-semibold transition-colors', selected ? 'bg-[var(--ref-primary)] text-white shadow-sm' : 'text-[var(--ref-on-surface)] hover:bg-[var(--ref-surface-container-low)]')}>
                    {getPeriodLabel(period)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={!newerPeriod}
          onClick={() => newerPeriod && choose(String(newerPeriod.id))}
          className="grid h-9 w-8 shrink-0 place-items-center rounded-full text-[var(--ref-on-surface-variant)] transition-colors hover:bg-[var(--ref-surface-container-low)] disabled:cursor-not-allowed disabled:opacity-30 sm:w-9"
          aria-label="Next period"
          title={newerPeriod ? `Next: ${newerPeriod.name}` : 'No next period'}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
