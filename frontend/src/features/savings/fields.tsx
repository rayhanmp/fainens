import { useState } from 'react';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { HIDDEN_BALANCE } from '../../lib/balance-visibility';
import { cn, formatDecimal, formatIdNominalInput } from '../../lib/utils';
import { parseMoneyText } from './input-format';
import { InfoHint } from './InfoHint';

/** The simulator's small fields: 34px like Settings (inside `.settings-compact`), labels above. */

export function Field({ label, htmlFor, hint, info, children, className }: { label: string; htmlFor?: string; hint?: React.ReactNode; info?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center gap-1">
        <label htmlFor={htmlFor} className="block text-sm font-medium text-[var(--color-text-secondary)]">{label}</label>
        {info && <InfoHint label={`About ${label.toLowerCase()}`}>{info}</InfoHint>}
      </div>
      {children}
      {hint && <p className="text-xs text-[var(--ref-on-surface-variant)]">{hint}</p>}
    </div>
  );
}

/** A rupiah amount. Accepts shortcuts like 5jt or 500rb, grouped as you type. */
export function MoneyField({ id, value, onChange, ariaLabel, allowNegative = false, autoFocus, placeholder = '0' }: {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  ariaLabel?: string;
  allowNegative?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const { balancesHidden } = useBalanceVisibility();
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (balancesHidden ? HIDDEN_BALANCE : value ? formatIdNominalInput(String(Math.abs(value))) : '');
  const commit = (raw: string) => {
    const parsed = parseMoneyText(raw.replace(/^-/, ''));
    if (parsed !== null) onChange(allowNegative && value < 0 ? -parsed : parsed);
  };
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-muted)]" aria-hidden>Rp</span>
      <input
        id={id}
        aria-label={ariaLabel}
        className="brutalist-input brutalist-input--currency !pl-9"
        inputMode="text"
        autoComplete="off"
        autoFocus={autoFocus}
        value={shown}
        placeholder={placeholder}
        onFocus={() => setText(value ? formatIdNominalInput(String(Math.abs(value))) : '')}
        onChange={(event) => {
          const raw = event.target.value;
          // Plain digits group and apply as you type; shortcuts apply when you leave the field.
          if (/^[\d.]*$/.test(raw)) {
            const grouped = formatIdNominalInput(raw);
            setText(grouped);
            commit(grouped);
          } else {
            setText(raw);
          }
        }}
        onBlur={() => {
          if (text !== null) commit(text);
          setText(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </div>
  );
}

/** A percentage with one decimal, comma or dot. */
export function PercentField({ id, value, onChange, min, max, ariaLabel, suffix = '%' }: {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  ariaLabel?: string;
  suffix?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? formatDecimal(value, 2);
  return (
    <div className="relative">
      <input
        id={id}
        aria-label={ariaLabel}
        className="brutalist-input brutalist-input--currency"
        style={{ paddingRight: `${1.25 + suffix.length * 0.5}rem` }}
        inputMode="decimal"
        autoComplete="off"
        value={shown}
        onFocus={() => setText(formatDecimal(value, 2))}
        onChange={(event) => {
          const raw = event.target.value.replace(/[^\d.,-]/g, '');
          setText(raw);
          const parsed = Number(raw.replace(',', '.'));
          if (raw !== '' && raw !== '-' && Number.isFinite(parsed)) onChange(Math.min(max, Math.max(min, parsed)));
        }}
        onBlur={() => setText(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-muted)]" aria-hidden>{suffix}</span>
    </div>
  );
}

/** A thin slider whose filled part shows where the value sits. */
export function Slider({ value, min, max, step, onChange, ariaLabel, valueText }: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  ariaLabel: string;
  valueText?: string;
}) {
  const fill = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  return (
    <input
      type="range"
      className="plan-slider"
      aria-label={ariaLabel}
      aria-valuetext={valueText}
      min={min}
      max={max}
      step={step}
      value={Math.min(max, Math.max(min, value))}
      onChange={(event) => onChange(Number(event.target.value))}
      style={{ '--fill': `${fill}%` } as React.CSSProperties}
    />
  );
}

/** The app's sliding segmented control, any number of options up to five. */
export function Segmented<T extends string>({ value, options, onChange, ariaLabel, className, inverse = false }: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  /** On an accent card: a translucent track with a white thumb. */
  inverse?: boolean;
}) {
  const index = options.findIndex((option) => option.value === value);
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('ui-segmented grid h-[34px] gap-1 rounded-lg p-1', inverse ? 'ui-segmented--inverse bg-white/15' : 'bg-[var(--ref-surface-container)]', `ui-segmented--${options.length}`, className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      data-segment-index={index}
    >
      {options.map((option, position) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
            if (!step) return;
            event.preventDefault();
            const next = (position + step + options.length) % options.length;
            onChange(options[next]!.value);
            (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
          }}
          className={cn(
            'flex items-center justify-center truncate rounded-md px-2 text-xs font-semibold',
            inverse
              ? value === option.value ? 'text-[#0b2a5c]' : 'text-white/80 hover:text-white'
              : value === option.value ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
