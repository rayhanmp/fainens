import type { ReactNode } from 'react';
import { Check, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';

/** A field with a quiet label above and an optional hint below. */
export function Field({ label, hint, htmlFor, children }: { label: string; hint?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold text-[var(--ref-on-surface-variant)]">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-[var(--ref-on-surface-variant)]">{hint}</p>}
    </div>
  );
}

export const textInputClass = 'block min-h-11 w-full rounded-xl border border-[color-mix(in_srgb,var(--ref-on-surface)_16%,transparent)] bg-[var(--ref-surface-container-lowest)] px-3.5 py-2 text-sm text-[var(--ref-on-surface)] outline-none transition-shadow placeholder:text-[var(--ref-outline)] hover:border-[color-mix(in_srgb,var(--ref-on-surface)_28%,transparent)] focus:border-transparent focus:ring-2 focus:ring-[var(--ref-primary)]';

/**
 * Colour swatches with a check on the chosen one. Colours another item already uses can be shown
 * struck through and disabled; the last swatch opens the system picker for any other colour.
 */
export function ColorPicker({ colors, value, onChange, taken, onTaken, label }: {
  colors: readonly string[];
  value: string;
  onChange: (color: string) => void;
  taken?: ReadonlySet<string>;
  onTaken?: () => void;
  label: string;
}) {
  const current = value.toUpperCase();
  const custom = /^#[0-9A-F]{6}$/.test(current) && !colors.includes(current);
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
      {colors.map((color) => {
        const used = taken?.has(color) ?? false;
        const chosen = current === color;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={chosen}
            aria-label={`${color}${used ? ', already used' : ''}`}
            title={used ? 'Already used by another category' : color}
            disabled={used}
            onClick={() => onChange(color)}
            className={cn(
              'relative grid h-7 w-7 place-items-center rounded-full transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:scale-100',
              chosen && 'ring-2 ring-[var(--ref-on-surface)] ring-offset-2 ring-offset-[var(--ref-surface-container-lowest)]',
            )}
            style={{ backgroundColor: color }}
          >
            {chosen && <Check className="h-3.5 w-3.5 text-white drop-shadow" strokeWidth={3} />}
            {used && <span className="absolute h-[2px] w-8 rotate-45 rounded bg-[var(--ref-on-surface)]" aria-hidden />}
          </button>
        );
      })}
      <label
        className={cn(
          'relative grid h-7 w-7 cursor-pointer place-items-center rounded-full transition-transform hover:scale-110',
          custom && 'ring-2 ring-[var(--ref-on-surface)] ring-offset-2 ring-offset-[var(--ref-surface-container-lowest)]',
        )}
        style={{ background: custom ? current : 'conic-gradient(#ef4444, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef, #ef4444)' }}
        title="Any other colour"
      >
        {custom ? <Check className="h-3.5 w-3.5 text-white drop-shadow" strokeWidth={3} /> : <Plus className="h-3.5 w-3.5 text-white drop-shadow" strokeWidth={3} />}
        <input
          type="color"
          value={/^#[0-9A-F]{6}$/.test(current) ? current : '#000000'}
          aria-label="Choose any other colour"
          className="sr-only"
          onChange={(event) => {
            const color = event.target.value.toUpperCase();
            if (taken?.has(color)) onTaken?.();
            else onChange(color);
          }}
        />
      </label>
    </div>
  );
}
