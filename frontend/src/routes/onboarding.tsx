import { createFileRoute, redirect, useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { fetchOnboardingStatus } from '../lib/onboarding-status';
import { getCurrentUser } from '../generated/client';
import { useCategoriesQuery, useCreateCategoryMutation } from '../features/categories/queries';
import { useCreateAccountMutation } from '../features/accounts/queries';
import { useCreateBudgetMutation } from '../features/budgets/queries';
import { useCreatePeriodMutation, useSuggestedPeriodQuery } from '../features/periods/queries';
import { useUpdateSalarySettingsMutation } from '../features/salary/queries';
import { useOnboardingForm } from '../features/onboarding/controller';
import {
  Wallet,
  Tag,
  Calendar,
  PiggyBank,
  PartyPopper,
  ChevronLeft,
  ChevronRight,
  Check,
  Loader2,
  BarChart3,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  ArrowUpRight,
  ChevronDown,
} from 'lucide-react';

const TOTAL_STEPS = 7;

const STEP_LABELS = ['Welcome', 'Wallets', 'Categories', 'Pay period', 'Budget', 'Preferences', 'Done'];

const CURRENCY_OPTIONS = [
  { value: 'IDR', label: 'Rp · Indonesian Rupiah' },
  { value: 'USD', label: '$ · US Dollar' },
  { value: 'SGD', label: 'S$ · Singapore Dollar' },
  { value: 'MYR', label: 'RM · Malaysian Ringgit' },
];

const DATE_FORMAT_OPTIONS = [
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY · 31/12/2026' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY · 12/31/2026' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD · 2026-12-31' },
  { value: 'DD MMM YYYY', label: 'DD MMM YYYY · 31 Dec 2026' },
];

const WALLET_PRESETS: Array<{ name: string; icon: string }> = [
  { name: 'Cash', icon: '💵' },
  { name: 'BCA', icon: '🏦' },
  { name: 'Mandiri', icon: '🏦' },
  { name: 'GoPay', icon: '📱' },
  { name: 'OVO', icon: '📱' },
  { name: 'DANA', icon: '📱' },
];

const CATEGORY_PRESETS: Array<{ name: string; icon: string }> = [
  { name: 'Food & Dining', icon: '🍽️' },
  { name: 'Transportation', icon: '🚗' },
  { name: 'Shopping', icon: '🛍️' },
  { name: 'Bills & Utilities', icon: '💡' },
  { name: 'Entertainment', icon: '🎬' },
  { name: 'Healthcare', icon: '🏥' },
];

function isOnboardingPreview(search?: { preview?: unknown }) {
  if (!import.meta.env.DEV) return false;

  const previewValue = search?.preview;
  return previewValue === true
    || previewValue === '1'
    || previewValue === 1
    || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === '1');
}

export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
  validateSearch: (search: Record<string, unknown>) => ({
    preview: search.preview === '1' || search.preview === true || search.preview === 1,
  }),
  beforeLoad: async ({ search }: { search: { preview?: unknown } }) => {
    const me = await getCurrentUser();
    if (me.status !== 200) {
      throw redirect({ to: '/login' });
    }
    const status = await fetchOnboardingStatus();
    // Use the URL as a fallback: beforeLoad can run before validated search is
    // available during a client-side navigation.
    const isPreview = isOnboardingPreview(search as { preview?: unknown });
    if (status && !status.needsOnboarding && !isPreview) {
      throw redirect({ to: '/' });
    }
  },
} as any);

function OnboardingPage() {
  const search = useSearch({ from: '/onboarding' }) as { preview?: boolean };
  const isPreview = isOnboardingPreview(search);
  const navigate = useNavigate();
  const categoriesQuery = useCategoriesQuery();
  const suggestedPeriodQuery = useSuggestedPeriodQuery();
  const createCategoryMutation = useCreateCategoryMutation();
  const createAccountMutation = useCreateAccountMutation();
  const createBudgetMutation = useCreateBudgetMutation();
  const createPeriodMutation = useCreatePeriodMutation();
  const updateSalarySettingsMutation = useUpdateSalarySettingsMutation();
  const onboardingForm = useOnboardingForm();
  const { values, setField, toggleWallet, addCustomWallet, setBudget } = onboardingForm;
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewCategories, setPreviewCategories] = useState<Array<{ id: number; name: string }>>([]);
  const [preferences, setPreferences] = useState({ currency: 'IDR', dateFormat: 'DD/MM/YYYY', payrollDay: 25 });

  const [createdPeriodId, setCreatedPeriodId] = useState<number | null>(null);

  const categories = [...(categoriesQuery.data ?? []), ...previewCategories];
  const selectedWallets = new Set(values.selectedWallets);

  useEffect(() => {
    if (values.periodName || values.periodStart || values.periodEnd) return;
    const suggestion = suggestedPeriodQuery.data;
    if (suggestion) {
      setField('periodName', suggestion.suggestedName);
      setField('periodStart', suggestion.suggestedStartDate.slice(0, 10));
      setField('periodEnd', suggestion.suggestedEndDate.slice(0, 10));
      return;
    }
    if (!suggestedPeriodQuery.isError) return;
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    setField('periodName', `${today.toLocaleString('default', { month: 'long' })} ${today.getFullYear()}`);
    setField('periodStart', start.toISOString().slice(0, 10));
    setField('periodEnd', end.toISOString().slice(0, 10));
  }, [setField, suggestedPeriodQuery.data, suggestedPeriodQuery.isError, values.periodEnd, values.periodName, values.periodStart]);

  const addCustomCategory = async () => {
    const n = values.newCategoryName.trim();
    if (!n) return;
    if (isPreview) {
      setPreviewCategories((current) => [...current, { id: -(current.length + 1), name: n }]);
      setField('newCategoryName', '');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await createCategoryMutation.mutateAsync({ name: n });
      setField('newCategoryName', '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add category');
    } finally {
      setLoading(false);
    }
  };

  const goNext = useCallback(async () => {
    setError(null);

    if (step === 2) {
      if (selectedWallets.size === 0) {
        setError('Pick at least one wallet, or skip to add them later in Accounts.');
        return;
      }
      if (!isPreview) {
        setLoading(true);
        try {
          for (const name of selectedWallets) {
            await createAccountMutation.mutateAsync({
              name,
              type: 'asset',
            });
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Could not create wallets');
          setLoading(false);
          return;
        }
        setLoading(false);
      }
    }

    if (step === 4) {
      if (!values.periodName.trim() || !values.periodStart || !values.periodEnd) {
        setError('Please fill in period name and dates.');
        return;
      }
      if (isPreview) {
        setCreatedPeriodId(-1);
      } else {
        setLoading(true);
        try {
          const period = await createPeriodMutation.mutateAsync({
            name: values.periodName.trim(),
            startDate: values.periodStart,
            endDate: values.periodEnd,
          });
          setCreatedPeriodId(period.id);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Could not create period');
          setLoading(false);
          return;
        }
        setLoading(false);
      }
    }

    if (step === 5 && createdPeriodId != null && !isPreview) {
      const entries = Object.entries(values.budgets).filter(([, v]) => v.trim() !== '');
      if (entries.length > 0) {
        setLoading(true);
        try {
          for (const [catId, raw] of entries) {
            const rupiah = Math.round(parseFloat(raw.replace(/,/g, '')));
            if (!Number.isFinite(rupiah) || rupiah <= 0) continue;
            await createBudgetMutation.mutateAsync({
              periodId: createdPeriodId,
              categoryId: Number(catId),
              plannedAmount: rupiah,
            });
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Could not save budgets');
          setLoading(false);
          return;
        }
        setLoading(false);
      }
    }

    if (step === 6 && !isPreview) {
      setLoading(true);
      try {
        const saved = localStorage.getItem('fainens-settings');
        const existing = saved ? JSON.parse(saved) as Record<string, unknown> : {};
        localStorage.setItem('fainens-settings', JSON.stringify({
          ...existing,
          currency: preferences.currency,
          dateFormat: preferences.dateFormat,
          salaryDay: preferences.payrollDay,
        }));
        // Keep the payroll engine aligned with the payday shown in Settings.
        await updateSalarySettingsMutation.mutateAsync({ payrollDay: preferences.payrollDay });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save preferences');
        setLoading(false);
        return;
      }
      setLoading(false);
    }

    if (step === TOTAL_STEPS) {
      navigate({ to: '/' });
      return;
    }

    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }, [
    step,
    selectedWallets,
    values,
    createdPeriodId,
    isPreview,
    navigate,
    createAccountMutation,
    createBudgetMutation,
    createCategoryMutation,
    createPeriodMutation,
    preferences,
    updateSalarySettingsMutation,
  ]);

  const goBack = () => {
    setError(null);
    setStep((s) => Math.max(1, s - 1));
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--color-background)] text-[var(--color-text-primary)] font-sans antialiased">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            'radial-gradient(circle at 8% 5%, rgba(204, 216, 255, 0.6), transparent 34%), radial-gradient(circle at 92% 0%, rgba(156, 239, 222, 0.3), transparent 28%)',
        }}
      />

      <div className="relative mx-auto max-w-6xl px-5 py-7 sm:px-8 sm:py-10">
        <header className="mb-10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--ref-primary)] text-lg font-bold text-white shadow-[var(--shadow-sm)]">
              F
            </div>
            <div>
              <p className="font-headline text-base font-bold tracking-tight text-[var(--color-text-primary)]">Fainens</p>
              <p className="text-xs text-[var(--color-muted)]">Personal finance</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-muted)]">
            {isPreview && <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-800">Preview only</span>}
            <span className="hidden rounded-full border border-[var(--color-border)] bg-white/70 px-3 py-1.5 sm:inline-flex">Setup {step} of {TOTAL_STEPS}</span>
          </div>
        </header>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] lg:items-start lg:gap-14">
          <aside className="hidden pt-8 lg:block">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-[var(--ref-secondary)]">Let’s get started</p>
            <h1 className="max-w-md font-headline text-4xl font-extrabold leading-tight tracking-[-0.04em] text-[var(--color-text-primary)]">
              Build a calmer money routine.
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-[var(--color-text-secondary)]">
              A few thoughtful defaults are all it takes to make your dashboard useful from the first day.
            </p>

            <ol className="mt-10 space-y-1">
              {STEP_LABELS.map((label, index) => {
                const itemStep = index + 1;
                const active = itemStep === step;
                const complete = itemStep < step;
                return (
                  <li key={label} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${active ? 'bg-white text-[var(--ref-primary)] shadow-[var(--shadow-sm)]' : 'text-[var(--color-muted)]'}`}>
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${complete ? 'bg-[var(--ref-secondary-container)] text-[var(--ref-on-secondary-container)]' : active ? 'bg-[var(--ref-primary)] text-white' : 'border border-[var(--color-border-strong)] bg-white/50'}`}>
                      {complete ? <Check className="h-4 w-4" /> : itemStep}
                    </span>
                    <span className={active ? 'font-semibold' : ''}>{label}</span>
                  </li>
                );
              })}
            </ol>

            <SetupSummary
              wallets={Array.from(selectedWallets)}
              periodName={values.periodName}
              payrollDay={preferences.payrollDay}
              budgetCount={Object.values(values.budgets).filter(Boolean).length}
            />

            <div className="mt-4 flex max-w-md items-start gap-3 px-1 text-[var(--color-muted)]">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              <p className="text-xs leading-relaxed">Private by design. Your setup stays in your account and can be changed anytime.</p>
            </div>
          </aside>

          <main className="min-w-0">
            <div className="mb-5 flex items-center justify-between text-xs font-semibold text-[var(--color-muted)] lg:hidden">
              <span>Step {step} of {TOTAL_STEPS}</span>
              <span>{STEP_LABELS[step - 1]}</span>
            </div>
            <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)] lg:hidden">
              <div className="h-full rounded-full bg-[var(--ref-primary)] transition-all duration-300" style={{ width: `${(step / TOTAL_STEPS) * 100}%` }} />
            </div>

            <div className="rounded-3xl border border-[var(--color-border)] bg-white/95 p-6 shadow-[0_20px_60px_-24px_rgba(15,23,42,0.25)] backdrop-blur-md sm:p-10">
              {isPreview && <div className="mb-8 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm leading-relaxed text-amber-900"><span className="mt-0.5" aria-hidden>◌</span><p><strong>Preview mode</strong><br /><span className="text-amber-800/80">Explore every step safely. Nothing you enter here will be saved.</span></p></div>}
          {step === 1 && (
            <StepWelcome />
          )}
          {step === 2 && (
            <StepWallets
              presets={WALLET_PRESETS}
              selected={selectedWallets}
              onToggle={toggleWallet}
              customName={values.customWalletName}
              onCustomChange={(value) => setField('customWalletName', value)}
              onAddCustom={addCustomWallet}
            />
          )}
          {step === 3 && (
            <StepCategories
              presets={CATEGORY_PRESETS}
              categories={categories}
              newName={values.newCategoryName}
              onNewChange={(value) => setField('newCategoryName', value)}
              onAdd={addCustomCategory}
            />
          )}
          {step === 4 && (
            <StepPeriod
              name={values.periodName}
              start={values.periodStart}
              end={values.periodEnd}
              onName={(value) => setField('periodName', value)}
              onStart={(value) => setField('periodStart', value)}
              onEnd={(value) => setField('periodEnd', value)}
            />
          )}
          {step === 5 && (
            <StepBudget
              categories={categories}
              budgets={values.budgets}
              onBudgetChange={setBudget}
            />
          )}
          {step === 6 && (
            <StepPreferences
              currency={preferences.currency}
              dateFormat={preferences.dateFormat}
              payrollDay={preferences.payrollDay}
              onCurrency={(currency) => setPreferences((current) => ({ ...current, currency }))}
              onDateFormat={(dateFormat) => setPreferences((current) => ({ ...current, dateFormat }))}
              onPayrollDay={(payrollDay) => setPreferences((current) => ({ ...current, payrollDay }))}
            />
          )}
          {step === 7 && <StepDone />}

          {error && (
            <p className="mt-4 text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <div className="mt-10 flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-6">
            <button
              type="button"
              onClick={goBack}
              disabled={step === 1 || loading}
              className="brutalist-button brutalist-button--secondary cursor-pointer disabled:cursor-not-allowed rounded-xl px-4 py-2.5 text-sm disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={loading}
              className="brutalist-button cursor-pointer disabled:cursor-not-allowed min-w-[132px] rounded-xl px-5 py-2.5 text-sm disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : step === TOTAL_STEPS ? (
                'Go to dashboard'
              ) : (
                <>
                  Next
                  <ChevronRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>

          {step === 2 && (
            <button
              type="button"
              className="mt-4 w-full cursor-pointer text-center text-xs font-semibold text-[var(--color-muted)] underline-offset-2 transition hover:text-[var(--ref-primary)] hover:underline"
              disabled={loading}
              onClick={async () => {
                setError(null);
                if (isPreview) {
                  setStep(3);
                  return;
                }
                setLoading(true);
                try {
                  const names =
                    selectedWallets.size === 0
                      ? ['Cash']
                      : Array.from(selectedWallets);
                  for (const name of names) {
                    await createAccountMutation.mutateAsync({
                      name,
                      type: 'asset',
                    });
                  }
                  setStep(3);
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Could not skip this step');
                } finally {
                  setLoading(false);
                }
              }}
            >
              Skip for now — I’ll add wallets later
            </button>
          )}
            </div>
          </main>
        </div>

        <footer className="mt-10 text-center text-xs text-[var(--color-muted)]">You can revisit these choices anytime from Settings.</footer>
      </div>
    </div>
  );
}

function formatOrdinal(value: number) {
  const suffix = value % 100 >= 11 && value % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[value % 10] ?? 'th';
  return `${value}${suffix}`;
}

function SetupSummary(props: { wallets: string[]; periodName: string; payrollDay: number; budgetCount: number }) {
  const valueOrFallback = (value: string, fallback: string) => value.trim() || fallback;
  return (
    <div className="mt-8 max-w-md rounded-2xl bg-white/75 p-4 shadow-[var(--shadow-sm)] ring-1 ring-[var(--color-border)]/70">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-muted)]">Your setup</p>
        <Sparkles className="h-4 w-4 text-[var(--ref-secondary)]" />
      </div>
      <dl className="mt-3 space-y-2.5 text-xs">
        <div className="flex items-center justify-between gap-4"><dt className="text-[var(--color-muted)]">Wallets</dt><dd className="max-w-[12rem] truncate text-right font-semibold text-[var(--color-text-primary)]">{props.wallets.length ? props.wallets.join(', ') : 'Not chosen yet'}</dd></div>
        <div className="flex items-center justify-between gap-4"><dt className="text-[var(--color-muted)]">Pay period</dt><dd className="max-w-[12rem] truncate text-right font-semibold text-[var(--color-text-primary)]">{valueOrFallback(props.periodName, 'Not named yet')}</dd></div>
        <div className="flex items-center justify-between gap-4"><dt className="text-[var(--color-muted)]">Payday</dt><dd className="font-semibold text-[var(--color-text-primary)]">{formatOrdinal(props.payrollDay)} each month</dd></div>
        <div className="flex items-center justify-between gap-4"><dt className="text-[var(--color-muted)]">Budgets</dt><dd className="font-semibold text-[var(--color-text-primary)]">{props.budgetCount ? `${props.budgetCount} added` : 'Optional'}</dd></div>
      </dl>
    </div>
  );
}

function StepWelcome() {
  return (
    <div className="sm:px-2 sm:py-2">
      <div className="text-center">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ref-secondary)]">A better starting point</p>
        <h1 className="mt-3 font-headline text-3xl font-extrabold tracking-tight text-[var(--color-text-primary)]">
          Welcome to Fainens
        </h1>
        <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-[var(--color-text-secondary)]">
          Let’s set up your finances in under a minute. We’ll add your wallets, align
          categories, and start your first pay period so the dashboard feels right
          from day one.
        </p>
      </div>
      <MiniFeatureDemo />
    </div>
  );
}

type DemoTab = 'track' | 'plan' | 'ask';

function MiniFeatureDemo() {
  const [tab, setTab] = useState<DemoTab>('track');
  const [expanded, setExpanded] = useState(false);
  const [budget, setBudget] = useState(1800000);
  const [question, setQuestion] = useState('Where did I spend most?');

  const budgetSpent = 1240000;
  const budgetPercent = Math.round((budgetSpent / budget) * 100);
  const overBudget = budgetPercent > 100;

  return (
    <section className="mt-10 border-t border-[var(--color-border)] pt-8 text-left" aria-label="Fainens feature preview">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold text-[var(--color-text-primary)]"><Sparkles className="h-4 w-4 text-[var(--ref-secondary)]" /> See it in action</p>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">A tiny tour with sample data — nothing here is saved.</p>
        </div>
        <span className="rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">Sample workspace</span>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-1 rounded-2xl bg-white/70 p-1">
        {([
          ['track', 'Track', BarChart3],
          ['plan', 'Plan', PiggyBank],
          ['ask', 'Ask', MessageCircle],
        ] as const).map(([value, label, Icon]) => (
          <button key={value} type="button" onClick={() => setTab(value)} aria-pressed={tab === value} className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-bold transition ${tab === value ? 'bg-[var(--ref-primary)] text-white shadow-[var(--shadow-sm)]' : 'text-[var(--color-muted)] hover:bg-white hover:text-[var(--color-text-primary)]'}`}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      {tab === 'track' && (
        <div className="mt-4 rounded-2xl bg-white/75 p-5 ring-1 ring-[var(--color-border)]/70">
          <div className="flex items-end justify-between gap-3">
            <div><p className="text-xs font-semibold text-[var(--color-muted)]">September snapshot</p><p className="mt-1 text-4xl font-extrabold tracking-[-0.04em] text-[var(--color-text-primary)]">Rp 2.480.000</p></div>
            <span className="mb-1 flex items-center gap-1 text-xs font-bold text-emerald-700"><ArrowUpRight className="h-3.5 w-3.5" /> 12% less</span>
          </div>
          <div className="mt-4 space-y-2">
            {[['Food & Dining', 'Rp 1.240.000', '50%'], ['Transport', 'Rp 680.000', '27%'], ['Shopping', 'Rp 560.000', '23%']].map(([name, amount, width]) => <div key={name}><div className="mb-1 flex justify-between text-[11px]"><span className="font-semibold text-[var(--color-text-secondary)]">{name}</span><span className="font-bold text-[var(--color-text-primary)]">{amount}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]"><div className="h-full rounded-full bg-[var(--ref-primary)]" style={{ width }} /></div></div>)}
          </div>
          <button type="button" onClick={() => setExpanded((value) => !value)} className="mt-4 flex w-full cursor-pointer items-center justify-between border-t border-[var(--color-border)] pt-3 text-xs font-bold text-[var(--ref-primary)]"><span>{expanded ? 'Hide sample transaction' : 'Inspect a transaction'}</span><ChevronDown className={`h-4 w-4 transition ${expanded ? 'rotate-180' : ''}`} /></button>
          {expanded && <div className="mt-3 rounded-xl bg-[var(--ref-surface-container-low)] px-3 py-2.5 text-xs"><div className="flex justify-between font-semibold"><span>Yesterday · Kopi Senja</span><span>−Rp 48.000</span></div><p className="mt-1 text-[var(--color-muted)]">Food & Dining · BCA · receipt attached</p></div>}
        </div>
      )}

      {tab === 'plan' && (
        <div className="mt-4 rounded-2xl bg-white/75 p-5 ring-1 ring-[var(--color-border)]/70">
          <div className="flex items-center justify-between"><div><p className="text-xs font-semibold text-[var(--color-muted)]">Food budget</p><p className="mt-1 text-4xl font-extrabold tracking-[-0.04em] text-[var(--color-text-primary)]">Rp {budget.toLocaleString('id-ID')}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${overBudget ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{overBudget ? 'Over budget' : 'On track'}</span></div>
          <div className="mt-4 flex items-center justify-between text-[11px] font-semibold text-[var(--color-text-secondary)]"><span>Spent Rp 1.240.000</span><span>{budgetPercent}% used</span></div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]"><div className={`h-full rounded-full ${overBudget ? 'bg-rose-500' : 'bg-[var(--ref-secondary)]'}`} style={{ width: `${Math.min(100, budgetPercent)}%` }} /></div>
          <label className="mt-4 block text-[11px] font-semibold text-[var(--color-muted)]">Drag to try a different plan<input aria-label="Sample food budget" type="range" min="1400000" max="3000000" step="50000" value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="mt-2 w-full accent-[var(--ref-primary)]" /></label>
          <p className="mt-3 rounded-xl bg-[var(--ref-surface-container-low)] px-3 py-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">Fainens turns a target into a simple signal: what’s safe to spend and where you’re drifting.</p>
        </div>
      )}

      {tab === 'ask' && (
        <div className="mt-4 rounded-2xl bg-white/75 p-5 ring-1 ring-[var(--color-border)]/70">
          <p className="text-xs font-semibold text-[var(--color-muted)]">Ask your money assistant</p>
          <div className="mt-3 flex flex-wrap gap-2">{['Where did I spend most?', 'Can I afford a Rp 500k dinner?', 'Show my biggest purchase'].map((item) => <button key={item} type="button" onClick={() => setQuestion(item)} className={`cursor-pointer rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition ${question === item ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)] text-white' : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--ref-primary)]'}`}>{item}</button>)}</div>
          <div className="mt-4 rounded-xl bg-[var(--ref-primary)]/[0.06] p-3"><p className="text-[11px] font-bold text-[var(--ref-primary)]">You asked</p><p className="mt-1 text-xs font-semibold text-[var(--color-text-primary)]">{question}</p><p className="mt-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">Food & Dining is your largest category at Rp 1.240.000, about half of this month’s spending. Your pace is lower than last month.</p></div>
        </div>
      )}

      <div className="mt-4 flex items-start gap-2 text-[11px] leading-relaxed text-[var(--color-muted)]"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" /><span>Your real data stays private. This preview is only here to show how the app feels.</span></div>
    </section>
  );
}

function StepWallets(props: {
  presets: Array<{ name: string; icon: string }>;
  selected: Set<string>;
  onToggle: (name: string) => void;
  customName: string;
  onCustomChange: (v: string) => void;
  onAddCustom: () => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-3 text-[var(--color-text-primary)]">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--ref-primary)] text-white"><Wallet className="h-5 w-5" /></span>
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ref-secondary)]">Step 2</p><h2 className="font-headline text-2xl font-extrabold">Your wallets</h2></div>
      </div>
      <p className="mb-7 max-w-lg text-sm leading-relaxed text-[var(--color-text-secondary)]">
        Tap the accounts you use. Bank accounts, cash, and e-wallets can all live together in one clear balance.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {props.presets.map((p) => {
          const on = props.selected.has(p.name);
          return (
            <button
              key={p.name}
              type="button"
              onClick={() => props.onToggle(p.name)}
              aria-pressed={on}
              className={`group cursor-pointer flex min-h-20 flex-col items-start justify-between rounded-2xl border p-3.5 text-left text-sm font-semibold transition ${
                on
                  ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)]/[0.07] text-[var(--ref-primary)] shadow-[var(--shadow-sm)]'
                  : 'border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] text-[var(--color-text-primary)] hover:-translate-y-0.5 hover:border-[var(--ref-primary)] hover:shadow-[var(--shadow-sm)]'
              }`}
            >
              <span className="flex w-full items-start justify-between"><span className={`text-xl ${on ? '' : 'grayscale transition group-hover:grayscale-0'}`}>{p.icon}</span>{on && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--ref-primary)] text-white"><Check className="h-3 w-3" /></span>}</span>
              <span>{p.name}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-7 flex gap-2 rounded-2xl border border-dashed border-[var(--color-border-strong)] bg-[var(--ref-surface-container-low)] p-3">
        <input
          value={props.customName}
          onChange={(e) => props.onCustomChange(e.target.value)}
          placeholder="Custom wallet name"
          className="brutalist-input flex-1 border-transparent bg-white/80 px-4 py-2.5 text-sm placeholder:text-[var(--color-muted)] focus:border-[var(--ref-primary)] focus:bg-white focus:ring-4 focus:ring-[var(--ref-primary)]/10"
          onKeyDown={(e) => e.key === 'Enter' && props.onAddCustom()}
        />
        <button
          type="button"
          onClick={props.onAddCustom}
          className="brutalist-button brutalist-button--secondary cursor-pointer rounded-xl px-4 py-2.5 text-sm"
        >
          Add
        </button>
      </div>
      <p className="mt-3 px-1 text-[11px] leading-relaxed text-[var(--color-muted)]">You can connect or reconcile balances later. This first choice only helps your dashboard speak your language.</p>
    </div>
  );
}

function StepCategories(props: {
  presets: Array<{ name: string; icon: string }>;
  categories: Array<{ id: number; name: string }>;
  newName: string;
  onNewChange: (v: string) => void;
  onAdd: () => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-3 text-[var(--color-text-primary)]">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--ref-primary)] text-white"><Tag className="h-5 w-5" /></span>
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ref-secondary)]">Step 3</p><h2 className="font-headline text-2xl font-extrabold">Make spending legible</h2></div>
      </div>
      <p className="mb-7 max-w-lg text-sm leading-relaxed text-[var(--color-text-secondary)]">
        Categories turn a pile of transactions into patterns you can actually act on. Start with the essentials and add nuance later.
      </p>
      <div className="mb-7 flex flex-wrap gap-2">
        {props.presets.map((p) => (
          <span
            key={p.name}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--ref-surface-container-low)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] ring-1 ring-[var(--color-border)]"
          >
            <span>{p.icon}</span>
            {p.name}
          </span>
        ))}
      </div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-muted)]">Ready in your ledger</p>
        <span className="text-[11px] text-[var(--color-muted)]">Editable later</span>
      </div>
      <ul className="mb-5 max-h-40 space-y-1 overflow-y-auto rounded-2xl bg-[var(--ref-surface-container-low)] p-3 text-sm text-[var(--color-text-secondary)] ring-1 ring-[var(--color-border)]">
        {props.categories.length === 0 ? (
          <li className="text-[var(--color-muted)]">Loading categories…</li>
        ) : (
          props.categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-0.5">
              <span>{c.name}</span>
            </li>
          ))
        )}
      </ul>
      <div className="flex gap-2 rounded-2xl border border-dashed border-[var(--color-border-strong)] bg-[var(--ref-surface-container-low)] p-3">
        <input
          value={props.newName}
          onChange={(e) => props.onNewChange(e.target.value)}
          placeholder="Add a category"
          className="brutalist-input flex-1 border-transparent bg-white/80 px-4 py-2.5 text-sm placeholder:text-[var(--color-muted)] focus:border-[var(--ref-primary)] focus:bg-white focus:ring-4 focus:ring-[var(--ref-primary)]/10"
          onKeyDown={(e) => e.key === 'Enter' && props.onAdd()}
        />
        <button
          type="button"
          onClick={props.onAdd}
          className="brutalist-button brutalist-button--secondary cursor-pointer rounded-xl px-4 py-2.5 text-sm"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function StepPeriod(props: {
  name: string;
  start: string;
  end: string;
  onName: (v: string) => void;
  onStart: (v: string) => void;
  onEnd: (v: string) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-3 text-[var(--color-text-primary)]">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--ref-primary)] text-white"><Calendar className="h-5 w-5" /></span>
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ref-secondary)]">Step 4</p><h2 className="font-headline text-2xl font-extrabold">Give the month a shape</h2></div>
      </div>
      <p className="mb-7 max-w-lg text-sm leading-relaxed text-[var(--color-text-secondary)]">
        Fainens uses your pay cycle to show what’s happening now, what’s left, and when to slow down. These dates are always editable.
      </p>
      <label className="block text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">Period name</label>
      <input
        value={props.name}
        onChange={(e) => props.onName(e.target.value)}
        placeholder="e.g. September 2026"
        className="brutalist-input mt-2 w-full bg-[var(--ref-surface-container-low)] focus:border-[var(--ref-primary)] focus:ring-4 focus:ring-[var(--ref-primary)]/10"
      />
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">Starts</label>
          <input
            type="date"
            value={props.start}
            onChange={(e) => props.onStart(e.target.value)}
            className="brutalist-input mt-2 w-full bg-[var(--ref-surface-container-low)] focus:border-[var(--ref-primary)] focus:ring-4 focus:ring-[var(--ref-primary)]/10"
          />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">Ends</label>
          <input
            type="date"
            value={props.end}
            onChange={(e) => props.onEnd(e.target.value)}
            className="brutalist-input mt-2 w-full bg-[var(--ref-surface-container-low)] focus:border-[var(--ref-primary)] focus:ring-4 focus:ring-[var(--ref-primary)]/10"
          />
        </div>
      </div>
      <div className="mt-6 flex items-start gap-2 rounded-2xl bg-[var(--ref-surface-container-low)] p-3.5 text-xs leading-relaxed text-[var(--color-text-secondary)] ring-1 ring-[var(--color-border)]"><Calendar className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ref-secondary)]" /><span>Inclusive dates: transactions on both the start and end date belong to this period.</span></div>
    </div>
  );
}

function StepBudget(props: {
  categories: Array<{ id: number; name: string }>;
  budgets: Record<number, string>;
  onBudgetChange: (categoryId: number, value: string) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-3 text-[var(--color-text-primary)]">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--ref-primary)] text-white"><PiggyBank className="h-5 w-5" /></span>
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ref-secondary)]">Step 5</p><h2 className="font-headline text-2xl font-extrabold">Choose a soft limit</h2></div>
      </div>
      <p className="mb-7 max-w-lg text-sm leading-relaxed text-[var(--color-text-secondary)]">
        A budget is a signal, not a punishment. Add the categories you want to keep an eye on and adjust them as real life changes.
      </p>
      <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
        {props.categories.map((c) => (
          <div
            key={c.id}
            className="flex items-center gap-3 rounded-2xl bg-[var(--ref-surface-container-low)] px-3.5 py-2.5 ring-1 ring-[var(--color-border)]"
          >
            <span className="flex-1 truncate text-sm font-semibold text-[var(--color-text-secondary)]">{c.name}</span>
            <input
              inputMode="decimal"
              placeholder="0"
              value={props.budgets[c.id] ?? ''}
              onChange={(e) => props.onBudgetChange(c.id, e.target.value)}
              aria-label={`${c.name} budget`}
              className="brutalist-input w-28 bg-white px-2 py-1.5 text-right text-sm focus:border-[var(--ref-primary)] focus:ring-2 focus:ring-[var(--ref-primary)]/10"
            />
          </div>
        ))}
      </div>
      <div className="mt-6 flex items-start gap-2 rounded-2xl bg-[var(--ref-surface-container-low)] p-3.5 text-xs leading-relaxed text-[var(--color-text-secondary)] ring-1 ring-[var(--color-border)]"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ref-secondary)]" /><span>Leave everything blank if you prefer to learn your baseline first. You can add budgets from the dashboard later.</span></div>
    </div>
  );
}

function StepPreferences(props: {
  currency: string;
  dateFormat: string;
  payrollDay: number;
  onCurrency: (value: string) => void;
  onDateFormat: (value: string) => void;
  onPayrollDay: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-3 text-[var(--color-text-primary)]">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--ref-primary)] text-white">⚙</span>
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ref-secondary)]">Step 6</p><h2 className="font-headline text-2xl font-extrabold">Make it yours</h2></div>
      </div>
      <p className="mb-7 max-w-lg text-sm leading-relaxed text-[var(--color-text-secondary)]">
        Set the small defaults that make every amount and date feel familiar. You can change these later in Settings.
      </p>

      <div className="space-y-5">
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-[var(--color-text-primary)]">Display currency</span>
          <select value={props.currency} onChange={(e) => props.onCurrency(e.target.value)} className="brutalist-input bg-[var(--ref-surface-container-low)]">
            {CURRENCY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <span className="mt-1.5 block text-xs text-[var(--color-muted)]">Used when Fainens formats balances, budgets, and reports.</span>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-[var(--color-text-primary)]">Date format</span>
          <select value={props.dateFormat} onChange={(e) => props.onDateFormat(e.target.value)} className="brutalist-input bg-[var(--ref-surface-container-low)]">
            {DATE_FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        <label className="block max-w-xs">
          <span className="mb-1.5 block text-sm font-semibold text-[var(--color-text-primary)]">Payday</span>
          <div className="flex items-center gap-3">
            <input type="number" min={1} max={31} value={props.payrollDay} onChange={(e) => props.onPayrollDay(Math.min(31, Math.max(1, Number(e.target.value) || 1)))} className="brutalist-input bg-[var(--ref-surface-container-low)] text-center" />
            <span className="text-sm text-[var(--color-text-secondary)]">of each month</span>
          </div>
          <span className="mt-1.5 block text-xs text-[var(--color-muted)]">This powers payday reminders and salary-period defaults.</span>
        </label>
      </div>

      <div className="mt-7 flex items-start gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-4">
        <span className="mt-0.5 text-lg" aria-hidden>✨</span>
        <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]"><strong className="text-[var(--color-text-primary)]">Advanced settings stay optional.</strong> Theme, transfer fee rules, opportunity cost, and agent memory are available in Settings whenever you need them.</p>
      </div>
    </div>
  );
}

function StepDone() {
  return (
    <div>
      <div className="text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
          <PartyPopper className="h-7 w-7" />
        </div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ref-secondary)]">Your starting point</p>
        <h2 className="mt-2 font-headline text-3xl font-extrabold tracking-tight text-[var(--color-text-primary)]">You’re all set</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--color-text-secondary)]">
          Your first snapshot is ready. Add a transaction and Fainens will start turning your money into a clearer picture.
        </p>
      </div>
      <div className="mt-8 rounded-2xl bg-white/75 p-5 ring-1 ring-[var(--color-border)]/70">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-[var(--color-muted)]">Current balance</p>
            <p className="mt-1 text-4xl font-extrabold tracking-[-0.04em] text-[var(--color-text-primary)]">Rp 8.420.000</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">Healthy start</span>
        </div>
        <div className="mt-5 flex h-16 items-end gap-1.5" aria-label="Sample balance trend">
          {[32, 38, 35, 49, 58, 66, 74].map((height, index) => (
            <div key={index} className="flex-1 rounded-t-md bg-[var(--ref-primary)]/[0.18]" style={{ height: `${height}%` }} />
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] font-semibold text-[var(--color-muted)]"><span>Start of period</span><span>Now</span></div>
        <div className="mt-5 space-y-2 border-t border-[var(--color-border)] pt-4 text-xs">
          <div className="flex items-center justify-between gap-3"><span className="font-semibold text-[var(--color-text-secondary)]">Spent this period</span><span className="font-bold text-[var(--color-text-primary)]">Rp 2.480.000</span></div>
          <div className="flex items-center justify-between gap-3"><span className="font-semibold text-[var(--color-text-secondary)]">Largest category</span><span className="font-bold text-[var(--color-text-primary)]">Food &amp; Dining</span></div>
        </div>
      </div>
      <p className="mt-4 text-center text-[11px] text-[var(--color-muted)]">Example only · Your real dashboard starts with your data.</p>
    </div>
  );
}
