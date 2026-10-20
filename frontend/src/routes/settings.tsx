import { Link, createFileRoute, useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { MenuSelect, type MenuSelectOption } from '../components/ui/MenuSelect';
import { Modal } from '../components/ui/Modal';
import { Skeleton } from '../components/ui/Skeleton';
import { ActionSheet, type SheetAction } from '../components/ui/ActionSheet';
import { usePhoneSheets } from '../hooks/usePhoneSheets';
import { RequireAuth } from '../lib/auth';
import { useEffect, useId, useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type AgentMemory, type PersonalProfile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAccountsLedgerQuery } from '../features/accounts/queries';
import { useAgentMemoriesQuery } from '../features/agent/queries';
import { agentCommands } from '../features/agent/commands';
import { queryKeys } from '../features/core/query-keys';
import { useUiStore } from '../stores/ui-store';
import { ACCENT_COLORS, cn, formatDate, formatDateTime, SETTINGS_CHANGED_EVENT, type AccentColorPreference, type TextSizePreference, type TimeFormatPreference, type WeekStartPreference } from '../lib/utils';
import { loadTransferFeeRules, saveTransferFeeRules, type TransferFeePayer, type TransferFeeRule } from '../lib/transferFees';
import { birthdayPassword, loadReportSecuritySettings, passwordFormatDescription, type PdfPasswordFormat } from '../lib/reportSecurity';
import { useConfirm } from '../components/ui/ConfirmDialog';
import { toast, errorMessage } from '../components/ui/useToast';
import { useTheme } from '../hooks/useTheme';
import { useBalanceVisibility } from '../hooks/useBalanceVisibility';
import { useExportDataMutation, type ExportSelection } from '../features/settings/queries';
import {
  Database,
  Trash2,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  CreditCard,
  User,
  Settings2,
  Download,
  ChevronLeft,
  ChevronRight,
  Check,
  Brain,
  Pencil,
  Plus,
  LockKeyhole,
  Search,
  CloudUpload,
  X,
  LogOut,
  MoreHorizontal,
  KeyRound,
  Monitor,
  Sun,
  Moon,
} from 'lucide-react';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

interface AppSettings {
  dateFormat: string;
  opportunityCostYield: number;
  salaryDay: number;
  defaultBankAccountId: number | null;
  defaultExpenseAccountId: number | null;
  defaultIncomeAccountId: number | null;
  theme: 'light' | 'dark' | 'auto';
  transferFeeRules: TransferFeeRule[];
  pdfPasswordEnabled: boolean;
  pdfPasswordFormat: PdfPasswordFormat;
  timeFormat: TimeFormatPreference;
  weekStart: WeekStartPreference;
  textSize: TextSizePreference;
  reduceMotion: boolean;
  accentColor: AccentColorPreference;
}

interface ExportOptions {
  transactions: boolean;
  accounts: boolean;
  categories: boolean;
  budgets: boolean;
  settings: boolean;
  memories: boolean;
}

type TabType = 'profile' | 'general' | 'accounts' | 'agent' | 'data' | 'backups' | 'reports';
type ThemeChoice = 'auto' | 'light' | 'dark';
type DatabaseBackupFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
type DatabaseBackupSettings = {
  enabled: boolean;
  frequency: DatabaseBackupFrequency;
  lastBackupAt: number | null;
  nextBackupAt: number | null;
  backups: Array<{ key: string; size: number; createdAt: number }>;
  pagination: { page: number; pageSize: number; total: number; hasNext: boolean };
};

type AgentModel = {
  id: number;
  name: string;
  model: string;
  baseUrl: string;
  isDefault: boolean;
  apiKeyConfigured: boolean;
  apiKeySource: 'database' | 'environment' | 'none';
  createdAt: number | string;
  updatedAt: number | string;
};

/**
 * One open section: its groups stacked with a hairline between them. `settings-compact` gives
 * every field the height of a small button, so no row mixes control sizes.
 */
function SettingsPanel({ children }: { children: React.ReactNode }) {
  return <div className="settings-compact max-w-2xl divide-y divide-[var(--color-border)] animate-in fade-in duration-300">{children}</div>;
}

interface SettingsGroupProps {
  title: string;
  /** One line under the title: what is set now, so a closed group still says something. */
  summary?: React.ReactNode;
  /** Groups drill down; the first one in a section usually starts open. */
  defaultOpen?: boolean;
  /** A group that is always open, headed by a small label instead of a drill-down row; `summary` is not shown. */
  fixed?: boolean;
  children: React.ReactNode;
}

function SettingsGroup({ title, summary, defaultOpen = false, fixed = false, children }: SettingsGroupProps) {
  const header = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--ref-on-surface)]">{title}</span>
        {summary != null && <span className="mt-0.5 block truncate text-xs text-[var(--ref-on-surface-variant)]">{summary}</span>}
      </span>
    </>
  );
  const body = <div className="pb-5">{children}</div>;
  if (fixed) {
    // An always-open group is headed like the app sidebar's groups: a small tracked label, so it never competes with the settings under it.
    return (
      <section className="pb-5 pt-5 first:pt-4">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ref-on-surface-variant)]">{title}</h2>
        {children}
      </section>
    );
  }
  return (
    <details className="group py-1" open={defaultOpen}>
      <summary className="-mx-2 flex cursor-pointer list-none items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-[var(--ref-surface-container-low)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ref-primary)]/40 [&::-webkit-details-marker]:hidden">
        {header}
        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted)] transition-transform duration-200 group-open:rotate-90" aria-hidden />
      </summary>
      {body}
    </details>
  );
}

interface SettingsRowProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Keep a small control (a toggle, a short button) beside the label on phones too. */
  inline?: boolean;
  /** A control that needs more than the standard field width (the theme switch) sizes itself. */
  wideControl?: boolean;
}

function SettingsRow({ label, description, action, inline = false, wideControl = false }: SettingsRowProps) {
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

function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string }) {
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

/** Success or error under a form, the same everywhere in Settings. */
function Notice({ notice, className }: { notice: { tone: 'success' | 'error'; text: string } | null; className?: string }) {
  if (!notice) return null;
  return (
    <p role={notice.tone === 'error' ? 'alert' : 'status'} className={cn('flex items-center gap-1.5 text-xs font-medium', notice.tone === 'success' ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]', className)}>
      {notice.tone === 'success' ? <CheckCircle className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      {notice.text}
    </p>
  );
}

/** A unit inside the right edge of a number field; pinned to the field's bottom so a label above it doesn't shift it. */
function SuffixInput({ suffix, children }: { suffix: string; children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <span className="pointer-events-none absolute bottom-px right-3 py-[0.4375rem] text-sm leading-[1.125rem] text-[var(--color-muted)]" aria-hidden>{suffix}</span>
    </div>
  );
}

/**
 * A row's "⋯" actions, the same way Accounts does them: a bottom sheet on phones, a small anchored
 * menu elsewhere. Danger actions sit last and read in red.
 */
function RowActions({ title, actions }: { title: string; actions: SheetAction[] }) {
  const asSheet = usePhoneSheets();
  const [sheetOpen, setSheetOpen] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const menu = menuRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    // Escape closes just this menu, not the Settings dialog around it, wherever focus is. A capturing
    // listener on window runs before the dialog's own document listener.
    const closeOnEscape = (event: KeyboardEvent) => {
      const menu = menuRef.current;
      if (event.key !== 'Escape' || !menu?.open) return;
      event.preventDefault();
      event.stopPropagation();
      menu.open = false;
      menu.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape, true);
    };
  }, []);
  const trigger = 'grid h-[34px] w-[34px] place-items-center rounded-lg text-[var(--ref-on-surface-variant)] transition-colors hover:bg-[var(--ref-surface-container-low)] hover:text-[var(--ref-on-surface)]';
  if (asSheet) {
    return (
      <>
        <button type="button" className={trigger} aria-label={`Actions for ${title}`} aria-haspopup="menu" onClick={() => setSheetOpen(true)}><MoreHorizontal className="h-4 w-4" aria-hidden /></button>
        <ActionSheet isOpen={sheetOpen} onClose={() => setSheetOpen(false)} title={title} actions={actions} />
      </>
    );
  }
  return (
    <details ref={menuRef} className="group/menu relative">
      <summary className={cn(trigger, 'cursor-pointer list-none group-open/menu:bg-[var(--ref-surface-container-low)] [&::-webkit-details-marker]:hidden')} aria-label={`Actions for ${title}`}><MoreHorizontal className="h-4 w-4" aria-hidden /></summary>
      <div className="ui-popover absolute right-0 top-[calc(100%+4px)] z-20 w-44 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-1 shadow-lg" role="menu">
        {actions.map(({ key, label, icon: Icon, tone, disabled, onSelect }) => (
          <button
            key={key}
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); onSelect(); }}
            className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors hover:bg-[var(--ref-surface-container-low)] disabled:cursor-not-allowed disabled:opacity-50', tone === 'danger' ? 'text-[var(--color-danger)]' : 'text-[var(--ref-on-surface)]')}
          >
            {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            {label}
          </button>
        ))}
      </div>
    </details>
  );
}

/** Placeholder rows shaped like a settings group, shown inside the dialog while settings load. */
function SettingsSkeleton() {
  return (
    <div className="max-w-2xl space-y-1 pt-4" aria-busy="true" aria-label="Loading settings">
      <Skeleton className="mb-4 h-3 w-24" />
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center justify-between gap-6 border-b border-[var(--color-border)] py-3 last:border-b-0">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
          <Skeleton className="h-[34px] w-48 shrink-0 max-sm:hidden" />
        </div>
      ))}
    </div>
  );
}

/**
 * A number setting that only saves values in range. While you type something out of range it says
 * so under the field; leaving the field puts back the last saved value.
 */
function NumberSetting({ value, onCommit, min, max, step, integer = false, suffix, suffixPadding, ariaLabel, rangeHint }: {
  value: number;
  onCommit: (next: number) => void;
  min: number;
  max: number;
  step?: string;
  integer?: boolean;
  suffix: string;
  /** Right padding that leaves room for the suffix, e.g. `pr-28!`. */
  suffixPadding: string;
  ariaLabel: string;
  rangeHint: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const hintId = useId();
  const text = draft ?? String(value);
  const parsed = Number(text);
  const valid = text.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max && (!integer || Number.isInteger(parsed));
  return (
    <div>
      <SuffixInput suffix={suffix}>
        <Input
          label=""
          aria-label={ariaLabel}
          aria-invalid={!valid || undefined}
          aria-describedby={!valid ? hintId : undefined}
          className={cn(NO_SPIN, suffixPadding, !valid && 'border-[var(--color-danger)]! focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-danger)_20%,transparent)]!')}
          type="number"
          inputMode={integer ? 'numeric' : 'decimal'}
          value={text}
          min={min}
          max={max}
          step={step}
          onFocus={() => setDraft(String(value))}
          onBlur={() => setDraft(null)}
          onChange={(event) => {
            setDraft(event.target.value);
            const next = Number(event.target.value);
            if (event.target.value.trim() !== '' && Number.isFinite(next) && next >= min && next <= max && (!integer || Number.isInteger(next))) onCommit(next);
          }}
        />
      </SuffixInput>
      {!valid && <p id={hintId} className="mt-1 text-left text-[11px] font-medium text-[var(--color-danger)]">{rangeHint}</p>}
    </div>
  );
}

/** Number fields with a unit inside them: the browser's spin arrows would sit on top of it. */
const NO_SPIN = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
/** A destructive action that stays quiet until it is needed. */
const QUIET_DANGER = 'text-[var(--color-danger)]! hover:bg-[var(--color-danger)]/10';
/** Lists inside a group: hairlines between items, no box around them. */
const LIST = 'divide-y divide-[var(--color-border)]';
const EMPTY = 'text-sm text-[var(--ref-on-surface-variant)]';
/** An inline add/edit form: a quiet tinted panel. */
const INLINE_FORM = 'rounded-xl bg-[var(--ref-surface-container-low)] p-4';

/**
 * The app's own dropdown (a bottom sheet on phones) in its field style. `label` shows above it,
 * as on a text field; without one, `ariaLabel` names it for rows that already have a label.
 */
function Dropdown<T extends string>({ label, ariaLabel, value, options, onChange, disabled }: { label?: string; ariaLabel?: string; value: T; options: readonly MenuSelectOption<T>[]; onChange: (value: T) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="space-y-1 text-left">
      {label && <label htmlFor={id} className="block text-sm font-medium text-[var(--color-text-secondary)]">{label}</label>}
      <MenuSelect id={id} variant="field" ariaLabel={label ?? ariaLabel ?? ''} value={value} options={options} onChange={onChange} disabled={disabled} />
    </div>
  );
}

const CURRENCIES = [
  { value: 'IDR', label: 'Rp (IDR - Indonesian Rupiah)', symbol: 'Rp' },
  { value: 'USD', label: '$ (USD - US Dollar)', symbol: '$' },
  { value: 'EUR', label: '€ (EUR - Euro)', symbol: '€' },
  { value: 'GBP', label: '£ (GBP - British Pound)', symbol: '£' },
  { value: 'JPY', label: '¥ (JPY - Japanese Yen)', symbol: '¥' },
  { value: 'SGD', label: 'S$ (SGD - Singapore Dollar)', symbol: 'S$' },
  { value: 'MYR', label: 'RM (MYR - Malaysian Ringgit)', symbol: 'RM' },
];

const TIME_FORMATS: Array<MenuSelectOption<TimeFormatPreference>> = [
  { value: '24h', label: '24-hour (17:30)' },
  { value: '12h', label: '12-hour (5:30 PM)' },
];

const DATE_FORMATS = [
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
  { value: 'DD MMM YYYY', label: 'DD MMM YYYY' },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const TIMEZONES = [
  { value: 'Asia/Jakarta', label: 'Jakarta (UTC+7)' },
  { value: 'Asia/Singapore', label: 'Singapore (UTC+8)' },
  { value: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur (UTC+8)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'London' },
  { value: 'America/New_York', label: 'New York' },
];

const INCOME_PATTERNS = [
  { value: '', label: 'Choose later' },
  { value: 'salary', label: 'Regular salary' },
  { value: 'freelance', label: 'Freelance or contract work' },
  { value: 'business', label: 'Business income' },
  { value: 'mixed', label: 'A mix of sources' },
  { value: 'irregular', label: 'Irregular income' },
  { value: 'other', label: 'Something else' },
];

const FINANCIAL_GOALS = [
  { value: '', label: 'Choose later' },
  { value: 'build_savings', label: 'Build savings' },
  { value: 'pay_debt', label: 'Pay off debt' },
  { value: 'control_spending', label: 'Control spending' },
  { value: 'plan_purchase', label: 'Plan a large purchase' },
  { value: 'understand_finances', label: 'Understand my finances' },
  { value: 'other', label: 'Something else' },
];

const DEFAULT_AGENT_CONTEXT: PersonalProfile['agentContext'] = {
  fullName: false,
  preferredName: true,
  pronouns: false,
  age: false,
  country: false,
  timezone: true,
  language: true,
  currency: true,
  incomePattern: false,
  primaryGoal: false,
  agentTone: true,
  agentVerbosity: true,
};

const AGENT_CONTEXT_OPTIONS: Array<{ key: keyof PersonalProfile['agentContext']; label: string; description: string }> = [
  { key: 'fullName', label: 'Full name', description: 'Use it in personalized greetings and summaries.' },
  { key: 'preferredName', label: 'Preferred name', description: 'Use it when addressing you.' },
  { key: 'pronouns', label: 'Pronouns', description: 'Use them when they help phrase a response naturally.' },
  { key: 'age', label: 'Age', description: 'Share your derived age; your date of birth is never sent.' },
  { key: 'country', label: 'Country or region', description: 'Use it for relevant context and examples.' },
  { key: 'timezone', label: 'Timezone', description: 'Use it for dates, times, and reminders.' },
  { key: 'language', label: 'Language', description: 'Use it to choose the response language.' },
  { key: 'currency', label: 'Currency', description: 'Use it when formatting financial answers.' },
  { key: 'incomePattern', label: 'Income pattern', description: 'Use it to tailor financial guidance.' },
  { key: 'primaryGoal', label: 'Main financial goal', description: 'Use it to keep recommendations aligned.' },
  { key: 'agentTone', label: 'Agent tone', description: 'Use your preferred conversational tone.' },
  { key: 'agentVerbosity', label: 'Agent detail', description: 'Use your preferred response depth.' },
];

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
function AccentPicker({ value, onChange }: { value: AccentColorPreference; onChange: (next: AccentColorPreference) => void }) {
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
function ThemeSwitch({ value, onChange }: { value: ThemeChoice; onChange: (next: ThemeChoice) => void }) {
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

/** Known OpenAI-compatible providers; picking one fills in its base URL. */
const MODEL_PROVIDERS = [
  { value: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
];

/** The sharing dialog lists the profile details in the same groups Profile shows them in. */
const AGENT_CONTEXT_GROUPS: Array<{ title: string; keys: Array<keyof PersonalProfile['agentContext']> }> = [
  { title: 'About you', keys: ['fullName', 'preferredName', 'pronouns', 'age'] },
  { title: 'Region and language', keys: ['country', 'timezone', 'language', 'currency'] },
  { title: 'Your finances', keys: ['incomePattern', 'primaryGoal'] },
  { title: 'Response style', keys: ['agentTone', 'agentVerbosity'] },
];

// `keywords` lets search find a section by the settings inside it, not only by its name.
const TABS: { id: TabType; label: string; icon: React.ElementType; summary: string; keywords: string }[] = [
  { id: 'profile', label: 'Profile', icon: User, summary: 'Your name, region, goals, and account', keywords: 'name preferred pronouns birthday date of birth country region timezone language currency income goal email account google sign out logout' },
  { id: 'general', label: 'General', icon: Settings2, summary: 'Display, pay cycle, and accessibility', keywords: 'appearance theme dark light mode system colour color display date format time 12-hour 24-hour clock week starts monday sunday compact rows density opportunity cost yield interest rate salary day payday budget period accessibility text size font large reduce motion animation' },
  { id: 'accounts', label: 'Accounts', icon: CreditCard, summary: 'Defaults and transfer fees', keywords: 'default bank expense income account transfer fee' },
  { id: 'agent', label: 'Agent', icon: Brain, summary: 'Style, privacy, models, and memory', keywords: 'ai assistant tone detail response style model provider api key openrouter memory memories context sharing privacy' },
  { id: 'backups', label: 'Backups', icon: CloudUpload, summary: 'Cloud snapshots of your ledger', keywords: 'cloud database backup snapshot automatic frequency schedule' },
  { id: 'reports', label: 'PDF reports', icon: LockKeyhole, summary: 'Password protection', keywords: 'pdf report password encryption protect birthday security' },
  { id: 'data', label: 'Data', icon: Database, summary: 'Export, this device, and tools', keywords: 'export json download data quality image storage gallery security audit log cache delete' },
];

/** The fields of a profile the user edits here (email and age are derived; Agent sharing saves on its own). */
function editableProfile({ email, age, agentContext, ...input }: PersonalProfile) {
  void email;
  void age;
  void agentContext;
  return input;
}

function matchingTabs(query: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return TABS;
  return TABS.filter((tab) => {
    const haystack = `${tab.label} ${tab.keywords}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function SettingsPage({ onClose }: { onClose?: () => void } = {}) {
  const { formatAmount } = useBalanceVisibility();
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  // Compact rows is the same preference as the Transactions page's own toggle.
  const compactTables = useUiStore((state) => state.compactTables);
  const setCompactTables = useUiStore((state) => state.setCompactTables);
  const exportDataMutation = useExportDataMutation();
  const queryClient = useQueryClient();
  const accountsQuery = useAccountsLedgerQuery();
  const memoriesQuery = useAgentMemoriesQuery();
  const [settings, setSettings] = useState<AppSettings>({
    dateFormat: 'DD/MM/YYYY',
    opportunityCostYield: 4.0,
    salaryDay: 25,
    defaultBankAccountId: null,
    defaultExpenseAccountId: null,
    defaultIncomeAccountId: null,
    theme: 'auto',
    transferFeeRules: [],
    pdfPasswordEnabled: false,
    pdfPasswordFormat: 'DDMMYYYY',
    timeFormat: '24h',
    weekStart: 1,
    textSize: 'default',
    reduceMotion: false,
    accentColor: 'blue',
  });
  const [profile, setProfile] = useState<PersonalProfile>({
    email: user?.email ?? '',
    fullName: null,
    preferredName: null,
    pronouns: null,
    dateOfBirth: null,
    age: null,
    country: null,
    timezone: 'Asia/Jakarta',
    language: 'en',
    currency: 'IDR',
    incomePattern: null,
    primaryGoal: null,
    agentTone: 'warm',
    agentVerbosity: 'concise',
    agentContext: DEFAULT_AGENT_CONTEXT,
  });
  const [contextDraft, setContextDraft] = useState<PersonalProfile['agentContext'] | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [profileNotice, setProfileNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [legacyBirthDate, setLegacyBirthDate] = useState(() => loadReportSecuritySettings().birthDate);
  const reportPassword = birthdayPassword(profile.dateOfBirth || legacyBirthDate, settings.pdfPasswordFormat);
  const accounts = (accountsQuery.data ?? []).map(({ id, name, type, systemKey }) => ({ id, name, type, systemKey }));
  const memories = memoriesQuery.data?.memories ?? [];
  const memoryLimits = memoriesQuery.data?.limits ?? { maxItems: 50, maxLabelLength: 80, maxContentLength: 1000 };
  const [memoryLabel, setMemoryLabel] = useState('');
  const [memoryContent, setMemoryContent] = useState('');
  const [editingMemoryId, setEditingMemoryId] = useState<number | null>(null);
  const [showMemoryForm, setShowMemoryForm] = useState(false);
  const isLoadingMemories = memoriesQuery.isPending && !memoriesQuery.data;
  const [isSavingMemory, setIsSavingMemory] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('general');
  // Phones show either the list of sections or one open section, with a way back; wider screens show both.
  const [phoneSectionOpen, setPhoneSectionOpen] = useState(false);
  const [settingsSearch, setSettingsSearch] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [showClearCacheModal, setShowClearCacheModal] = useState(false);
  const [showDeleteDataModal, setShowDeleteDataModal] = useState(false);
  const [showExportSuccess, setShowExportSuccess] = useState(false);
  const [agentProviderBusy, setAgentProviderBusy] = useState(false);
  const [agentProviderNotice, setAgentProviderNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [agentModels, setAgentModels] = useState<AgentModel[]>([]);
  const [databaseBackup, setDatabaseBackup] = useState<DatabaseBackupSettings>({ enabled: true, frequency: 'weekly', lastBackupAt: null, nextBackupAt: null, backups: [], pagination: { page: 1, pageSize: 10, total: 0, hasNext: false } });
  const [backupPage, setBackupPage] = useState(1);
  const [databaseBackupBusy, setDatabaseBackupBusy] = useState(false);
  const [databaseBackupNotice, setDatabaseBackupNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [agentModelDraft, setAgentModelDraft] = useState({ name: '', model: '', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '' });
  const [editingAgentModelId, setEditingAgentModelId] = useState<number | null>(null);
  const [showAgentModelForm, setShowAgentModelForm] = useState(false);
  const [feeRuleFrom, setFeeRuleFrom] = useState('');
  const [feeRuleTo, setFeeRuleTo] = useState('');
  const [feeRuleAmount, setFeeRuleAmount] = useState('');
  const [feeRulePayer, setFeeRulePayer] = useState<TransferFeePayer>('sender');
  const { confirm } = useConfirm();
  const visibleTabs = matchingTabs(settingsSearch);
  const activeTabInfo = TABS.find((tab) => tab.id === activeTab) ?? TABS[0]!;
  const sharedContextCount = Object.values(profile.agentContext).filter(Boolean).length;
  const contentRef = useRef<HTMLDivElement>(null);
  // Once a search leads to a section, open the group holding the best-matching setting, bring it
  // into view and flash it, so "salary" lands on Salary day rather than just the General page.
  useEffect(() => {
    const terms = settingsSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return undefined;
    const timer = setTimeout(() => {
      const root = contentRef.current;
      if (!root || !root.offsetParent) return; // The section is hidden (phones, before one is opened).
      const labels = Array.from(root.querySelectorAll<HTMLElement>('[data-setting-label], label, summary'));
      const match = labels.find((element) => {
        const text = (element.textContent ?? '').toLowerCase();
        return terms.every((term) => text.includes(term));
      });
      if (!match) return;
      const group = match.closest('details');
      if (group && !group.open) group.open = true;
      const target = match.closest<HTMLElement>('[data-setting]') ?? (match.tagName === 'SUMMARY' ? match : match.parentElement) ?? match;
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.classList.remove('settings-highlight');
      void target.offsetWidth; // Restart the animation when the same setting matches again.
      target.classList.add('settings-highlight');
      setTimeout(() => target.classList.remove('settings-highlight'), 1700);
    }, 350);
    return () => clearTimeout(timer);
  }, [settingsSearch, activeTab, phoneSectionOpen]);
  const searchSettings = (query: string) => {
    setSettingsSearch(query);
    // Wider screens show the open section beside the list: follow the search to the first match.
    const matches = matchingTabs(query);
    if (matches.length > 0 && !matches.some((tab) => tab.id === activeTab)) setActiveTab(matches[0]!.id);
  };
  // Opened as a page (deep link or the phone menu): go back to where the user came from, else home.
  const closeSettings = onClose ?? (() => { if (canGoBack) router.history.back(); else void navigate({ to: '/' }); });
  
  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    transactions: true,
    accounts: true,
    categories: true,
    budgets: true,
    settings: true,
    memories: true,
  });
  
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What was last loaded or written, so opening Settings does not "save" (and flash Saved) unchanged values.
  const savedSettingsRef = useRef<string | null>(null);
  // The profile as the server last had it; null until it has loaded, so nothing saves over it before then.
  const savedProfileRef = useRef<string | null>(null);

  useEffect(() => {
    loadSettings();
    void api.profile.get().then((savedProfile) => {
      savedProfileRef.current = JSON.stringify(editableProfile(savedProfile));
      setProfile({ ...savedProfile, agentContext: { ...DEFAULT_AGENT_CONTEXT, ...(savedProfile.agentContext ?? {}) } });
      if (!savedProfile.dateOfBirth && legacyBirthDate) {
        void api.profile.update({ dateOfBirth: legacyBirthDate })
          .then((migratedProfile) => {
            savedProfileRef.current = JSON.stringify(editableProfile(migratedProfile));
            setProfile({ ...migratedProfile, agentContext: { ...DEFAULT_AGENT_CONTEXT, ...(migratedProfile.agentContext ?? {}) } });
            setLegacyBirthDate('');
          })
          .catch(() => undefined);
      } else {
        setLegacyBirthDate('');
      }
    }).catch(() => setProfileNotice({ tone: 'error', text: 'Could not load your profile.' }));
    void api.agentProvider.models.list().then(setAgentModels).catch(() => setAgentProviderNotice({ tone: 'error', text: 'Could not load Agent models.' }));
  }, [legacyBirthDate]);

  useEffect(() => {
    void api.databaseBackup.get({ page: backupPage, pageSize: 10 }).then(setDatabaseBackup).catch(() => setDatabaseBackupNotice({ tone: 'error', text: 'Could not load database backup settings.' }));
  }, [backupPage]);

  // Profile and response style save themselves shortly after an edit, like the rest of Settings.
  // The draft is not replaced by the server's reply, so typing during a save is never undone.
  useEffect(() => {
    if (savedProfileRef.current == null) return;
    const input = editableProfile(profile);
    const serialized = JSON.stringify(input);
    if (serialized === savedProfileRef.current) return;
    setSaveStatus('saving');
    const timer = setTimeout(() => {
      setProfileNotice(null);
      api.profile.update(input)
        .then((saved) => {
          savedProfileRef.current = serialized;
          queryClient.setQueryData(queryKeys.agent.profile, { nickname: saved.preferredName });
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 2000);
        })
        .catch((error: unknown) => {
          setSaveStatus('idle');
          setProfileNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not save your profile.' });
        });
    }, 700);
    return () => clearTimeout(timer);
  }, [profile, queryClient]);

  const saveAgentContext = async () => {
    if (!contextDraft) return;
    setContextBusy(true);
    setContextError(null);
    try {
      const saved = await api.profile.update({ agentContext: contextDraft });
      setProfile((current) => ({ ...current, agentContext: saved.agentContext }));
      setContextDraft(null);
    } catch (error) {
      setContextError(error instanceof Error ? error.message : 'Could not save sharing preferences.');
    } finally {
      setContextBusy(false);
    }
  };

  const resetAgentModelDraft = () => {
    setEditingAgentModelId(null);
    setAgentModelDraft({ name: '', model: '', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '' });
    setShowAgentModelForm(false);
  };

  const openAgentModelForm = (model?: AgentModel) => {
    setAgentProviderNotice(null);
    if (model) {
      setEditingAgentModelId(model.id);
      setAgentModelDraft({ name: model.name, model: model.model, baseUrl: model.baseUrl, apiKey: '' });
    } else {
      setEditingAgentModelId(null);
      setAgentModelDraft({ name: '', model: '', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '' });
    }
    setShowAgentModelForm(true);
  };

  const saveAgentModel = async () => {
    if (!agentModelDraft.name.trim() || !agentModelDraft.model.trim() || !agentModelDraft.baseUrl.trim()) return;
    setAgentProviderBusy(true);
    setAgentProviderNotice(null);
    try {
      if (editingAgentModelId == null) {
        await api.agentProvider.models.create({ name: agentModelDraft.name, model: agentModelDraft.model, baseUrl: agentModelDraft.baseUrl, ...(agentModelDraft.apiKey.trim() ? { apiKey: agentModelDraft.apiKey.trim() } : {}) });
      } else {
        await api.agentProvider.models.update(editingAgentModelId, { name: agentModelDraft.name, model: agentModelDraft.model, baseUrl: agentModelDraft.baseUrl, ...(agentModelDraft.apiKey.trim() ? { apiKey: agentModelDraft.apiKey.trim() } : {}) });
      }
      setAgentModels(await api.agentProvider.models.list());
      resetAgentModelDraft();
      setAgentProviderNotice({ tone: 'success', text: 'Agent model saved.' });
    } catch (error) { setAgentProviderNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not save Agent model.' }); }
    finally { setAgentProviderBusy(false); }
  };

  const makeAgentModelDefault = async (id: number) => {
    setAgentProviderBusy(true);
    try { await api.agentProvider.models.setDefault(id); setAgentModels(await api.agentProvider.models.list()); setAgentProviderNotice({ tone: 'success', text: 'Default Agent model updated.' }); }
    catch (error) { setAgentProviderNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not set the default model.' }); }
    finally { setAgentProviderBusy(false); }
  };

  const clearAgentModelKey = async (id: number) => {
    setAgentProviderBusy(true);
    try { await api.agentProvider.models.update(id, { clearApiKey: true }); setAgentModels(await api.agentProvider.models.list()); setAgentProviderNotice({ tone: 'success', text: 'Stored key cleared. The environment fallback remains available.' }); }
    catch (error) { setAgentProviderNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not clear the stored key.' }); }
    finally { setAgentProviderBusy(false); }
  };

  const removeAgentModel = async (id: number) => {
    const model = agentModels.find((item) => item.id === id);
    if (!model) return;
    const confirmed = await confirm({ title: 'Delete Agent model?', message: `Remove “${model.name}” from your saved models?`, confirmLabel: 'Delete', variant: 'danger' });
    if (!confirmed) return;
    setAgentProviderBusy(true);
    try { await api.agentProvider.models.remove(id); setAgentModels(await api.agentProvider.models.list()); setAgentProviderNotice({ tone: 'success', text: 'Agent model deleted.' }); }
    catch (error) { setAgentProviderNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not delete the model.' }); }
    finally { setAgentProviderBusy(false); }
  };

  const saveDatabaseBackupSettings = async (input: { enabled?: boolean; frequency?: DatabaseBackupFrequency }) => {
    setDatabaseBackupBusy(true);
    setDatabaseBackupNotice(null);
    try {
      const saved = await api.databaseBackup.update(input);
      setBackupPage(1);
      setDatabaseBackup(saved);
      setDatabaseBackupNotice({ tone: 'success', text: 'Database backup settings saved.' });
    } catch (error) {
      setDatabaseBackupNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not save database backup settings.' });
    } finally { setDatabaseBackupBusy(false); }
  };

  const runDatabaseBackup = async () => {
    setDatabaseBackupBusy(true);
    setDatabaseBackupNotice(null);
    try {
      const result = await api.databaseBackup.run();
      setBackupPage(1);
      setDatabaseBackup(result.settings);
      setDatabaseBackupNotice({ tone: 'success', text: `Backup uploaded (${formatBytes(result.backup.size)}).` });
    } catch (error) {
      setDatabaseBackupNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not create database backup.' });
    } finally { setDatabaseBackupBusy(false); }
  };

  // Auto-save with a short debounce
  useEffect(() => {
    if (isLoading) return;
    const serialized = JSON.stringify(settings);
    if (serialized === savedSettingsRef.current) return;

    setSaveStatus('saving');
    
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem('fainens-settings', serialized);
        savedSettingsRef.current = serialized;
        window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch (err) {
        console.error('Failed to save settings:', err);
        setSaveStatus('idle');
      }
    }, 150); // Short, so accent and text size feel instant; it is only a local write.
    
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [settings, isLoading]);

  const loadSettings = async () => {
    try {
      const saved = localStorage.getItem('fainens-settings');
      const parsed = saved ? JSON.parse(saved) : {};

      const loaded: AppSettings = {
        dateFormat: parsed.dateFormat || 'DD/MM/YYYY',
        opportunityCostYield: parsed.opportunityCostYield ?? 4.0,
        salaryDay: parsed.salaryDay || 25,
        defaultBankAccountId: parsed.defaultBankAccountId || null,
        defaultExpenseAccountId: parsed.defaultExpenseAccountId || null,
        defaultIncomeAccountId: parsed.defaultIncomeAccountId || null,
        theme: parsed.theme || 'auto',
        transferFeeRules: loadTransferFeeRules(),
        pdfPasswordEnabled: parsed.pdfPasswordEnabled === true,
        pdfPasswordFormat: parsed.pdfPasswordFormat === 'YYYYMMDD' ? 'YYYYMMDD' : 'DDMMYYYY',
        // Same defaults as displayPreferences() in lib/utils, which the rest of the app reads.
        timeFormat: parsed.timeFormat === '12h' ? '12h' : '24h',
        weekStart: parsed.weekStart === 0 ? 0 : 1,
        textSize: parsed.textSize === 'large' ? 'large' : 'default',
        reduceMotion: parsed.reduceMotion === true,
        accentColor: ACCENT_COLORS.includes(parsed.accentColor) ? parsed.accentColor : 'blue',
      };
      savedSettingsRef.current = JSON.stringify(loaded);
      setSettings(loaded);
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const addTransferFeeRule = () => {
    const fromAccountId = Number(feeRuleFrom);
    const toAccountId = Number(feeRuleTo);
    const feeCents = Number(feeRuleAmount);
    if (!Number.isSafeInteger(fromAccountId) || !Number.isSafeInteger(toAccountId) || fromAccountId <= 0 || toAccountId <= 0 || fromAccountId === toAccountId) return;
    if (!Number.isSafeInteger(feeCents) || feeCents < 0) return;
    const nextRule: TransferFeeRule = { fromAccountId, toAccountId, feeCents, payer: feeRulePayer };
    const next = [...settings.transferFeeRules.filter((rule) => !(rule.fromAccountId === fromAccountId && rule.toAccountId === toAccountId)), nextRule];
    setSettings({ ...settings, transferFeeRules: next });
    saveTransferFeeRules(next);
    setFeeRuleFrom('');
    setFeeRuleTo('');
    setFeeRuleAmount('');
  };

  const removeTransferFeeRule = (rule: TransferFeeRule) => {
    const next = settings.transferFeeRules.filter((candidate) => candidate !== rule && !(candidate.fromAccountId === rule.fromAccountId && candidate.toAccountId === rule.toAccountId));
    setSettings({ ...settings, transferFeeRules: next });
    saveTransferFeeRules(next);
  };

  const resetMemoryForm = () => {
    setEditingMemoryId(null);
    setMemoryLabel('');
    setMemoryContent('');
    setShowMemoryForm(false);
  };

  const openMemoryForm = () => {
    resetMemoryForm();
    setMemoryError(null);
    setShowMemoryForm(true);
  };

  const saveMemory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const label = memoryLabel.trim();
    const content = memoryContent.trim();
    if (!label || !content) {
      setMemoryError('Add a short name and the memory you want the agent to remember.');
      return;
    }
    setIsSavingMemory(true);
    setMemoryError(null);
    try {
      if (editingMemoryId == null) {
        await agentCommands.memories.create({ label, content });
      } else {
        await agentCommands.memories.update(editingMemoryId, { label, content });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.agent.memories });
      resetMemoryForm();
    } catch (err) {
      setMemoryError(err instanceof Error ? err.message : 'Could not save agent memory.');
    } finally {
      setIsSavingMemory(false);
    }
  };

  const editMemory = (memory: AgentMemory) => {
    setEditingMemoryId(memory.id);
    setMemoryLabel(memory.label);
    setMemoryContent(memory.content);
    setMemoryError(null);
    setShowMemoryForm(true);
  };

  const deleteMemory = async (memory: AgentMemory) => {
    const confirmed = await confirm({
      title: 'Delete personal memory',
      message: `Remove “${memory.label}” from the information supplied to the agent?`,
      confirmLabel: 'Delete memory',
      variant: 'danger',
    });
    if (!confirmed) return;
    setMemoryError(null);
    try {
      await agentCommands.memories.delete(memory.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.agent.memories });
      if (editingMemoryId === memory.id) resetMemoryForm();
    } catch (err) {
      setMemoryError(err instanceof Error ? err.message : 'Could not delete agent memory.');
    }
  };

  const getAccountOptions = (type?: string) => {
    const options = [{ value: '', label: 'Automatic' }];
    const filtered = type ? accounts.filter((a) => a.type === type) : accounts;
    return [
      ...options,
      ...filtered.map((a) => ({ value: a.id.toString(), label: a.name })),
    ];
  };

  const handleExport = useCallback(async () => {
    const exportData: Record<string, unknown> = {
      exportedAt: new Date().toISOString(),
      version: '1.0.0',
    };

    try {
      Object.assign(exportData, await exportDataMutation.mutateAsync(exportOptions as ExportSelection));
      if (exportOptions.settings) {
        exportData.settings = settings;
      }

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fainens-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setShowExportSuccess(true);
      setTimeout(() => setShowExportSuccess(false), 3000);
    } catch (err) {
      toast.error('Could not export data', errorMessage(err));
    }
  }, [exportOptions, settings, exportDataMutation]);

  const handleClearCache = () => {
    localStorage.removeItem('fainens-cache');
    sessionStorage.clear();
    setShowClearCacheModal(false);
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  };

  const handleDeleteAllData = () => {
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = '/login';
  };

  return (
    <RequireAuth>
      <Modal
        isOpen
        onClose={closeSettings}
        title="Settings"
        // On phones the open section has its own header; the tagline is for wider screens.
        subtitle={<span className="max-md:hidden">Configure Fainens around the way you manage money.</span>}
        size="xl"
        showCloseLabel={false}
        className="h-[min(680px,82vh)] max-w-[min(920px,92vw)] !rounded-xl !shadow-xl"
        contentClassName="!overflow-hidden !p-0"
      >
        <div className="flex h-full min-h-0 flex-col md:flex-row">
          <aside className={cn('flex w-full shrink-0 flex-col p-3 max-md:min-h-0 max-md:flex-1 max-md:overflow-y-auto max-md:px-4 md:w-52 md:border-r md:border-[var(--color-border)] md:bg-[var(--ref-surface-container-low)]', phoneSectionOpen && 'max-md:hidden')}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" aria-hidden />
              <input
                type="search"
                value={settingsSearch}
                onChange={(event) => searchSettings(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape' && settingsSearch) { event.stopPropagation(); searchSettings(''); } }}
                placeholder="Search settings"
                aria-label="Search settings"
                className={cn('h-[34px] w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-9 text-sm outline-none transition placeholder:text-[var(--color-muted)] focus:border-[var(--ref-primary-container)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ref-primary-container)_22%,transparent)] [&::-webkit-search-cancel-button]:hidden', settingsSearch ? 'pr-8' : 'pr-3')}
              />
              {settingsSearch && (
                <button type="button" onClick={() => searchSettings('')} className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-[var(--color-muted)] hover:bg-[var(--ref-surface-container)] hover:text-[var(--color-text-primary)]" aria-label="Clear search">
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </div>
            {/* Phones: a list of sections that each drill into their own page. Wider: a side rail styled like the app sidebar. */}
            <nav aria-label="Settings sections" className="mt-3 flex flex-col gap-0.5 max-md:mt-4 max-md:gap-0 max-md:divide-y max-md:divide-[var(--color-border)]">
              {visibleTabs.map(({ id, label, icon: Icon, summary }) => (
                <button
                  key={id}
                  type="button"
                  aria-current={activeTab === id ? 'page' : undefined}
                  onClick={() => { setActiveTab(id); setPhoneSectionOpen(true); }}
                  className={cn(
                    'group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors max-md:gap-3 max-md:rounded-none max-md:px-0 max-md:py-3 max-md:text-[var(--ref-on-surface)]',
                    activeTab === id
                      ? 'md:bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] md:font-semibold md:text-[var(--color-accent)]'
                      : 'md:text-[var(--color-text-secondary)] md:hover:bg-[var(--ref-surface-container)] md:hover:text-[var(--color-text-primary)]'
                  )}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0 max-md:text-[var(--ref-on-surface-variant)]" strokeWidth={1.8} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{label}</span>
                    <span className="block truncate text-xs font-normal text-[var(--ref-on-surface-variant)] md:hidden">{summary}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted)] md:hidden" aria-hidden />
                </button>
              ))}
              {visibleTabs.length === 0 && (
                <div className="px-3 py-6 text-center">
                  <p className="text-sm font-medium text-[var(--ref-on-surface)]">No matches</p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">Try a setting’s name, like “theme” or “backup”.</p>
                </div>
              )}
            </nav>
          </aside>

          <main className={cn('flex min-h-0 min-w-0 flex-1 flex-col', !phoneSectionOpen && 'max-md:hidden')}>
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--color-border)] px-4 py-3 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <button type="button" onClick={() => setPhoneSectionOpen(false)} className="-ml-2 -mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--ref-surface-container-low)] md:hidden" aria-label="All settings">
                  <ChevronLeft className="h-5 w-5" aria-hidden />
                </button>
                <div className="min-w-0">
                  <h1 className="truncate font-headline text-lg font-bold leading-tight text-[var(--ref-on-surface)]">{activeTabInfo.label}</h1>
                  <p className="truncate text-xs text-[var(--ref-on-surface-variant)]">{activeTabInfo.summary}</p>
                </div>
              </div>
              {saveStatus !== 'idle' && (
                <span className={cn('flex items-center gap-1.5 text-xs font-medium', saveStatus === 'saving' ? 'text-[var(--color-accent)]' : 'text-[var(--color-success)]')}>
                  {saveStatus === 'saving' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {saveStatus === 'saving' ? 'Saving' : 'Saved'}
                </span>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2 sm:px-6">
              {isLoading && <SettingsSkeleton />}
              <div ref={contentRef} className={cn(isLoading && 'hidden')}>
          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <SettingsPanel>
              <SettingsGroup fixed title="About you">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label="Name" value={profile.fullName ?? ''} onChange={(event) => setProfile((current) => ({ ...current, fullName: event.target.value || null }))} placeholder="Your full name" maxLength={120} />
                  <Input label="Preferred name" value={profile.preferredName ?? ''} onChange={(event) => setProfile((current) => ({ ...current, preferredName: event.target.value || null }))} placeholder="What should we call you?" maxLength={80} />
                  <Input label="Pronouns (optional)" value={profile.pronouns ?? ''} onChange={(event) => setProfile((current) => ({ ...current, pronouns: event.target.value || null }))} placeholder="e.g. they/them" maxLength={80} />
                  <Input label="Date of birth (optional)" type="date" value={profile.dateOfBirth ?? ''} onChange={(event) => setProfile((current) => ({ ...current, dateOfBirth: event.target.value || null }))} />
                </div>
              </SettingsGroup>
              <SettingsGroup title="Region and language" summary={[profile.country, TIMEZONES.find((zone) => zone.value === profile.timezone)?.label ?? profile.timezone, profile.language === 'id' ? 'Bahasa Indonesia' : 'English', profile.currency].filter(Boolean).join(' · ')}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label="Country or region" value={profile.country ?? ''} onChange={(event) => setProfile((current) => ({ ...current, country: event.target.value || null }))} placeholder="e.g. Indonesia" maxLength={80} />
                  <Dropdown label="Timezone" value={profile.timezone} onChange={(timezone) => setProfile((current) => ({ ...current, timezone }))} options={TIMEZONES} />
                  <Dropdown<PersonalProfile['language']> label="Language" value={profile.language} onChange={(language) => setProfile((current) => ({ ...current, language }))} options={[{ value: 'en', label: 'English' }, { value: 'id', label: 'Bahasa Indonesia' }]} />
                  <Dropdown label="Default currency" value={profile.currency} onChange={(currency) => setProfile((current) => ({ ...current, currency }))} options={CURRENCIES} />
                </div>
              </SettingsGroup>
              <SettingsGroup title="Your finances" summary={[INCOME_PATTERNS.find((item) => item.value === (profile.incomePattern ?? ''))?.label, FINANCIAL_GOALS.find((item) => item.value === (profile.primaryGoal ?? ''))?.label].filter((label) => label && label !== 'Choose later').join(' · ') || 'Income pattern and main goal, optional'}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Dropdown label="Income pattern" value={profile.incomePattern ?? ''} onChange={(value) => setProfile((current) => ({ ...current, incomePattern: (value || null) as PersonalProfile['incomePattern'] }))} options={INCOME_PATTERNS} />
                  <Dropdown label="Main financial goal" value={profile.primaryGoal ?? ''} onChange={(value) => setProfile((current) => ({ ...current, primaryGoal: (value || null) as PersonalProfile['primaryGoal'] }))} options={FINANCIAL_GOALS} />
                </div>
              </SettingsGroup>
              <SettingsGroup fixed title="Account">
                <SettingsRow
                  inline
                  label="Signed in with Google"
                  description={profile.email || user?.email || 'Your account'}
                  action={<Button type="button" size="sm" variant="secondary" onClick={async () => {
                    if (await confirm({ title: 'Sign out', message: 'Are you sure you want to sign out?', confirmLabel: 'Sign out', variant: 'default' })) await logout();
                  }}><LogOut className="h-4 w-4" aria-hidden /> Sign out</Button>}
                />
                <p className="pt-3 text-xs text-[var(--color-muted)]">Profile changes save automatically.</p>
                <Notice notice={profileNotice} className="pt-2" />
              </SettingsGroup>
            </SettingsPanel>
          )}

          {/* General Tab */}
          {activeTab === 'general' && (
            <SettingsPanel>
              <SettingsGroup fixed title="Display">
                <SettingsRow
                  label="Theme"
                  description="Light, dark, or match your device."
                  wideControl
                  action={<ThemeSwitch value={theme} onChange={setTheme} />}
                />
                <SettingsRow
                  label="Accent colour"
                  description="Buttons, links, and highlights."
                  action={<AccentPicker value={settings.accentColor} onChange={(accentColor) => setSettings({ ...settings, accentColor })} />}
                />
                <SettingsRow
                  label="Date format"
                  description="How dates appear throughout Fainens."
                  action={<Dropdown ariaLabel="Date format" value={settings.dateFormat} onChange={(dateFormat) => setSettings({ ...settings, dateFormat })} options={DATE_FORMATS} />}
                />
                <SettingsRow
                  label="Time format"
                  description="How times appear, for example on transactions and backups."
                  action={<Dropdown<TimeFormatPreference> ariaLabel="Time format" value={settings.timeFormat} onChange={(timeFormat) => setSettings({ ...settings, timeFormat })} options={TIME_FORMATS} />}
                />
                <SettingsRow
                  label="Week starts on"
                  description="The first day in calendars, the spending heatmap, and “this week”."
                  action={<Dropdown ariaLabel="Week starts on" value={String(settings.weekStart)} onChange={(value) => setSettings({ ...settings, weekStart: value === '0' ? 0 : 1 })} options={[{ value: '1', label: 'Monday' }, { value: '0', label: 'Sunday' }]} />}
                />
                <SettingsRow
                  inline
                  label="Compact rows"
                  description="Fit more transactions on screen with tighter rows."
                  action={<Toggle label="Compact rows" checked={compactTables} onChange={setCompactTables} />}
                />
              </SettingsGroup>
              <SettingsGroup fixed title="Pay cycle and returns" summary="Used by budgets and opportunity-cost figures">
                <SettingsRow
                  label="Salary day"
                  description="The day of the month your salary arrives. Budget periods start on this day."
                  action={<NumberSetting ariaLabel="Salary day of month" value={settings.salaryDay} onCommit={(salaryDay) => setSettings((current) => ({ ...current, salaryDay }))} min={1} max={31} integer suffix="of the month" suffixPadding="pr-28!" rangeHint="Use a day from 1 to 31." />}
                />
                <SettingsRow
                  label="Opportunity cost yield"
                  description="Yearly money market rate, used to show what idle money could have earned."
                  action={<NumberSetting ariaLabel="Opportunity cost yield, percent a year" value={settings.opportunityCostYield} onCommit={(opportunityCostYield) => setSettings((current) => ({ ...current, opportunityCostYield }))} min={0} max={20} step="0.1" suffix="% a year" suffixPadding="pr-20!" rangeHint="Use a rate from 0 to 20%." />}
                />
              </SettingsGroup>
              <SettingsGroup fixed title="Accessibility">
                <SettingsRow
                  label="Text size"
                  description="Larger text and spacing across Fainens."
                  action={<Dropdown<TextSizePreference> ariaLabel="Text size" value={settings.textSize} onChange={(textSize) => setSettings({ ...settings, textSize })} options={[{ value: 'default', label: 'Default' }, { value: 'large', label: 'Large' }]} />}
                />
                <SettingsRow
                  inline
                  label="Reduce motion"
                  description="Turn off animations and smooth scrolling. Fainens already does this when your device asks."
                  action={<Toggle label="Reduce motion" checked={settings.reduceMotion} onChange={(reduceMotion) => setSettings({ ...settings, reduceMotion })} />}
                />
              </SettingsGroup>
            </SettingsPanel>
          )}

          {/* Accounts Tab */}
          {activeTab === 'accounts' && (
            <SettingsPanel>
              <SettingsGroup fixed title="New transaction defaults" summary="Pre-selected when you add a transaction">
                <div>
                  <SettingsRow label="Bank account" description="Where new transactions are paid from." action={<Dropdown ariaLabel="Default bank account" value={settings.defaultBankAccountId?.toString() || ''} onChange={(value) => setSettings({ ...settings, defaultBankAccountId: value ? parseInt(value) : null })} options={getAccountOptions('asset')} />} />
                  <SettingsRow label="Expense account" description="The category new expenses start in." action={<Dropdown ariaLabel="Default expense account" value={settings.defaultExpenseAccountId?.toString() || ''} onChange={(value) => setSettings({ ...settings, defaultExpenseAccountId: value ? parseInt(value) : null })} options={getAccountOptions('expense')} />} />
                  <SettingsRow label="Income account" description="The source new income starts from." action={<Dropdown ariaLabel="Default income account" value={settings.defaultIncomeAccountId?.toString() || ''} onChange={(value) => setSettings({ ...settings, defaultIncomeAccountId: value ? parseInt(value) : null })} options={getAccountOptions('revenue')} />} />
                </div>
              </SettingsGroup>
              <SettingsGroup title="Transfer fees" summary={settings.transferFeeRules.length === 0 ? 'Add a fee automatically between two accounts' : `${settings.transferFeeRules.length} account ${settings.transferFeeRules.length === 1 ? 'pair' : 'pairs'}`}>
                <div className="space-y-4">
                  <p className="text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">Added automatically whenever money moves from one account to the other.</p>
                  {settings.transferFeeRules.length > 0 && (
                    <div className={cn(LIST, 'border-y border-[var(--color-border)]')}>
                      {settings.transferFeeRules.map((rule) => (
                        <div key={`${rule.fromAccountId}-${rule.toAccountId}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{accounts.find((account) => account.id === rule.fromAccountId)?.name ?? `Account #${rule.fromAccountId}`} → {accounts.find((account) => account.id === rule.toAccountId)?.name ?? `Account #${rule.toAccountId}`}</p>
                            <p className="text-xs text-[var(--ref-on-surface-variant)]">{formatAmount(rule.feeCents, 'IDR')} · paid by {rule.payer}</p>
                          </div>
                          <Button type="button" size="sm" variant="secondary" className={cn('px-2', QUIET_DANGER)} onClick={() => removeTransferFeeRule(rule)} aria-label="Remove transfer fee"><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className={cn(INLINE_FORM, 'grid grid-cols-1 gap-3 sm:grid-cols-2')}>
                    <Dropdown label="From account" value={feeRuleFrom} onChange={setFeeRuleFrom} options={[{ value: '', label: 'Choose source…' }, ...accounts.filter((account) => account.type === 'asset' && !account.systemKey).map((account) => ({ value: String(account.id), label: account.name }))]} />
                    <Dropdown label="To account" value={feeRuleTo} onChange={setFeeRuleTo} options={[{ value: '', label: 'Choose destination…' }, ...accounts.filter((account) => account.type === 'asset' && !account.systemKey).map((account) => ({ value: String(account.id), label: account.name }))]} />
                    <SuffixInput suffix="IDR"><Input label="Fee" className={cn(NO_SPIN, 'pr-12!')} type="number" inputMode="numeric" min="0" step="1" value={feeRuleAmount} onChange={(event) => setFeeRuleAmount(event.target.value)} placeholder="e.g. 2500" /></SuffixInput>
                    <Dropdown<TransferFeePayer> label="Who pays" value={feeRulePayer} onChange={setFeeRulePayer} options={[{ value: 'sender', label: 'Sender' }, { value: 'recipient', label: 'Recipient' }]} />
                    <div className="sm:col-span-2"><Button type="button" size="sm" onClick={addTransferFeeRule} disabled={!feeRuleFrom || !feeRuleTo || !feeRuleAmount}><Plus className="h-4 w-4" aria-hidden /> Add transfer fee</Button></div>
                  </div>
                </div>
              </SettingsGroup>
            </SettingsPanel>
          )}

          {/* Agent tab */}
          {activeTab === 'agent' && (
            <SettingsPanel>
              <SettingsGroup defaultOpen title="Response style" summary={`${profile.agentTone.charAt(0).toUpperCase() + profile.agentTone.slice(1)} · ${profile.agentVerbosity.charAt(0).toUpperCase() + profile.agentVerbosity.slice(1)}`}>
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Dropdown<PersonalProfile['agentTone']> label="Tone" value={profile.agentTone} onChange={(agentTone) => setProfile((current) => ({ ...current, agentTone }))} options={[{ value: 'warm', label: 'Warm and friendly' }, { value: 'direct', label: 'Direct and practical' }, { value: 'encouraging', label: 'Encouraging and supportive' }]} />
                    <Dropdown<PersonalProfile['agentVerbosity']> label="Detail" value={profile.agentVerbosity} onChange={(agentVerbosity) => setProfile((current) => ({ ...current, agentVerbosity }))} options={[{ value: 'concise', label: 'Concise' }, { value: 'balanced', label: 'Balanced' }, { value: 'detailed', label: 'Detailed' }]} />
                  </div>
                  <Notice notice={profileNotice} />
                </div>
              </SettingsGroup>

              <SettingsGroup title="What Agent can see" summary={`${sharedContextCount} of ${AGENT_CONTEXT_OPTIONS.length} profile details shared`}>
                <SettingsRow
                  inline
                  label="Profile details"
                  description="Choose which parts of your profile Agent may use, such as your preferred name or timezone."
                  action={<Button type="button" size="sm" variant="secondary" onClick={() => { setContextError(null); setContextDraft({ ...profile.agentContext }); }}>Choose…</Button>}
                />
              </SettingsGroup>

              <SettingsGroup title="Models" summary={`${agentModels.find((model) => model.isDefault)?.name ?? 'No default model'} · ${agentModels.length} saved`}>
                <div className="space-y-4">
                    <p className="text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">OpenAI-compatible models Agent can use. API keys are encrypted and never shown again.</p>
                    {agentModels.length === 0 ? (
                      <p className={EMPTY}>No models yet. Add one to connect Agent to a provider.</p>
                    ) : (
                      <div className={cn(LIST, 'border-y border-[var(--color-border)]')}>
                        {agentModels.map((model) => (
                          <div key={model.id} className="flex items-center justify-between gap-3 py-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{model.name}</p>{model.isDefault && <span className="rounded-full bg-[var(--ref-primary)]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--ref-primary)]">Default</span>}</div>
                              <p className="mt-0.5 truncate font-mono text-xs text-[var(--ref-on-surface-variant)]">{model.model}</p>
                              <p className="truncate text-xs text-[var(--color-muted)]">{model.baseUrl.replace(/^https?:\/\//, '')} · {model.apiKeySource === 'database' ? 'saved key' : model.apiKeySource === 'environment' ? 'server key' : 'no key'}</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              {!model.isDefault && <Button type="button" size="sm" variant="secondary" onClick={() => void makeAgentModelDefault(model.id)} disabled={agentProviderBusy}>Make default</Button>}
                              <RowActions
                                title={model.name}
                                actions={[
                                  { key: 'edit', label: 'Edit model', icon: Pencil, onSelect: () => openAgentModelForm(model) },
                                  ...(model.apiKeySource === 'database' ? [{ key: 'clear-key', label: 'Clear saved key', icon: KeyRound, disabled: agentProviderBusy, onSelect: () => void clearAgentModelKey(model.id) }] : []),
                                  { key: 'delete', label: 'Delete model', icon: Trash2, tone: 'danger' as const, disabled: agentProviderBusy, onSelect: () => void removeAgentModel(model.id) },
                                ]}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <Button type="button" size="sm" variant="secondary" onClick={() => openAgentModelForm()}><Plus className="h-4 w-4" aria-hidden /> Add model</Button>
                    {!showAgentModelForm && <Notice notice={agentProviderNotice} />}
                </div>
              </SettingsGroup>

              <SettingsGroup title="Memory" summary={memories.length === 0 ? 'Nothing saved yet' : `${memories.length} saved ${memories.length === 1 ? 'memory' : 'memories'}`}>
                    <div className="space-y-3">
                    <p className="text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">Lasting preferences or background Agent brings into future chats. Memories are context only, never proof of a transaction or permission to change your data.</p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <Button type="button" size="sm" variant="secondary" onClick={openMemoryForm} disabled={memories.length >= memoryLimits.maxItems}><Plus className="h-4 w-4" aria-hidden /> Add memory</Button>
                      {memories.length >= memoryLimits.maxItems && <p className="text-xs text-[var(--color-warning)]">You have reached the {memoryLimits.maxItems}-memory limit.</p>}
                    </div>
                    {memoryError && !showMemoryForm && <p role="alert" className="text-sm text-[var(--color-danger)]">{memoryError}</p>}
                    {isLoadingMemories ? (
                      <p className={cn(EMPTY, 'flex items-center gap-2')}><RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> Loading memories…</p>
                    ) : memories.length === 0 ? (
                      <p className={EMPTY}>No memories yet. Add something Agent should keep in mind, like a goal or a habit.</p>
                    ) : (
                      <div className={cn(LIST, 'border-y border-[var(--color-border)]')}>
                        {memories.map((memory) => (
                          <div key={memory.id} className="group/memory flex items-start gap-3 py-3">
                            <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{memory.label}</p><p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">{memory.content}</p></div>
                            <RowActions
                              title={memory.label}
                              actions={[
                                { key: 'edit', label: 'Edit memory', icon: Pencil, disabled: isSavingMemory, onSelect: () => editMemory(memory) },
                                { key: 'delete', label: 'Delete memory', icon: Trash2, tone: 'danger' as const, disabled: isSavingMemory, onSelect: () => void deleteMemory(memory) },
                              ]}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
              </SettingsGroup>
            </SettingsPanel>
          )}

          {/* Backups Tab */}
          {activeTab === 'backups' && (
            <SettingsPanel>
              <SettingsGroup fixed title="Cloud database backups" summary="Integrity-checked snapshots kept in your existing storage">
                <SettingsRow
                  inline
                  label={<span className="flex items-center gap-1.5">{databaseBackup.lastBackupAt ? <CheckCircle className="h-3.5 w-3.5 shrink-0 text-[var(--color-success)]" aria-hidden /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]" aria-hidden />}{databaseBackup.lastBackupAt ? `Last backup ${formatDateTime(databaseBackup.lastBackupAt)}` : 'No backup yet'}</span>}
                  description={databaseBackup.enabled ? (databaseBackup.nextBackupAt ? `Next one due ${formatDateTime(databaseBackup.nextBackupAt)}` : 'Automatic backups are on.') : 'Automatic backups are off.'}
                  action={<Button type="button" size="sm" variant="secondary" onClick={() => void runDatabaseBackup()} disabled={databaseBackupBusy} isLoading={databaseBackupBusy}><CloudUpload className="h-4 w-4" aria-hidden /> Back up now</Button>}
                />
                <Notice notice={databaseBackupNotice} className="pt-2" />
              </SettingsGroup>
              <SettingsGroup fixed title="Schedule" summary={databaseBackup.enabled ? `Automatic, ${databaseBackup.frequency === 'biweekly' ? 'every two weeks' : databaseBackup.frequency}` : 'Off'}>
                <SettingsRow
                  inline
                  label="Automatic backups"
                  description="Take snapshots on a schedule."
                  action={<Toggle label="Automatic database backups" checked={databaseBackup.enabled} onChange={(enabled) => void saveDatabaseBackupSettings({ enabled })} disabled={databaseBackupBusy} />}
                />
                <SettingsRow
                  label="Frequency"
                  description="Checked every hour; a snapshot is taken once one is due."
                  action={<Dropdown<DatabaseBackupFrequency> ariaLabel="Database backup frequency" value={databaseBackup.frequency} onChange={(frequency) => void saveDatabaseBackupSettings({ frequency })} disabled={!databaseBackup.enabled || databaseBackupBusy} options={[{ value: 'weekly', label: 'Weekly' }, { value: 'biweekly', label: 'Every two weeks' }, { value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }]} />}
                />
              </SettingsGroup>
              <SettingsGroup title="Saved backups" summary={`${databaseBackup.pagination.total} ${databaseBackup.pagination.total === 1 ? 'snapshot' : 'snapshots'} in storage`}>
                    <div>
                      {databaseBackup.backups.length === 0 ? (
                        <p className={EMPTY}>No backups in storage yet. Use Back up now to take the first one.</p>
                      ) : (
                        <div className={cn(LIST, 'border-y border-[var(--color-border)]')}>
                          {databaseBackup.backups.map((backup) => (
                            <div key={backup.key} className="flex items-center justify-between gap-3 py-2.5">
                              <span className="min-w-0 truncate text-sm font-medium tabular-nums" title={backup.key}>{backup.createdAt ? formatDateTime(backup.createdAt) : backup.key.split('/').pop()}</span>
                              <span className="shrink-0 text-xs tabular-nums text-[var(--ref-on-surface-variant)]">{formatBytes(backup.size)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {databaseBackup.pagination.total > databaseBackup.pagination.pageSize && (
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <span className="text-xs text-[var(--color-text-secondary)]">
                            Page {databaseBackup.pagination.page} of {Math.max(1, Math.ceil(databaseBackup.pagination.total / databaseBackup.pagination.pageSize))}
                          </span>
                          <div className="flex gap-2">
                            <Button type="button" size="sm" variant="secondary" onClick={() => setBackupPage((page) => Math.max(1, page - 1))} disabled={databaseBackup.pagination.page <= 1 || databaseBackupBusy}>Previous</Button>
                            <Button type="button" size="sm" variant="secondary" onClick={() => setBackupPage((page) => page + 1)} disabled={!databaseBackup.pagination.hasNext || databaseBackupBusy}>Next</Button>
                          </div>
                        </div>
                      )}
                    </div>
              </SettingsGroup>
            </SettingsPanel>
          )}

          {/* PDF Reports Tab */}
          {activeTab === 'reports' && (
            <SettingsPanel>
              <SettingsGroup fixed title="Password protection" summary={settings.pdfPasswordEnabled ? 'On for monthly reports' : 'Off'}>
                <SettingsRow
                  inline
                  label="Password-protect monthly reports"
                  description="Encrypts each PDF (AES-256) in your browser before it downloads."
                  action={<Toggle label="Password-protect monthly reports" checked={settings.pdfPasswordEnabled} onChange={(pdfPasswordEnabled) => setSettings({ ...settings, pdfPasswordEnabled })} />}
                />
                <SettingsRow
                  inline
                  label="Birthday"
                  description={profile.dateOfBirth ? `${formatDate(new Date(`${profile.dateOfBirth}T00:00:00`).getTime())}, from your Profile` : 'Not set. Add it in Profile to use a password.'}
                  action={<Button type="button" size="sm" variant="secondary" onClick={() => setActiveTab('profile')}>{profile.dateOfBirth ? 'Edit' : 'Add'}</Button>}
                />
                <SettingsRow
                  label="Password format"
                  description="The order of your birthday’s digits."
                  action={<Dropdown<PdfPasswordFormat> ariaLabel="Password format" value={settings.pdfPasswordFormat} onChange={(pdfPasswordFormat) => setSettings({ ...settings, pdfPasswordFormat })} disabled={!settings.pdfPasswordEnabled} options={[{ value: 'DDMMYYYY', label: 'DDMMYYYY (day first)' }, { value: 'YYYYMMDD', label: 'YYYYMMDD (year first)' }]} />}
                />
                {settings.pdfPasswordEnabled && (
                  <p className={cn('mt-4 flex items-start gap-2 rounded-xl px-3.5 py-3 text-xs leading-relaxed', reportPassword ? 'bg-[var(--ref-primary)]/8 text-[var(--ref-on-surface-variant)]' : 'bg-[var(--color-danger)]/8 text-[var(--color-danger)]')}>
                    <LockKeyhole className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                    {reportPassword
                      ? `The password is your birthday in ${passwordFormatDescription(settings.pdfPasswordFormat)} format (${reportPassword.length} digits). Convenient, but easier to guess than a unique password.`
                      : 'Add a valid birthday before downloading a protected report.'}
                  </p>
                )}
              </SettingsGroup>
            </SettingsPanel>
          )}

          {/* Data tools and import/export */}
          {activeTab === 'data' && (
            <SettingsPanel>
              <SettingsGroup fixed title="Export">
                <div className="space-y-4">
                  <p className="text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">Download a copy of your data as a JSON file.</p>
                  <fieldset>
                    <legend className="sr-only">Include in export</legend>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
                      {[
                        { key: 'transactions', label: 'Transactions' },
                        { key: 'accounts', label: 'Accounts' },
                        { key: 'categories', label: 'Categories & tags' },
                        { key: 'budgets', label: 'Budgets & periods' },
                        { key: 'settings', label: 'Settings' },
                        { key: 'memories', label: 'Agent memory' },
                      ].map(({ key, label }) => (
                        <label
                          key={key}
                          className="flex cursor-pointer items-center gap-2 text-sm text-[var(--ref-on-surface)]"
                        >
                          <input
                            type="checkbox"
                            checked={exportOptions[key as keyof ExportOptions]}
                            onChange={(e) =>
                              setExportOptions({ ...exportOptions, [key]: e.target.checked })
                            }
                            className="h-4 w-4 shrink-0 accent-[var(--ref-primary)]"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={handleExport} disabled={!Object.values(exportOptions).some(Boolean)} isLoading={exportDataMutation.isPending}>
                      <Download className="mr-1.5 h-4 w-4" aria-hidden />
                      Download JSON
                    </Button>
                    {/* Import stays hidden until restoring from a file actually works. */}
                    {showExportSuccess && <Notice notice={{ tone: 'success', text: 'Export downloaded.' }} />}
                  </div>
                </div>
              </SettingsGroup>
              <SettingsGroup fixed title="This device" summary="Data Fainens keeps in this browser">
                <SettingsRow
                  inline
                  label="Clear local cache"
                  description="Reloads data from the server. Your records are not affected."
                  action={<Button size="sm" variant="secondary" onClick={() => setShowClearCacheModal(true)}>Clear</Button>}
                />
                <SettingsRow
                  inline
                  label="Clear this browser and sign out"
                  description="Removes everything Fainens keeps in this browser. Your ledger on the server is not touched."
                  action={<Button size="sm" variant="secondary" className={QUIET_DANGER} onClick={() => setShowDeleteDataModal(true)}>Clear…</Button>}
                />
              </SettingsGroup>
              <SettingsGroup fixed title="Tools" summary="Related pages">
                <div className={cn(LIST, 'border-y border-[var(--color-border)]')}>
                  {[
                    { to: '/anomalies', label: 'Data quality', description: 'Find issues and inconsistencies in your records.' },
                    { to: '/gallery', label: 'Image storage', description: 'Receipt, conversation, and wishlist images.' },
                    { to: '/audit-log', label: 'Security audit', description: 'Account activity and security events.' },
                  ].map(({ to, label, description }) => (
                    <Link key={to} to={to} className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors hover:bg-[var(--ref-surface-container-low)]">
                      <span className="min-w-0 flex-1"><span className="block font-medium text-[var(--ref-on-surface)]">{label}</span><span className="block text-xs text-[var(--ref-on-surface-variant)]">{description}</span></span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted)] transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </Link>
                  ))}
                </div>
              </SettingsGroup>
            </SettingsPanel>
          )}
        </div>

            </div>

          </main>
        </div>
      </Modal>

      {/* Dialogs opened from Settings sit beside it, not inside it: the Settings panel is transformed
          (its open animation), which would trap a fixed-position dialog inside its box and clip it. */}
      <Modal
        isOpen={contextDraft !== null}
        onClose={() => { if (!contextBusy) setContextDraft(null); }}
        title="What Agent can see"
        overlayClassName="!z-[60]"
        contentClassName="!pt-3"
        footer={<div className="flex items-center justify-between gap-3"><span className="text-xs text-[var(--ref-on-surface-variant)]">{contextDraft ? `${Object.values(contextDraft).filter(Boolean).length} of ${AGENT_CONTEXT_OPTIONS.length} shared` : ''}</span><div className="flex gap-2"><Button type="button" size="sm" variant="secondary" disabled={contextBusy} onClick={() => setContextDraft(null)}>Cancel</Button><Button type="button" size="sm" disabled={contextBusy} onClick={() => void saveAgentContext()}>{contextBusy ? 'Saving…' : 'Save'}</Button></div></div>}
      >
        {/* Small dialogs don't render a subtitle, so the intro sits at the top of the body. */}
        <p className="text-sm text-[var(--ref-on-surface-variant)]">Choose which profile details Agent may use. Your date of birth itself is never sent.</p>
        {AGENT_CONTEXT_GROUPS.map((group) => (
          <section key={group.title} className="mt-4">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ref-on-surface-variant)]">{group.title}</h3>
            <div className="divide-y divide-[var(--color-border)]">
              {group.keys.map((key) => {
                const option = AGENT_CONTEXT_OPTIONS.find((item) => item.key === key)!;
                return (
                  <div key={key} className="flex items-center justify-between gap-4 py-2.5">
                    <span className="min-w-0"><span className="block text-sm font-medium text-[var(--ref-on-surface)]">{option.label}</span><span className="mt-0.5 block text-xs text-[var(--ref-on-surface-variant)]">{option.description}</span></span>
                    <Toggle label={option.label} checked={contextDraft?.[key] ?? false} disabled={contextBusy} onChange={(checked) => setContextDraft((current) => current ? { ...current, [key]: checked } : current)} />
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        <p className="mt-4 text-xs leading-relaxed text-[var(--color-muted)]">Changes apply once saved. Other parts of Fainens still use your profile; chats and memories are managed separately.</p>
        {contextError && <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">{contextError}</p>}
      </Modal>

      <Modal
        isOpen={showAgentModelForm}
        onClose={() => { if (!agentProviderBusy) resetAgentModelDraft(); }}
        title={editingAgentModelId == null ? 'Add model' : 'Edit model'}
        overlayClassName="!z-[60]"
        footer={<div className="flex justify-end gap-2"><Button type="button" size="sm" variant="secondary" disabled={agentProviderBusy} onClick={resetAgentModelDraft}>Cancel</Button><Button type="button" size="sm" onClick={() => void saveAgentModel()} disabled={agentProviderBusy || !agentModelDraft.name.trim() || !agentModelDraft.model.trim() || !agentModelDraft.baseUrl.trim()}>{agentProviderBusy ? 'Saving…' : editingAgentModelId == null ? 'Add model' : 'Save changes'}</Button></div>}
      >
        <div className="settings-compact space-y-4">
          <Dropdown
            label="Provider"
            value={MODEL_PROVIDERS.find((provider) => provider.baseUrl === agentModelDraft.baseUrl.trim())?.value ?? 'custom'}
            onChange={(value) => {
              const preset = MODEL_PROVIDERS.find((provider) => provider.value === value);
              setAgentModelDraft((draft) => ({ ...draft, baseUrl: preset?.baseUrl ?? (MODEL_PROVIDERS.some((provider) => provider.baseUrl === draft.baseUrl.trim()) ? '' : draft.baseUrl) }));
            }}
            options={[...MODEL_PROVIDERS.map(({ value, label }) => ({ value, label })), { value: 'custom', label: 'Other OpenAI-compatible…' }]}
          />
          {!MODEL_PROVIDERS.some((provider) => provider.baseUrl === agentModelDraft.baseUrl.trim()) && (
            <Input label="Base URL" value={agentModelDraft.baseUrl} onChange={(event) => setAgentModelDraft((draft) => ({ ...draft, baseUrl: event.target.value }))} placeholder="https://example.com/v1" maxLength={500} />
          )}
          <div className="space-y-1">
            <Input label="Model ID" value={agentModelDraft.model} onChange={(event) => setAgentModelDraft((draft) => ({ ...draft, model: event.target.value, name: draft.name === draft.model ? event.target.value : draft.name }))} placeholder="e.g. z-ai/glm-5.3-flash" maxLength={200} />
            <p className="text-xs text-[var(--color-muted)]">Exactly as your provider lists it.</p>
          </div>
          <div className="space-y-1">
            <Input label="Name" value={agentModelDraft.name} onChange={(event) => setAgentModelDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="e.g. Fast daily model" maxLength={120} />
            <p className="text-xs text-[var(--color-muted)]">What you’ll see in Fainens.</p>
          </div>
          <div className="space-y-1">
            <label htmlFor="agent-model-api-key" className="block text-sm font-medium text-[var(--color-text-secondary)]">API key <span className="font-normal text-[var(--color-muted)]">(optional)</span></label>
            <input id="agent-model-api-key" type="password" value={agentModelDraft.apiKey} onChange={(event) => setAgentModelDraft((draft) => ({ ...draft, apiKey: event.target.value }))} placeholder={editingAgentModelId == null ? 'Leave blank to use the server’s key' : 'Leave blank to keep the saved key'} autoComplete="new-password" className="brutalist-input" />
            <p className="text-xs text-[var(--color-muted)]">Encrypted when saved and never shown again.</p>
          </div>
          {agentProviderNotice?.tone === 'error' && <Notice notice={agentProviderNotice} />}
        </div>
      </Modal>

      <Modal
        isOpen={showMemoryForm}
        onClose={() => { if (!isSavingMemory) resetMemoryForm(); }}
        title={editingMemoryId == null ? 'Add memory' : 'Edit memory'}
        overlayClassName="!z-[60]"
        footer={<div className="flex justify-end gap-2"><Button type="button" size="sm" variant="secondary" disabled={isSavingMemory} onClick={resetMemoryForm}>Cancel</Button><Button type="submit" form="agent-memory-form" size="sm" isLoading={isSavingMemory} disabled={!memoryLabel.trim() || !memoryContent.trim()}>{editingMemoryId == null ? 'Add memory' : 'Save changes'}</Button></div>}
      >
        <form id="agent-memory-form" className="settings-compact space-y-4" onSubmit={(event) => void saveMemory(event)}>
          <p className="text-sm text-[var(--ref-on-surface-variant)]">Something Agent should keep in mind in every chat, like a goal, a habit, or how you like advice.</p>
          <Input label="Name" value={memoryLabel} onChange={(event) => setMemoryLabel(event.target.value)} placeholder="e.g. Saving for a house" maxLength={memoryLimits.maxLabelLength} />
          <div className="space-y-1">
            <label htmlFor="agent-memory-content" className="block text-sm font-medium text-[var(--color-text-secondary)]">What should Agent remember?</label>
            <textarea id="agent-memory-content" value={memoryContent} onChange={(event) => setMemoryContent(event.target.value)} placeholder="e.g. I’m saving for a down payment by 2028 and prefer conservative suggestions." maxLength={memoryLimits.maxContentLength} rows={5} className="brutalist-input min-h-28 w-full resize-y" />
            <p className="text-right text-xs tabular-nums text-[var(--color-muted)]">{memoryContent.length}/{memoryLimits.maxContentLength}</p>
          </div>
          {memoryError && <p role="alert" className="text-sm text-[var(--color-danger)]">{memoryError}</p>}
        </form>
      </Modal>

      <Modal
        isOpen={showClearCacheModal}
        onClose={() => setShowClearCacheModal(false)}
        title="Clear local cache?"
        overlayClassName="!z-[60]"
        footer={<div className="flex justify-end gap-2"><Button type="button" size="sm" variant="secondary" onClick={() => setShowClearCacheModal(false)}>Cancel</Button><Button type="button" size="sm" onClick={handleClearCache}>Clear cache</Button></div>}
      >
        <p className="text-sm leading-relaxed text-[var(--ref-on-surface-variant)]">Fainens will reload your data from the server. You won’t lose any transactions or accounts.</p>
      </Modal>

      <Modal
        isOpen={showDeleteDataModal}
        onClose={() => setShowDeleteDataModal(false)}
        title="Clear this browser and sign out?"
        overlayClassName="!z-[60]"
        footer={<div className="flex justify-end gap-2"><Button type="button" size="sm" variant="secondary" onClick={() => setShowDeleteDataModal(false)}>Cancel</Button><Button type="button" size="sm" variant="danger" onClick={handleDeleteAllData}>Clear and sign out</Button></div>}
      >
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-[var(--ref-on-surface-variant)]">Everything Fainens keeps in this browser is removed, including the settings on this page, and you are signed out. Your transactions, accounts, and budgets stay safe on the server.</p>
          <p className="flex items-center gap-2 rounded-xl bg-[var(--color-danger)]/8 px-3.5 py-3 text-sm font-medium text-[var(--color-danger)]">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            Browser-only settings can’t be recovered.
          </p>
        </div>
      </Modal>
    </RequireAuth>
  );
}
