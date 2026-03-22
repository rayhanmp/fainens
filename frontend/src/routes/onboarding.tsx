import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { fetchOnboardingStatus } from '../lib/onboarding-status';
import { api } from '../lib/api';
import {
  Wallet,
  Tag,
  Calendar,
  PiggyBank,
  PartyPopper,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';

const TOTAL_STEPS = 6;

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

export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
  beforeLoad: async () => {
    const me = await fetch('/api/auth/me', { credentials: 'include' });
    if (!me.ok) {
      throw redirect({ to: '/login' });
    }
    const status = await fetchOnboardingStatus();
    if (status && !status.needsOnboarding) {
      throw redirect({ to: '/' });
    }
  },
} as any);

function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedWallets, setSelectedWallets] = useState<Set<string>>(
    () => new Set(['Cash', 'BCA']),
  );
  const [customWalletName, setCustomWalletName] = useState('');

  const [categories, setCategories] = useState<Array<{ id: number; name: string }>>([]);
  const [newCategoryName, setNewCategoryName] = useState('');

  const [periodName, setPeriodName] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');

  const [budgets, setBudgets] = useState<Record<number, string>>({});

  const [createdPeriodId, setCreatedPeriodId] = useState<number | null>(null);

  useEffect(() => {
    api.categories
      .list()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    api.periods
      .suggestNext()
      .then((s) => {
        setPeriodName(s.suggestedName);
        setPeriodStart(s.suggestedStartDate.slice(0, 10));
        setPeriodEnd(s.suggestedEndDate.slice(0, 10));
      })
      .catch(() => {
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        setPeriodName(`${today.toLocaleString('default', { month: 'long' })} ${today.getFullYear()}`);
        setPeriodStart(start.toISOString().slice(0, 10));
        setPeriodEnd(end.toISOString().slice(0, 10));
      });
  }, []);

  const toggleWallet = (name: string) => {
    setSelectedWallets((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const addCustomWallet = () => {
    const n = customWalletName.trim();
    if (!n) return;
    setSelectedWallets((prev) => new Set(prev).add(n));
    setCustomWalletName('');
  };

  const addCustomCategory = async () => {
    const n = newCategoryName.trim();
    if (!n) return;
    setLoading(true);
    setError(null);
    try {
      const created = (await api.categories.create({ name: n })) as {
        id: number;
        name: string;
      };
      setCategories((c) => [...c, { id: created.id, name: created.name }]);
      setNewCategoryName('');
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
      setLoading(true);
      try {
        for (const name of selectedWallets) {
          await api.accounts.create({
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

    if (step === 4) {
      if (!periodName.trim() || !periodStart || !periodEnd) {
        setError('Please fill in period name and dates.');
        return;
      }
      setLoading(true);
      try {
        const period = (await api.periods.create({
          name: periodName.trim(),
          startDate: periodStart,
          endDate: periodEnd,
        })) as { id: number };
        setCreatedPeriodId(period.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not create period');
        setLoading(false);
        return;
      }
      setLoading(false);
    }

    if (step === 5 && createdPeriodId != null) {
      const entries = Object.entries(budgets).filter(([, v]) => v.trim() !== '');
      if (entries.length > 0) {
        setLoading(true);
        try {
          for (const [catId, raw] of entries) {
            const cents = Math.round(parseFloat(raw.replace(/,/g, '')) * 100);
            if (!Number.isFinite(cents) || cents <= 0) continue;
            await api.budgets.create({
              periodId: createdPeriodId,
              categoryId: Number(catId),
              plannedAmount: cents,
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

    if (step === TOTAL_STEPS) {
      navigate({ to: '/' });
      return;
    }

    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }, [
    step,
    selectedWallets,
    periodName,
    periodStart,
    periodEnd,
    budgets,
    createdPeriodId,
    navigate,
  ]);

  const goBack = () => {
    setError(null);
    setStep((s) => Math.max(1, s - 1));
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 text-slate-900 font-sans antialiased">
      <div className="mx-auto max-w-lg px-4 py-10 pb-24">
        <div className="mb-8 flex items-center justify-center gap-1.5">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i + 1 <= step ? 'bg-slate-900' : 'bg-slate-200'
              }`}
            />
          ))}
        </div>

        <div className="rounded-3xl border border-slate-200/80 bg-white/90 p-8 shadow-[0_8px_40px_-12px_rgba(15,23,42,0.12)] backdrop-blur-sm">
          {step === 1 && (
            <StepWelcome />
          )}
          {step === 2 && (
            <StepWallets
              presets={WALLET_PRESETS}
              selected={selectedWallets}
              onToggle={toggleWallet}
              customName={customWalletName}
              onCustomChange={setCustomWalletName}
              onAddCustom={addCustomWallet}
            />
          )}
          {step === 3 && (
            <StepCategories
              presets={CATEGORY_PRESETS}
              categories={categories}
              newName={newCategoryName}
              onNewChange={setNewCategoryName}
              onAdd={addCustomCategory}
            />
          )}
          {step === 4 && (
            <StepPeriod
              name={periodName}
              start={periodStart}
              end={periodEnd}
              onName={setPeriodName}
              onStart={setPeriodStart}
              onEnd={setPeriodEnd}
            />
          )}
          {step === 5 && (
            <StepBudget
              categories={categories}
              budgets={budgets}
              onBudgetChange={(id, v) =>
                setBudgets((b) => ({ ...b, [id]: v }))
              }
            />
          )}
          {step === 6 && <StepDone />}

          {error && (
            <p className="mt-4 text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <div className="mt-8 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={goBack}
              disabled={step === 1 || loading}
              className="inline-flex items-center gap-1 rounded-full px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={loading}
              className="inline-flex min-w-[120px] items-center justify-center gap-2 rounded-full bg-slate-900 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
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
              className="mt-4 w-full text-center text-sm text-slate-500 underline-offset-2 hover:underline"
              disabled={loading}
              onClick={async () => {
                setError(null);
                setLoading(true);
                try {
                  const names =
                    selectedWallets.size === 0
                      ? ['Cash']
                      : Array.from(selectedWallets);
                  for (const name of names) {
                    await api.accounts.create({
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
      </div>
    </div>
  );
}

function StepWelcome() {
  return (
    <div className="text-center">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl">
        👋
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Welcome to Fainens
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
        Let’s set up your finances in under a minute. We’ll add your wallets, align
        categories, and start your first pay period so the dashboard feels right
        from day one.
      </p>
    </div>
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
      <div className="mb-2 flex items-center gap-2 text-slate-900">
        <Wallet className="h-5 w-5" />
        <h2 className="text-lg font-semibold">Your wallets</h2>
      </div>
      <p className="mb-6 text-sm text-slate-600">
        Tap the accounts you use. You can rename or add more anytime.
      </p>
      <div className="flex flex-wrap gap-2">
        {props.presets.map((p) => {
          const on = props.selected.has(p.name);
          return (
            <button
              key={p.name}
              type="button"
              onClick={() => props.onToggle(p.name)}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${
                on
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
              }`}
            >
              <span>{p.icon}</span>
              {p.name}
            </button>
          );
        })}
      </div>
      <div className="mt-6 flex gap-2">
        <input
          value={props.customName}
          onChange={(e) => props.onCustomChange(e.target.value)}
          placeholder="Custom wallet name"
          className="flex-1 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-2.5 text-sm outline-none ring-slate-900/10 placeholder:text-slate-400 focus:border-slate-300 focus:bg-white focus:ring-4"
          onKeyDown={(e) => e.key === 'Enter' && props.onAddCustom()}
        />
        <button
          type="button"
          onClick={props.onAddCustom}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          Add
        </button>
      </div>
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
      <div className="mb-2 flex items-center gap-2 text-slate-900">
        <Tag className="h-5 w-5" />
        <h2 className="text-lg font-semibold">Categories</h2>
      </div>
      <p className="mb-4 text-sm text-slate-600">
        We’ve suggested a few. Your app may already include defaults from setup — add
        any missing ones below.
      </p>
      <div className="mb-6 flex flex-wrap gap-2">
        {props.presets.map((p) => (
          <span
            key={p.name}
            className="inline-flex items-center gap-2 rounded-full border border-slate-100 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700"
          >
            <span>{p.icon}</span>
            {p.name}
          </span>
        ))}
      </div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        In your ledger
      </p>
      <ul className="mb-4 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/50 p-3 text-sm text-slate-700">
        {props.categories.length === 0 ? (
          <li className="text-slate-500">Loading categories…</li>
        ) : (
          props.categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-0.5">
              <span>{c.name}</span>
            </li>
          ))
        )}
      </ul>
      <div className="flex gap-2">
        <input
          value={props.newName}
          onChange={(e) => props.onNewChange(e.target.value)}
          placeholder="Add a category"
          className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none ring-slate-900/10 placeholder:text-slate-400 focus:ring-4"
          onKeyDown={(e) => e.key === 'Enter' && props.onAdd()}
        />
        <button
          type="button"
          onClick={props.onAdd}
          className="rounded-xl border border-slate-200 bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
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
      <div className="mb-2 flex items-center gap-2 text-slate-900">
        <Calendar className="h-5 w-5" />
        <h2 className="text-lg font-semibold">First salary period</h2>
      </div>
      <p className="mb-6 text-sm text-slate-600">
        This is the window between paychecks. You can edit dates anytime.
      </p>
      <label className="block text-xs font-medium text-slate-500">Name</label>
      <input
        value={props.name}
        onChange={(e) => props.onName(e.target.value)}
        className="mb-4 mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-500">Start</label>
          <input
            type="date"
            value={props.start}
            onChange={(e) => props.onStart(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">End</label>
          <input
            type="date"
            value={props.end}
            onChange={(e) => props.onEnd(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
          />
        </div>
      </div>
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
      <div className="mb-2 flex items-center gap-2 text-slate-900">
        <PiggyBank className="h-5 w-5" />
        <h2 className="text-lg font-semibold">Budget (optional)</h2>
      </div>
      <p className="mb-4 text-sm text-slate-600">
        Set a planned amount per category for this period, or skip — you can refine
        this in Budget later.
      </p>
      <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
        {props.categories.map((c) => (
          <div
            key={c.id}
            className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2"
          >
            <span className="flex-1 truncate text-sm text-slate-800">{c.name}</span>
            <input
              inputMode="decimal"
              placeholder="0"
              value={props.budgets[c.id] ?? ''}
              onChange={(e) => props.onBudgetChange(c.id, e.target.value)}
              className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-right text-sm outline-none focus:ring-2"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function StepDone() {
  return (
    <div className="text-center">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
        <PartyPopper className="h-7 w-7" />
      </div>
      <h2 className="text-xl font-semibold text-slate-900">You’re all set</h2>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        Your wallets and pay period are ready. Head to the dashboard to see your
        snapshot and add your first transactions.
      </p>
    </div>
  );
}
