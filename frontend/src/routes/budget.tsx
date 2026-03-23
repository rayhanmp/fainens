import { createFileRoute, Link, useSearch } from '@tanstack/react-router';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { RequireAuth } from '../lib/auth';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { formatCurrency, cn, formatIdNominalInput, parseIdNominalToInt } from '../lib/utils';
import {
  Plus,
  PiggyBank,
  Trash2,
  Wallet,
  Target,
  ShoppingCart,
  CalendarRange,
  ChevronRight,
} from 'lucide-react';
import { CardSkeleton, StatCardSkeleton } from '../components/ui/Skeleton';

export const Route = createFileRoute('/budget')({
  component: BudgetPage,
} as any);

interface BudgetRow {
  id: number;
  periodId: number;
  categoryId: number;
  categoryName: string;
  plannedAmount: number;
  actualAmount: number;
  variance: number;
  percentUsed: number;
}

interface Period {
  id: number;
  name: string;
  startDate: number;
  endDate: number;
}

interface Category {
  id: number;
  name: string;
  icon: string | null;
  color: string | null;
}

function formatPeriodRange(p: Period) {
  const a = new Date(p.startDate);
  const b = new Date(p.endDate);
  return `${a.toLocaleDateString('en-ID', { day: 'numeric', month: 'short' })} – ${b.toLocaleDateString('en-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}

function BudgetPage() {
  const search = useSearch({ from: '/budget' }) as { periodId?: string };
  const [budgetRows, setBudgetRows] = useState<BudgetRow[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>(search.periodId || '');
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [budgetForm, setBudgetForm] = useState({
    categoryId: '',
    plannedAmount: '',
  });

  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadData();
  }, [selectedPeriodId]);

  const loadData = async () => {
    try {
      const [budgetData, periodData, categoryData] = await Promise.all([
        api.budgets.list(selectedPeriodId || undefined),
        api.periods.list(),
        api.categories.list(),
      ]);
      setBudgetRows(budgetData);
      setPeriods(periodData);
      setCategories(categoryData);

      if (!selectedPeriodId && periodData.length > 0) {
        setSelectedPeriodId(periodData[0].id.toString());
      }
    } finally {
      setIsLoading(false);
    }
  };

  const selectedPeriod = periods.find((p) => p.id.toString() === selectedPeriodId);

  const handleCreateBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setIsSubmitting(true);

    const digits = budgetForm.plannedAmount.replace(/\D/g, '');
    const amount = digits === '' ? Number.NaN : parseIdNominalToInt(budgetForm.plannedAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError('Enter a valid amount in IDR');
      setIsSubmitting(false);
      return;
    }

    try {
      await api.budgets.create({
        periodId: parseInt(selectedPeriodId, 10),
        categoryId: parseInt(budgetForm.categoryId, 10),
        plannedAmount: amount,
      });
      await loadData();
      closeBudgetModal();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteBudget = async (budgetId: number) => {
    if (!confirm('Delete this budget line?')) return;
    try {
      await api.budgets.delete(budgetId);
      await loadData();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const openBudgetModal = () => {
    setBudgetForm({ categoryId: '', plannedAmount: '' });
    setFormError('');
    setIsModalOpen(true);
  };

  const closeBudgetModal = () => {
    setIsModalOpen(false);
    setBudgetForm({ categoryId: '', plannedAmount: '' });
    setFormError('');
  };

  const totalBudgeted = budgetRows.reduce((sum, cat) => sum + cat.plannedAmount, 0);
  const totalSpent = budgetRows.reduce((sum, cat) => sum + cat.actualAmount, 0);
  const totalRemaining = totalBudgeted - totalSpent;

  const mixRows = useMemo(() => {
    if (totalBudgeted <= 0) return [];
    return [...budgetRows]
      .sort((a, b) => b.plannedAmount - a.plannedAmount)
      .slice(0, 6)
      .map((row) => ({
        ...row,
        share: Math.round((row.plannedAmount / totalBudgeted) * 100),
      }));
  }, [budgetRows, totalBudgeted]);

  const statusLine = useMemo(() => {
    const now = new Date();
    return `Updated ${now.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })}`;
  }, []);

  if (isLoading) {
    return (
      <RequireAuth>
        <div className="max-w-7xl mx-auto space-y-8 pb-10 animate-slide-in">
          <div className="h-10 w-64 rounded-md bg-[var(--ref-surface-container-highest)] animate-pulse" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
              <CardSkeleton className="min-h-[320px]" />
            </div>
            <CardSkeleton className="min-h-[240px]" />
          </div>
        </div>
      </RequireAuth>
    );
  }

  return (
    <RequireAuth>
      <div className="max-w-7xl mx-auto space-y-8 pb-10">
        {/* Header — Stitch “Financial overview” / localized budgeting */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-headline text-3xl font-extrabold tracking-tight text-[var(--ref-on-surface)] sm:text-4xl">
              Localized budgeting
            </h1>
            <p className="mt-2 max-w-xl font-body text-sm text-[var(--ref-on-surface-variant)]">
              {selectedPeriod
                ? `${selectedPeriod.name} · ${formatPeriodRange(selectedPeriod)}`
                : 'Plan spending by category for each salary period.'}{' '}
              <span className="text-[var(--ref-outline)]">· {statusLine}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/periods">
              <button
                type="button"
                className="px-5 py-2.5 bg-[var(--ref-surface-container-lowest)] text-[var(--ref-primary)] text-xs font-bold rounded-full editorial-shadow border border-[var(--color-border)] hover:bg-[var(--ref-surface-container-low)] transition-colors inline-flex items-center gap-2"
              >
                <CalendarRange className="h-4 w-4" />
                Salary periods
              </button>
            </Link>
            {periods.length > 0 && (
              <Select
                value={selectedPeriodId}
                onChange={(e) => setSelectedPeriodId(e.target.value)}
                options={periods.map((p) => ({ value: p.id.toString(), label: p.name }))}
                className="min-w-[180px] rounded-full border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] text-xs font-bold"
              />
            )}
            <Button
              className="rounded-full px-6 py-3 shadow-lg shadow-[var(--color-accent)]/20"
              onClick={openBudgetModal}
              disabled={!selectedPeriod}
            >
              <Plus className="h-4 w-4" />
              Add budget line
            </Button>
          </div>
        </div>

        {/* Bento summary — Stitch 3 cards */}
        {selectedPeriod && (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="relative flex min-h-[180px] flex-col justify-between overflow-hidden rounded-[2rem] bg-[var(--ref-primary-container)] p-8 text-white group">
              <div className="relative z-10">
                <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--ref-on-primary-container)] opacity-90">
                  Total budget
                </p>
                <p className="font-headline text-3xl font-extrabold tracking-tight sm:text-4xl">
                  {formatCurrency(totalBudgeted)}
                </p>
              </div>
              <div className="relative z-10 mt-4 text-xs font-medium text-[var(--ref-on-primary-container)] opacity-95">
                Planned for {selectedPeriod.name}
              </div>
              <div className="absolute -bottom-8 -right-8 h-32 w-32 rounded-full bg-white/10 blur-3xl transition-transform duration-500 group-hover:scale-125" />
            </div>

            <div className="flex min-h-[180px] flex-col justify-between rounded-[2rem] border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-8 editorial-shadow">
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">Spent</p>
                <p className="font-headline text-2xl font-bold tracking-tight text-[var(--ref-on-surface)] sm:text-3xl">
                  {formatCurrency(totalSpent)}
                </p>
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-[var(--ref-error)]">
                <ShoppingCart className="h-4 w-4 shrink-0" />
                Against budgeted categories
              </div>
            </div>

            <div className="flex min-h-[180px] flex-col justify-between rounded-[2rem] border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-8 editorial-shadow">
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">Remaining</p>
                <p
                  className={cn(
                    'font-headline text-2xl font-bold tracking-tight sm:text-3xl',
                    totalRemaining < 0 ? 'text-[var(--ref-error)]' : 'text-[var(--ref-on-surface)]',
                  )}
                >
                  {formatCurrency(totalRemaining)}
                </p>
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-[var(--ref-secondary)]">
                <Wallet className="h-4 w-4 shrink-0" />
                {totalRemaining >= 0 ? 'Headroom this period' : 'Over budget'}
              </div>
            </div>
          </div>
        )}

        {!selectedPeriod ? (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-10 text-center editorial-shadow">
            <PiggyBank className="mx-auto mb-4 h-14 w-14 text-[var(--ref-outline)]" />
            <p className="mb-2 font-headline text-lg font-bold text-[var(--ref-on-surface)]">No salary period yet</p>
            <p className="mb-6 text-sm text-[var(--ref-on-surface-variant)]">
              Create a salary period first to start budgeting by category.
            </p>
            <Link to="/periods">
              <Button className="rounded-full">
                <Plus className="w-4 h-4" />
                Create salary period
              </Button>
            </Link>
          </div>
        ) : budgetRows.length === 0 ? (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-10 text-center editorial-shadow">
            <Target className="mx-auto mb-4 h-14 w-14 text-[var(--ref-outline)]" />
            <p className="mb-2 font-headline text-lg font-bold text-[var(--ref-on-surface)]">No lines for {selectedPeriod.name}</p>
            <p className="mb-6 text-sm text-[var(--ref-on-surface-variant)]">
              Add a category budget to track planned vs actual spending.
            </p>
            <Button className="rounded-full" onClick={openBudgetModal}>
              <Plus className="w-4 h-4" />
              Add first budget line
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-3">
            {/* Budget progress — Stitch dashboard widget */}
            <div className="lg:col-span-2">
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container)] p-6 sm:p-8">
                <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                  <h2 className="font-headline text-lg font-bold text-[var(--ref-on-surface)]">Budget progress</h2>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">
                    {budgetRows.length} categories
                  </span>
                </div>
                <ul className="space-y-8">
                  {budgetRows.map((row) => {
                    const pct =
                      row.plannedAmount > 0 ? (row.actualAmount / row.plannedAmount) * 100 : 0;
                    const pctCapped = Math.min(pct, 999);
                    const cat = categories.find((c) => c.id === row.categoryId);
                    const categoryColor = cat?.color || 'var(--ref-primary)';
                    return (
                      <li key={row.id}>
                        <div className="mb-3 flex items-start gap-4">
                          <div
                            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg text-white"
                            style={{ backgroundColor: categoryColor }}
                          >
                            {cat?.icon ? (
                              <span aria-hidden>{cat.icon}</span>
                            ) : (
                              <ShoppingCart className="h-5 w-5" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                              <div>
                                <p className="text-xs font-bold text-[var(--ref-on-surface)]">{row.categoryName}</p>
                                <p className="text-[10px] font-medium text-[var(--ref-outline)]">
                                  {formatCurrency(row.actualAmount)} of {formatCurrency(row.plannedAmount)}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <span
                                  className={cn(
                                    'text-xs font-bold',
                                    pct > 100 ? 'text-[var(--ref-error)]' : 'text-[var(--ref-primary)]',
                                  )}
                                >
                                  {pctCapped.toFixed(0)}%
                                </span>
                                <button
                                  type="button"
                                  onClick={() => deleteBudget(row.id)}
                                  className="rounded-full p-2 text-[var(--ref-error)] transition-colors hover:bg-[var(--ref-error)]/10"
                                  aria-label={`Remove ${row.categoryName}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                            <div className="h-3 w-full overflow-hidden rounded-full bg-[var(--ref-surface-container-lowest)]">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${Math.min(pct, 100)}%`,
                                  backgroundColor: pct > 100 ? 'var(--ref-error)' : pct > 85 ? '#f59e0b' : categoryColor,
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <Link
                  to="/transactions"
                  className="mt-8 flex w-full items-center justify-center gap-1 rounded-full border border-transparent bg-[var(--ref-surface-container-highest)] py-3 text-center text-xs font-bold text-[var(--ref-on-surface-variant)] transition-colors hover:border-[var(--color-border)] hover:bg-white"
                >
                  View transactions
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            </div>

            {/* Budget mix — right column */}
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 sm:p-8 editorial-shadow">
              <h2 className="mb-2 font-headline text-lg font-bold text-[var(--ref-on-surface)]">Budget mix</h2>
              <p className="mb-6 text-xs text-[var(--ref-on-surface-variant)]">
                Share of total planned budget by category.
              </p>
              <div className="space-y-5">
                {mixRows.map((row, i) => {
                  const tint = ['bg-[var(--ref-primary)]', 'bg-[var(--ref-secondary)]', 'bg-[var(--ref-tertiary)]'];
                  return (
                    <div key={row.id} className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex justify-between gap-2">
                          <span className="truncate text-xs font-bold text-[var(--ref-on-surface)]">{row.categoryName}</span>
                          <span className="shrink-0 text-xs font-bold text-[var(--ref-on-surface)]">{row.share}%</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]">
                          <div
                            className={cn('h-full rounded-full', tint[i % tint.length])}
                            style={{ width: `${row.share}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <Modal
          isOpen={isModalOpen}
          onClose={closeBudgetModal}
          title="Add budget line"
          subtitle="Choose a category and planned amount for this salary period."
          size="xl"
        >
          <form onSubmit={handleCreateBudget} className="space-y-5">
            {categories.length === 0 ? (
              <div className="p-4 bg-[var(--color-warning)]/10 border-2 border-[var(--color-warning)]">
                <p className="text-sm mb-2">No categories found.</p>
                <Link to="/categories" className="text-sm font-bold text-[var(--ref-primary)] underline">
                  Create categories first →
                </Link>
              </div>
            ) : (
              <Select
                label="Category"
                value={budgetForm.categoryId}
                onChange={(e) => setBudgetForm({ ...budgetForm, categoryId: e.target.value })}
                options={[
                  { value: '', label: 'Select a category…' },
                  ...categories.map((c) => ({
                    value: c.id.toString(),
                    label: c.name,
                  })),
                ]}
                required
              />
            )}

            <Input
              label="Planned amount (IDR)"
              inputMode="numeric"
              value={budgetForm.plannedAmount}
              onChange={(e) =>
                setBudgetForm({ ...budgetForm, plannedAmount: formatIdNominalInput(e.target.value) })
              }
              placeholder="0"
              autoComplete="off"
              required
            />

            {formError && <p className="text-sm text-[var(--color-danger)]">{formError}</p>}

            <div className="flex flex-wrap gap-3 pt-2">
              <Button type="submit" isLoading={isSubmitting} className="min-w-[140px]">
                Save budget line
              </Button>
              <Button type="button" variant="secondary" onClick={closeBudgetModal}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      </div>
    </RequireAuth>
  );
}
