import { useId } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { MenuSelect, type MenuSelectOption } from '../../components/ui/MenuSelect';
import { ACCENT_COLORS, cn, type AccentColorPreference } from '../../lib/utils';

/**
 * The Settings page's own controls, shared so other places (the help docs) can show exactly what
 * Settings shows.
 */

export type ThemeChoice = 'auto' | 'light' | 'dark';

interface SettingsRowProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Keep a small control (a toggle, a short button) beside the label on phones too. */
  inline?: boolean;
  /** A control that needs more than the standard field width (the theme switch) sizes itself. */
  wideControl?: boolean;
}

export function SettingsRow({ label, description, action, inline = false, wideControl = false }: SettingsRowProps) {
  return (
    <div data-setting className={cn('flex gap-3 border-b border-[var(--color-border)] py-3 first:pt-0 last:border-b-0 last:pb-0', inline ? 'items-center justify-between gap-4' : 'flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-6')}>
      <div className="min-w-0">
        <p data-setting-label className="text-sm font-medium text-[var(--ref-on-surface)]">{label}</p>
        {description && <p className="mt-0.5 max-w-md text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">{description}</p>}
      </div>
      {/* One width for every field beside a label. `.brutalist-input` fills its parent, so fields are sized here. */}
      {action && <div className={cn('shrink-0', !inline && (wideControl ? 'w-full sm:w-auto' : 'w-full sm:w-48'))}>{action}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-[var(--ref-primary)]' : 'bg-[var(--ref-surface-container-highest)] ring-1 ring-inset ring-[var(--color-border)]',
      )}
    >
      <span className={cn('inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} aria-hidden />
    </button>
  );
}

/**
 * The app's own dropdown (a bottom sheet on phones) in its field style. `label` shows above it,
 * as on a text field; without one, `ariaLabel` names it for rows that already have a label.
 */
export function Dropdown<T extends string>({ label, ariaLabel, value, options, onChange, disabled }: { label?: string; ariaLabel?: string; value: T; options: readonly MenuSelectOption<T>[]; onChange: (value: T) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="space-y-1 text-left">
      {label && <label htmlFor={id} className="block text-sm font-medium text-[var(--color-text-secondary)]">{label}</label>}
      <MenuSelect id={id} variant="field" ariaLabel={label ?? ariaLabel ?? ''} value={value} options={options} onChange={onChange} disabled={disabled} />
    </div>
  );
}

const THEMES: Array<{ value: ThemeChoice; label: string; icon: React.ElementType }> = [
  { value: 'auto', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

/** Swatch colours for the accent picker: the light-theme accent of each palette in index.css. */
const ACCENT_SWATCHES: Record<AccentColorPreference, { label: string; color: string }> = {
  blue: { label: 'Blue', color: '#0056d2' },
  violet: { label: 'Violet', color: '#6d28d9' },
  teal: { label: 'Teal', color: '#0f766e' },
  rose: { label: 'Rose', color: '#be123c' },
  orange: { label: 'Orange', color: '#c2410c' },
  graphite: { label: 'Graphite', color: '#334155' },
};

/** A row of round swatches, one per accent palette, as tall as the fields beside it. */
export function AccentPicker({ value, onChange }: { value: AccentColorPreference; onChange: (next: AccentColorPreference) => void }) {
  return (
    <div role="radiogroup" aria-label="Accent colour" className="flex h-[34px] items-center justify-between gap-1.5 sm:justify-end">
      {ACCENT_COLORS.map((option, index) => {
        const { label, color } = ACCENT_SWATCHES[option];
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option)}
            onKeyDown={(event) => {
              const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              if (!step) return;
              event.preventDefault();
              const next = (index + step + ACCENT_COLORS.length) % ACCENT_COLORS.length;
              onChange(ACCENT_COLORS[next]!);
              (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
            }}
            className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full ring-offset-2 ring-offset-[var(--color-surface)] transition-shadow', selected ? 'ring-2' : 'hover:ring-2 hover:ring-[var(--color-border-strong)]')}
            style={{ backgroundColor: color, ...(selected ? { '--tw-ring-color': color } as React.CSSProperties : {}) }}
          >
            {selected && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}

/** System / Light / Dark as the app's sliding segmented control, as tall as the fields beside it. */
export function ThemeSwitch({ value, onChange }: { value: ThemeChoice; onChange: (next: ThemeChoice) => void }) {
  return (
    <div role="radiogroup" aria-label="Theme" className="ui-segmented ui-segmented--3 grid w-full grid-cols-3 gap-1 rounded-lg bg-[var(--ref-surface-container)] p-1" data-segment-index={THEMES.findIndex((option) => option.value === value)}>
      {THEMES.map(({ value: option, label, icon: Icon }, index) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          tabIndex={value === option ? 0 : -1}
          onClick={() => onChange(option)}
          onKeyDown={(event) => {
            const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
            if (!step) return;
            event.preventDefault();
            const next = (index + step + THEMES.length) % THEMES.length;
            onChange(THEMES[next]!.value);
            (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
          }}
          className={cn('flex h-[26px] items-center justify-center gap-1.5 rounded-md px-3.5 text-xs font-semibold sm:min-w-[5.75rem]', value === option ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]')}
        >
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}
