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
  Target,
  CalendarRange,
  ChevronRight,
  ArrowUpDown,
  Filter,
  Save,
  Copy,
  TrendingUp,
  TrendingDown,
  MoreVertical,
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

interface ComparisonData {
  categoryId: number;
  categoryName: string;
  currentPlanned: number;
  comparePlanned: number;
  compareActual: number;
  plannedDiff: number;
  actualDiff: number;
}

interface Template {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: number;
  items: Array<{
    id: number;
    categoryId: number;
    plannedAmount: number;
    categoryName: string;
  }>;
}

type SortOption = 'name' | 'percentUsed' | 'amountSpent' | 'variance';
type FilterOption = 'all' | 'over' | 'near' | 'under' | 'notStarted';

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
  const [comparePeriodId, setComparePeriodId] = useState<string>('');
  const [comparisonData, setComparisonData] = useState<ComparisonData[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isApplyTemplateModalOpen, setIsApplyTemplateModalOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetRow | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('name');
  const [filterBy, setFilterBy] = useState<FilterOption>('all');
  const [menuRowId, setMenuRowId] = useState<number | null>(null);

  const [budgetForm, setBudgetForm] = useState({
    categoryId: '',
    plannedAmount: '',
  });

  const [templateForm, setTemplateForm] = useState({
    name: '',
    description: '',
  });

  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadData();
  }, [selectedPeriodId]);

  useEffect(() => {
    if (selectedPeriodId && comparePeriodId && selectedPeriodId !== comparePeriodId) {
      loadComparison();
    } else {
      setComparisonData([]);
    }
  }, [selectedPeriodId, comparePeriodId]);

  useEffect(() => {
    loadTemplates();
  }, []);

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

  const loadComparison = async () => {
    try {
      const data = await api.budgets.compare(selectedPeriodId, comparePeriodId);
      setComparisonData(data);
    } catch (err) {
      console.error('Failed to load comparison:', err);
    }
  };

  const loadTemplates = async () => {
    try {
      const data = await api.budgets.templates.list();
      setTemplates(data);
    } catch (err) {
      console.error('Failed to load templates:', err);
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

  const handleUpdateBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBudget) return;

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
      await api.budgets.update(editingBudget.id, { plannedAmount: amount });
      await loadData();
      closeEditModal();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateForm.name.trim() || !selectedPeriodId) return;

    setIsSubmitting(true);
    try {
      await api.budgets.templates.create({
        name: templateForm.name,
        description: templateForm.description,
        periodId: parseInt(selectedPeriodId, 10),
      });
      await loadTemplates();
      closeTemplateModal();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApplyTemplate = async (templateId: number, replaceExisting: boolean) => {
    if (!selectedPeriodId) return;

    setIsSubmitting(true);
    try {
      await api.budgets.templates.apply(templateId, {
        periodId: parseInt(selectedPeriodId, 10),
        replaceExisting,
      });
      await loadData();
      setIsApplyTemplateModalOpen(false);
    } catch (err) {
      alert((err as Error).message);
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

  const deleteTemplate = async (templateId: number) => {
    if (!confirm('Delete this template?')) return;
    try {
      await api.budgets.templates.delete(templateId);
      await loadTemplates();
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

  const openEditModal = (budget: BudgetRow) => {
    setEditingBudget(budget);
    setBudgetForm({
      categoryId: budget.categoryId.toString(),
      plannedAmount: formatCurrency(budget.plannedAmount),
    });
    setFormError('');
    setIsEditModalOpen(true);
  };

  const closeEditModal = () => {
    setIsEditModalOpen(false);
    setEditingBudget(null);
    setBudgetForm({ categoryId: '', plannedAmount: '' });
    setFormError('');
  };

  const openTemplateModal = () => {
    setTemplateForm({ name: '', description: '' });
    setFormError('');
    setIsTemplateModalOpen(true);
  };

  const closeTemplateModal = () => {
    setIsTemplateModalOpen(false);
    setTemplateForm({ name: '', description: '' });
    setFormError('');
  };

  const totalBudgeted = budgetRows.reduce((sum, cat) => sum + cat.plannedAmount, 0);
  const totalSpent = budgetRows.reduce((sum, cat) => sum + cat.actualAmount, 0);
  const totalRemaining = totalBudgeted - totalSpent;

  const getComparisonForRow = (row: BudgetRow): ComparisonData | undefined => {
    return comparisonData.find((c) => c.categoryId === row.categoryId);
  };

  const filteredAndSortedRows = useMemo(() => {
    let rows = [...budgetRows];

    // Filter
    switch (filterBy) {
      case 'over':
        rows = rows.filter((r) => r.percentUsed > 100);
        break;
      case 'near':
        rows = rows.filter((r) => r.percentUsed >= 75 && r.percentUsed <= 100);
        break;
      case 'under':
        rows = rows.filter((r) => r.percentUsed > 0 && r.percentUsed < 75);
        break;
      case 'notStarted':
        rows = rows.filter((r) => r.actualAmount === 0);
        break;
    }

    // Sort
    switch (sortBy) {
      case 'name':
        rows.sort((a, b) => a.categoryName.localeCompare(b.categoryName));
        break;
      case 'percentUsed':
        rows.sort((a, b) => b.percentUsed - a.percentUsed);
        break;
      case 'amountSpent':
        rows.sort((a, b) => b.actualAmount - a.actualAmount);
        break;
      case 'variance':
        rows.sort((a, b) => b.variance - a.variance);
        break;
    }

    return rows;
  }, [budgetRows, sortBy, filterBy]);

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
        {/* Header */}
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

        {/* Controls: Compare, Sort, Filter, Templates */}
        {selectedPeriod && budgetRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 p-4 bg-[var(--ref-surface-container-low)] rounded-xl">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">Compare to:</span>
              <Select
                value={comparePeriodId}
                onChange={(e) => setComparePeriodId(e.target.value)}
                options={[
                  { value: '', label: 'None' },
                  ...periods
                    .filter((p) => p.id.toString() !== selectedPeriodId)
                    .map((p) => ({ value: p.id.toString(), label: p.name })),
                ]}
                className="min-w-[150px] text-xs rounded-lg"
              />
            </div>
            <div className="h-6 w-px bg-[var(--color-border)]" />
            <div className="flex items-center gap-2">
              <ArrowUpDown className="h-4 w-4 text-[var(--color-muted)]" />
              <Select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                options={[
                  { value: 'name', label: 'Name' },
                  { value: 'percentUsed', label: '% Used' },
                  { value: 'amountSpent', label: 'Amount Spent' },
                  { value: 'variance', label: 'Variance' },
                ]}
                className="min-w-[120px] text-xs rounded-lg"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-[var(--color-muted)]" />
              <Select
                value={filterBy}
                onChange={(e) => setFilterBy(e.target.value as FilterOption)}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'over', label: 'Over budget' },
                  { value: 'near', label: 'Near limit' },
                  { value: 'under', label: 'Under budget' },
                  { value: 'notStarted', label: 'Not started' },
                ]}
                className="min-w-[130px] text-xs rounded-lg"
              />
            </div>
            <div className="flex-1" />
            {templates.length > 0 && (
              <Button
                variant="secondary"
                onClick={() => setIsApplyTemplateModalOpen(true)}
                className="text-xs rounded-full"
              >
                <Copy className="h-3 w-3 mr-1" />
                Apply Template
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={openTemplateModal}
              className="text-xs rounded-full"
            >
              <Save className="h-3 w-3 mr-1" />
              Save as Template
            </Button>
          </div>
        )}

        {/* Bento summary */}
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
            <div className="flex flex-wrap justify-center gap-3">
              <Button className="rounded-full" onClick={openBudgetModal}>
                <Plus className="w-4 h-4" />
                Add first budget line
              </Button>
              {templates.length > 0 && (
                <Button variant="secondary" className="rounded-full" onClick={() => setIsApplyTemplateModalOpen(true)}>
                  <Copy className="w-4 h-4 mr-1" />
                  Apply Template
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-3">
            {/* Budget progress */}
            <div className="lg:col-span-2">
              <div className="rounded-xl border border-[var(--color-border)] bg-white p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
                  <h2 className="font-headline text-lg font-bold text-[var(--ref-on-surface)]">Budget progress</h2>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">
                    {filteredAndSortedRows.length} of {budgetRows.length} categories
                  </span>
                </div>
                <ul className="space-y-3">
                  {filteredAndSortedRows.map((row) => {
                    const pct = row.plannedAmount > 0 ? (row.actualAmount / row.plannedAmount) * 100 : 0;
                    const comparison = getComparisonForRow(row);
                    const cat = categories.find((c) => c.id === row.categoryId);
                    const categoryColor = cat?.color || 'var(--ref-primary)';
                    return (
                      <li key={row.id} className="group">
                        <div className="p-3 rounded-lg hover:bg-[var(--ref-surface)] transition-colors">
                          <div className="flex items-center gap-3">
                            <Link
                              to="/transactions"
                              search={{ periodId: selectedPeriodId, categoryId: String(row.categoryId) }}
                              className="min-w-0 flex-1"
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <p className="font-medium text-sm text-[var(--color-text-primary)] truncate hover:text-[var(--color-accent)] transition-colors">
                                  {row.categoryName}
                                </p>
                                {pct > 100 && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--ref-error)]/10 text-[var(--ref-error)]">
                                    Over
                                  </span>
                                )}
                                {pct >= 75 && pct <= 100 && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-600">
                                    Near
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
                                <span>{formatCurrency(row.actualAmount)} of {formatCurrency(row.plannedAmount)}</span>
                                {comparison && (
                                  <span className="flex items-center gap-1">
                                    vs
                                    <span className={cn(
                                      comparison.actualDiff > 0 ? 'text-[var(--ref-error)]' : 'text-[var(--ref-secondary)]'
                                    )}>
                                      {comparison.actualDiff > 0 ? '+' : ''}{formatCurrency(Math.abs(comparison.actualDiff))}
                                    </span>
                                    {comparison.actualDiff > 0 ? (
                                      <TrendingUp className="h-3 w-3 text-[var(--ref-error)]" />
                                    ) : (
                                      <TrendingDown className="h-3 w-3 text-[var(--ref-secondary)]" />
                                    )}
                                  </span>
                                )}
                              </div>
                            </Link>
                            <div className="flex items-center gap-4">
                              <span
                                className={cn(
                                  'text-sm font-bold text-right min-w-[40px]',
                                  pct > 100 ? 'text-[var(--ref-error)]' : 'text-[var(--color-text-primary)]',
                                )}
                              >
                                {Math.min(pct, 999).toFixed(0)}%
                              </span>
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={() => setMenuRowId(menuRowId === row.id ? null : row.id)}
                                  className="p-1.5 rounded-lg text-[var(--color-muted)] hover:bg-[var(--ref-surface-container)]"
                                  aria-label="More actions"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </button>
                                {menuRowId === row.id && (
                                  <>
                                    <button
                                      type="button"
                                      className="fixed inset-0 z-10 cursor-default"
                                      aria-label="Close menu"
                                      onClick={() => setMenuRowId(null)}
                                    />
                                    <div className="absolute right-0 top-full z-20 mt-1 min-w-[120px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg">
                                      <button
                                        type="button"
                                        className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--ref-surface-container-low)]"
                                        onClick={() => {
                                          setMenuRowId(null);
                                          openEditModal(row);
                                        }}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        className="block w-full px-3 py-1.5 text-left text-sm text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
                                        onClick={() => {
                                          setMenuRowId(null);
                                          deleteBudget(row.id);
                                        }}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--ref-surface-container-lowest)] mt-2" style={{ marginRight: '44px' }}>
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${Math.min(pct, 100)}%`,
                                backgroundColor: pct > 100 ? 'var(--ref-error)' : pct > 85 ? '#f59e0b' : categoryColor,
                              }}
                            />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {filteredAndSortedRows.length === 0 && (
                  <p className="text-center text-sm text-[var(--color-text-secondary)] py-8">
                    No budgets match the current filter.
                  </p>
                )}
                <Link
                  to="/transactions"
                  className="mt-6 flex w-full items-center justify-center gap-1 rounded-full border border-transparent bg-[var(--ref-surface-container-highest)] py-3 text-center text-xs font-bold text-[var(--ref-on-surface-variant)] transition-colors hover:border-[var(--color-border)] hover:bg-white"
                >
                  View transactions
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            </div>

            {/* Budget mix */}
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 sm:p-8 editorial-shadow">
              <h2 className="mb-2 font-headline text-lg font-bold text-[var(--ref-on-surface)]">Budget mix</h2>
              <p className="mb-6 text-xs text-[var(--ref-on-surface-variant)]">
                Share of total planned budget by category.
              </p>
              <div className="space-y-4">
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

        {/* Create Budget Modal */}
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

        {/* Edit Budget Modal */}
        <Modal
          isOpen={isEditModalOpen}
          onClose={closeEditModal}
          title="Edit budget"
          subtitle={`Update planned amount for ${editingBudget?.categoryName || ''}`}
          size="xl"
        >
          <form onSubmit={handleUpdateBudget} className="space-y-5">
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

            <div className="p-3 bg-[var(--ref-surface-container-low)] rounded-lg">
              <p className="text-xs text-[var(--color-text-secondary)]">
                Currently spent: {editingBudget && formatCurrency(editingBudget.actualAmount)}
              </p>
            </div>

            {formError && <p className="text-sm text-[var(--color-danger)]">{formError}</p>}

            <div className="flex flex-wrap gap-3 pt-2">
              <Button type="submit" isLoading={isSubmitting} className="min-w-[140px]">
                Update budget
              </Button>
              <Button type="button" variant="secondary" onClick={closeEditModal}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>

        {/* Save Template Modal */}
        <Modal
          isOpen={isTemplateModalOpen}
          onClose={closeTemplateModal}
          title="Save as Template"
          subtitle="Save the current period's budgets as a reusable template."
          size="xl"
        >
          <form onSubmit={handleSaveTemplate} className="space-y-5">
            <Input
              label="Template name"
              value={templateForm.name}
              onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
              placeholder="e.g., Monthly Essentials"
              required
            />
            <Input
              label="Description (optional)"
              value={templateForm.description}
              onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })}
              placeholder="Brief description of this template"
            />

            <div className="p-3 bg-[var(--ref-surface-container-low)] rounded-lg">
              <p className="text-xs text-[var(--color-text-secondary)]">
                This will save {budgetRows.length} budget categories from {selectedPeriod?.name}
              </p>
            </div>

            {formError && <p className="text-sm text-[var(--color-danger)]">{formError}</p>}

            <div className="flex flex-wrap gap-3 pt-2">
              <Button type="submit" isLoading={isSubmitting} className="min-w-[140px]">
                Save Template
              </Button>
              <Button type="button" variant="secondary" onClick={closeTemplateModal}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>

        {/* Apply Template Modal */}
        <Modal
          isOpen={isApplyTemplateModalOpen}
          onClose={() => setIsApplyTemplateModalOpen(false)}
          title="Apply Template"
          subtitle={`Apply a saved template to ${selectedPeriod?.name}`}
          size="xl"
        >
          <div className="space-y-4">
            {templates.length === 0 ? (
              <p className="text-center text-sm text-[var(--color-text-secondary)] py-4">
                No templates available. Save your current budgets as a template first.
              </p>
            ) : (
              <div className="space-y-3">
                {templates.map((template) => (
                  <div
                    key={template.id}
                    className="p-4 border border-[var(--color-border)] rounded-lg hover:bg-[var(--ref-surface-container-low)] transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium text-sm">{template.name}</h3>
                      <span className="text-xs text-[var(--color-text-secondary)]">
                        {template.items.length} categories
                      </span>
                    </div>
                    {template.description && (
                      <p className="text-xs text-[var(--color-text-secondary)] mb-3">
                        {template.description}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleApplyTemplate(template.id, false)}
                        isLoading={isSubmitting}
                      >
                        Add Missing
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          if (confirm('This will replace all existing budgets. Continue?')) {
                            handleApplyTemplate(template.id, true);
                          }
                        }}
                        isLoading={isSubmitting}
                      >
                        Replace All
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => deleteTemplate(template.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end pt-2">
              <Button type="button" variant="secondary" onClick={() => setIsApplyTemplateModalOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </RequireAuth>
  );
}
