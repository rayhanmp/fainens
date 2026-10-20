import { useState, type CSSProperties } from 'react';
import { Plus } from 'lucide-react';
import { ActivityPanel, type RecentTransaction } from '../dashboard/ActivityPanel';
import '../dashboard/dashboard.css';
import { AccentPicker, Dropdown, SettingsRow, ThemeSwitch, type ThemeChoice } from '../settings/controls';
import { Button } from '../../components/ui/Button';
import { formatCurrency, type AccentColorPreference, type TextSizePreference } from '../../lib/utils';
import { maskCurrencyAmounts } from '../../lib/balance-visibility';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { VisualFrame } from './visuals';

/**
 * Settings → General, with its real controls, beside a preview that takes the choices: the app's
 * own dark theme and accent palettes, applied to a real Dashboard panel. Local to this page.
 */

/** Each palette's accent tokens, light and dark, as defined in index.css. */
const PALETTES: Record<AccentColorPreference, { light: string[]; dark: string[] }> = {
  blue: { light: ['#0056d2', '#0040a1', '#0040a1', '#0056d2'], dark: ['#3b82f6', '#60a5fa', '#60a5fa', '#3b82f6'] },
  violet: { light: ['#6d28d9', '#5b21b6', '#5b21b6', '#6d28d9'], dark: ['#8b5cf6', '#a78bfa', '#a78bfa', '#8b5cf6'] },
  teal: { light: ['#0f766e', '#115e59', '#115e59', '#0f766e'], dark: ['#0d9488', '#2dd4bf', '#2dd4bf', '#0d9488'] },
  rose: { light: ['#be123c', '#9f1239', '#9f1239', '#be123c'], dark: ['#e11d48', '#fb7185', '#fb7185', '#e11d48'] },
  orange: { light: ['#c2410c', '#9a3412', '#9a3412', '#c2410c'], dark: ['#ea580c', '#fb923c', '#fb923c', '#ea580c'] },
  graphite: { light: ['#334155', '#1e293b', '#1e293b', '#334155'], dark: ['#64748b', '#94a3b8', '#cbd5e1', '#64748b'] },
};

const SAMPLE: RecentTransaction[] = [
  { id: 1, date: Date.now() - 2 * 3_600_000, description: 'Kopi susu', categoryId: 1, expenseCents: 25_000 },
  { id: 2, date: Date.now() - 5 * 3_600_000, description: 'Grab to office', categoryId: 2, expenseCents: 32_000 },
  { id: 3, date: Date.now() - 86_400_000, description: 'Salary', incomeCents: 10_000_000 },
];
const CATEGORIES = [{ id: 1, name: 'Food & Dining', color: '#f97316' }, { id: 2, name: 'Transportation', color: '#0ea5e9' }];

export function SettingsPreviewDemo() {
  const { balancesHidden } = useBalanceVisibility();
  const [theme, setTheme] = useState<ThemeChoice>('light');
  const [accent, setAccent] = useState<AccentColorPreference>('blue');
  const [textSize, setTextSize] = useState<TextSizePreference>('default');
  const [now] = useState(() => Date.now());
  const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [colorAccent, accentHover, primary, primaryContainer] = PALETTES[accent][dark ? 'dark' : 'light'];
  const tokens = { '--color-accent': colorAccent, '--color-accent-hover': accentHover, '--ref-primary': primary, '--ref-primary-container': primaryContainer } as CSSProperties;
  const formatAmount = (value: number) => (balancesHidden ? '••••••' : formatCurrency(value));

  return (
    <VisualFrame caption="Settings’ own controls, applied to a real Dashboard panel. A preview only: your settings don’t change.">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center">
        <div className="rounded-2xl bg-[var(--color-surface)] p-5 ring-1 ring-[var(--color-border)]">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ref-on-surface-variant)]">Display</h2>
          <SettingsRow label="Theme" description="Light, dark, or match your device." wideControl action={<ThemeSwitch value={theme} onChange={setTheme} />} />
          <SettingsRow label="Accent colour" description="Buttons, links, and highlights." action={<AccentPicker value={accent} onChange={setAccent} />} />
          <SettingsRow label="Text size" description="Larger text and spacing across Fainens." action={<Dropdown<TextSizePreference> ariaLabel="Text size" value={textSize} onChange={setTextSize} options={[{ value: 'default', label: 'Default' }, { value: 'large', label: 'Large' }]} />} />
        </div>
        <div className={dark ? 'dark' : undefined} style={tokens}>
          <div className="rounded-2xl bg-[var(--color-background)] p-4 transition-colors duration-300" style={{ zoom: textSize === 'large' ? 1.125 : 1 }}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--ref-secondary)]">Decision centre</p>
              <Button size="sm" tabIndex={-1} className="pointer-events-none"><Plus className="h-4 w-4" /> Add transaction</Button>
            </div>
            <div className="dashboard-page pointer-events-none">
              <ActivityPanel transactions={SAMPLE} categories={CATEGORIES} compact now={now} formatAmount={formatAmount} maskAmounts={(text) => (balancesHidden ? maskCurrencyAmounts(text) : text)} />
            </div>
          </div>
        </div>
      </div>
    </VisualFrame>
  );
}
