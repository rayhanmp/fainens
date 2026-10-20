import { useEffect, useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * A small "i" beside a label that explains it. Opens on hover, focus or tap; Escape, a click
 * outside or moving away closes it. `align` keeps it on screen near a card's edge.
 */
export function InfoHint({ children, label = 'What is this?', align = 'left', side = 'top', inverse = false }: {
  children: React.ReactNode;
  label?: string;
  align?: 'left' | 'right' | 'center';
  /** Below the "i" near the top of a card that clips its edges. */
  side?: 'top' | 'bottom';
  /** On an accent card. */
  inverse?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const onPointer = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex align-middle normal-case tracking-normal" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen((value) => !value); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={cn(
          'grid h-5 w-5 place-items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2',
          inverse ? 'text-white/70 hover:bg-white/15 hover:text-white focus-visible:outline-white' : 'text-[var(--ref-outline)] hover:bg-[var(--ref-surface-container-high)] hover:text-[var(--ref-on-surface)] focus-visible:outline-[var(--ref-primary)]',
        )}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={cn(
            'absolute z-40 w-64 max-w-[calc(100vw-2.5rem)] rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3 text-left text-xs font-normal leading-relaxed text-[var(--ref-on-surface)] shadow-xl',
            side === 'top' ? 'bottom-[calc(100%+0.375rem)]' : 'top-[calc(100%+0.375rem)]',
            align === 'left' && 'left-0',
            align === 'right' && 'right-0',
            align === 'center' && 'left-1/2 -translate-x-1/2',
          )}
        >
          {children}
        </span>
      )}
    </span>
  );
}
