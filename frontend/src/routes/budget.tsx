import { createFileRoute, Link, useSearch } from '@tanstack/react-router';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { CurrencyInput } from '../components/ui/CurrencyInput';
import { PageHeader } from '../components/ui/PageHeader';
import { PageContainer } from '../components/ui/PageContainer';
import { RequireAuth } from '../lib/auth';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { formatCurrency, cn, parseIdNominalToInt } from '../lib/utils';
import {
  Plus,
  PiggyBank,
  Target,
  CalendarRange,
  ChevronRight,
  Save,
  Copy,
  TrendingUp,
  TrendingDown,
  MoreVertical,
  Search,
  ArrowUp,
  ArrowDown,
  X,
  Sparkles,
  Repeat,
  Tag,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { CardSkeleton, StatCardSkeleton } from '../components/ui/Skeleton';
import { AIInsightCard } from '../components/insights/AIInsightCard';

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
type SortDirection = 'asc' | 'desc';

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
  const [periodIncome, setPeriodIncome] = useState<number>(0);
  const [budgetPercentOfIncome, setBudgetPercentOfIncome] = useState<number>(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isApplyTemplateModalOpen, setIsApplyTemplateModalOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetRow | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('amountSpent');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filterBy, setFilterBy] = useState<FilterOption>('all');
  const [searchQuery, setSearchQuery] = useState('');
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
      
      // Handle new API response format - can be array or single object
      const data = budgetData as any;
      if (Array.isArray(data)) {
        const firstPeriod = data[0];
        setBudgetRows(firstPeriod?.plans || []);
        setPeriodIncome(firstPeriod?.income || 0);
        setBudgetPercentOfIncome(firstPeriod?.percentOfIncome || 0);
      } else {
        setBudgetRows(data.plans || []);
        setPeriodIncome(data.income || 0);
        setBudgetPercentOfIncome(data.percentOfIncome || 0);
      }
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

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      rows = rows.filter((r) => r.categoryName.toLowerCase().includes(query));
    }

    // Status filter
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

    // Apply sort direction
    if (sortDirection === 'asc') {
      rows.reverse();
    }

    return rows;
  }, [budgetRows, sortBy, sortDirection, filterBy, searchQuery]);

  // Quick stats
  const stats = useMemo(() => {
    const over = budgetRows.filter((r) => r.percentUsed > 100).length;
    const near = budgetRows.filter((r) => r.percentUsed >= 75 && r.percentUsed <= 100).length;
    const under = budgetRows.filter((r) => r.percentUsed > 0 && r.percentUsed < 75).length;
    const notStarted = budgetRows.filter((r) => r.actualAmount === 0).length;
    return { over, near, under, notStarted, total: budgetRows.length };
  }, [budgetRows]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filterBy !== 'all') count++;
    if (searchQuery.trim()) count++;
    return count;
  }, [filterBy, searchQuery]);

  const mixRows = useMemo(() => {
    if (totalBudgeted <= 0) return [];
    return [...budgetRows]
      .sort((a, b) => b.plannedAmount - a.plannedAmount)
      .slice(0, 6)
      .map((row) => {
        const cat = categories.find(c => c.id === row.categoryId);
        return {
          ...row,
          share: Math.round((row.plannedAmount / totalBudgeted) * 100),
          color: cat?.color || 'var(--ref-primary)',
        };
      });
  }, [budgetRows, totalBudgeted, categories]);

  if (isLoading) {
    return (
      <RequireAuth>
        <PageContainer>
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
        </PageContainer>
      </RequireAuth>
    );
  }

  return (
    <RequireAuth>
      <PageContainer>
        {/* Header */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <PageHeader
            subtext="Budget planning"
            title="Localized budgeting"
            description={
              selectedPeriod
                ? `${selectedPeriod.name} · ${formatPeriodRange(selectedPeriod)}`
                : 'Plan spending by category for each salary period.'
            }
          />
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
            <Link to="/categories">
              <button
                type="button"
                className="p-2.5 bg-[var(--ref-surface-container-lowest)] text-[var(--ref-primary)] rounded-full editorial-shadow border border-[var(--color-border)] hover:bg-[var(--ref-surface-container-low)] transition-colors inline-flex items-center justify-center"
                title="Categories"
              >
                <Tag className="h-4 w-4" />
              </button>
            </Link>
            <Link to="/wishlist">
              <button
                type="button"
                className="px-5 py-2.5 bg-[var(--ref-surface-container-lowest)] text-[var(--ref-primary)] text-xs font-bold rounded-full editorial-shadow border border-[var(--color-border)] hover:bg-[var(--ref-surface-container-low)] transition-colors inline-flex items-center gap-2"
              >
                <Sparkles className="h-4 w-4" />
                Wishlist
              </button>
            </Link>
            <Link to="/subscriptions">
              <button
                type="button"
                className="px-5 py-2.5 bg-[var(--ref-surface-container-lowest)] text-[var(--ref-primary)] text-xs font-bold rounded-full editorial-shadow border border-[var(--color-border)] hover:bg-[var(--ref-surface-container-low)] transition-colors inline-flex items-center gap-2"
              >
                <Repeat className="h-4 w-4" />
                Subscriptions
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
            
            {/* Template buttons */}
            {templates.length > 0 && (
              <button
                onClick={() => setIsApplyTemplateModalOpen(true)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--ref-surface-container-lowest)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)] hover:text-white transition-colors shadow-sm border border-[var(--color-border)]"
                title="Apply Template"
              >
                <Copy className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={openTemplateModal}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--ref-surface-container-lowest)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)] hover:text-white transition-colors shadow-sm border border-[var(--color-border)]"
              title="Save as Template"
            >
              <Save className="h-4 w-4" />
            </button>
            
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

        {/* Bento summary - Cards at the top */}
        {selectedPeriod && (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
            <div className="relative flex min-h-[180px] flex-col justify-between overflow-hidden rounded-[2rem] bg-[var(--ref-primary-container)] p-8 text-white group">
              <div className="relative z-10">
                <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--ref-on-primary-container)] opacity-90">
                  Total budget
                </p>
                <p className="text-3xl sm:text-4xl font-extrabold font-headline tracking-tight">
                  {formatCurrency(totalBudgeted)}
                </p>
              </div>
              <div className="relative z-10 mt-4 inline-flex items-center px-3 py-1.5 rounded-full bg-white/20 text-sm font-bold">
                {budgetPercentOfIncome}% of income
              </div>
              <div className="absolute -bottom-8 -right-8 h-32 w-32 rounded-full bg-white/10 blur-3xl transition-transform duration-500 group-hover:scale-125" />
            </div>

            <div className="flex min-h-[180px] flex-col justify-between rounded-[2rem] border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-8 editorial-shadow">
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">Income</p>
                <p className="text-2xl sm:text-3xl font-bold font-headline tracking-tight text-[var(--ref-on-surface)]">
                  {formatCurrency(periodIncome)}
                </p>
              </div>
              <div className="mt-4 text-sm font-semibold text-[var(--ref-secondary)]">
                For {selectedPeriod.name}
              </div>
            </div>

            <div className="flex min-h-[180px] flex-col justify-between rounded-[2rem] border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-8 editorial-shadow">
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">Spent</p>
                <p className="text-2xl sm:text-3xl font-bold font-headline tracking-tight text-[var(--ref-on-surface)]">
                  {formatCurrency(totalSpent)}
                </p>
              </div>
              <div className="mt-4 text-sm font-semibold text-[var(--ref-error)]">
                Against budgeted categories
              </div>
            </div>

            <div className="flex min-h-[180px] flex-col justify-between rounded-[2rem] border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-8 editorial-shadow">
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">Remaining</p>
                <p
                  className={cn(
                    'text-2xl sm:text-3xl font-bold font-headline tracking-tight',
                    totalRemaining < 0 ? 'text-[var(--ref-error)]' : 'text-[var(--ref-on-surface)]',
                  )}
                >
                  {formatCurrency(totalRemaining)}
                </p>
              </div>
              <div className="mt-4 text-sm font-semibold text-[var(--ref-secondary)]">
                {totalRemaining >= 0 ? 'Headroom this period' : 'Over budget'}
              </div>
            </div>
          </div>
        )}

        {/* Bento Controls: Search, Compare, Sort, Filter */}
        {selectedPeriod && budgetRows.length > 0 && (
          <div className="space-y-4">
            {/* Search Bar */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" />
              <input
                type="search"
                placeholder="Search categories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-full border-none bg-[var(--ref-surface-container-highest)] py-2.5 pl-10 pr-4 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-muted)] focus:ring-2 focus:ring-[var(--color-accent)]/20"
              />
            </div>

            {/* Bento Filter Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Compare Period */}
              <div className="rounded-xl bg-[var(--ref-surface-container-lowest)] p-5 shadow-sm">
                <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
                  Compare to
                </label>
                <select
                  value={comparePeriodId}
                  onChange={(e) => setComparePeriodId(e.target.value)}
                  className="w-full cursor-pointer border-none bg-transparent p-0 text-sm font-semibold text-[var(--color-text-primary)] focus:ring-0"
                >
                  <option value="">None</option>
                  {periods
                    .filter((p) => p.id.toString() !== selectedPeriodId)
                    .map((p) => (
                      <option key={p.id} value={p.id.toString()}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>

              {/* Sort with Direction */}
              <div className="rounded-xl bg-[var(--ref-surface-container-lowest)] p-5 shadow-sm">
                <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
                  Sort by
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    className="flex-1 cursor-pointer border-none bg-transparent p-0 text-sm font-semibold text-[var(--color-text-primary)] focus:ring-0"
                  >
                    <option value="name">Name</option>
                    <option value="percentUsed">% Used</option>
                    <option value="amountSpent">Amount Spent</option>
                    <option value="variance">Variance</option>
                  </select>
                  <button
                    onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                    className="rounded-lg p-1.5 text-[var(--color-muted)] hover:bg-[var(--ref-surface-container-high)] hover:text-[var(--color-text-primary)] transition-colors"
                    title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
                  >
                    {sortDirection === 'asc' ? (
                      <ArrowUp className="h-4 w-4" />
                    ) : (
                      <ArrowDown className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Filter Pills */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-[var(--color-muted)] mr-2">Filter:</span>
              {[
                { value: 'all', label: 'All', count: stats.total },
                { value: 'over', label: 'Over Budget', count: stats.over },
                { value: 'near', label: 'Near Limit', count: stats.near },
                { value: 'under', label: 'Under Budget', count: stats.under },
                { value: 'notStarted', label: 'Not Started', count: stats.notStarted },
              ].map((filter) => (
                <button
                  key={filter.value}
                  onClick={() => setFilterBy(filter.value as FilterOption)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all border',
                    filterBy === filter.value
                      ? filter.value === 'over'
                        ? 'bg-[var(--ref-error)] text-white border-[var(--ref-error)]'
                        : filter.value === 'near'
                        ? 'bg-[var(--color-warning)] text-white border-[var(--color-warning)]'
                        : filter.value === 'under'
                        ? 'bg-[var(--color-success)] text-white border-[var(--color-success)]'
                        : 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                      : 'bg-[var(--ref-surface-container-low)] text-[var(--color-text-secondary)] border-transparent hover:border-[var(--color-border)]'
                  )}
                >
                  {filter.label}
                  <span className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px]',
                    filterBy === filter.value ? 'bg-white/20' : 'bg-[var(--ref-surface-container-high)]'
                  )}>
                    {filter.count}
                  </span>
                </button>
              ))}

              {/* Active Filters Badge & Clear */}
              {activeFiltersCount > 0 && (
                <>
                  <div className="h-4 w-px bg-[var(--color-border)] mx-2" />
                  <span className="text-xs font-medium text-[var(--color-accent)]">
                    {activeFiltersCount} active
                  </span>
                  <button
                    onClick={() => {
                      setFilterBy('all');
                      setSearchQuery('');
                    }}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-[var(--color-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--ref-surface-container-high)] transition-colors"
                  >
                    <X className="h-3 w-3" />
                    Clear all
                  </button>
                </>
              )}
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
                                  className="p-1.5 rounded-lg text-[var(--color-muted)] hover:bg-[var(--ref-surface-container)] cursor-pointer"
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
                                        className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--ref-surface-container-low)] cursor-pointer"
                                        onClick={() => {
                                          setMenuRowId(null);
                                          openEditModal(row);
                                        }}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        className="block w-full px-3 py-1.5 text-left text-sm text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 cursor-pointer"
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

            {/* Status Overview */}
            <div className="space-y-6">
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 editorial-shadow">
                <h2 className="mb-4 font-headline text-lg font-bold text-[var(--ref-on-surface)]">Status Overview</h2>
                <p className="mb-4 text-xs text-[var(--ref-on-surface-variant)]">
                  Showing {filteredAndSortedRows.length} of {stats.total} categories
                </p>
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-lg bg-[var(--ref-error)]/10 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-3 w-3 rounded-full bg-[var(--ref-error)]" />
                      <span className="text-sm font-medium text-[var(--ref-on-surface)]">Over Budget</span>
                    </div>
                    <span className="text-lg font-bold text-[var(--ref-error)]">{stats.over}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-[var(--color-warning)]/10 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-3 w-3 rounded-full bg-[var(--color-warning)]" />
                      <span className="text-sm font-medium text-[var(--ref-on-surface)]">Near Limit</span>
                    </div>
                    <span className="text-lg font-bold text-[var(--color-warning)]">{stats.near}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-[var(--color-success)]/10 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-3 w-3 rounded-full bg-[var(--color-success)]" />
                      <span className="text-sm font-medium text-[var(--ref-on-surface)]">Under Budget</span>
                    </div>
                    <span className="text-lg font-bold text-[var(--color-success)]">{stats.under}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-[var(--ref-surface-container-high)] px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-3 w-3 rounded-full bg-[var(--color-muted)]" />
                      <span className="text-sm font-medium text-[var(--ref-on-surface)]">Not Started</span>
                    </div>
                    <span className="text-lg font-bold text-[var(--color-text-primary)]">{stats.notStarted}</span>
                  </div>
                </div>
              </div>

              {/* Budget mix */}
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 sm:p-8 editorial-shadow">
                <h2 className="mb-2 font-headline text-lg font-bold text-[var(--ref-on-surface)]">Budget mix</h2>
                <p className="mb-6 text-xs text-[var(--ref-on-surface-variant)]">
                  Share of total planned budget by category.
                </p>
                {mixRows.length === 0 ? (
                  <p className="text-sm text-[var(--ref-on-surface-variant)] py-8 text-center">
                    No budget categories yet.
                  </p>
                ) : (
                  <div className="space-y-4">
                    <div className="h-56 w-full relative">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={mixRows}
                            dataKey="share"
                            nameKey="categoryName"
                            cx="50%"
                            cy="50%"
                            innerRadius={48}
                            outerRadius={80}
                            paddingAngle={2}
                            isAnimationActive={false}
                          >
                            {mixRows.map((entry) => (
                              <Cell key={`cell-${entry.id}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value) => `${value}%`}
                            contentStyle={{
                              fontFamily: 'var(--font-mono)',
                              borderRadius: 8,
                              border: '1px solid var(--ref-surface-container-highest)',
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    {/* Legend */}
                    <div className="flex flex-wrap justify-center gap-x-4 gap-y-2">
                      {mixRows.map((entry) => (
                        <div key={entry.id} className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: entry.color }}
                          />
                          <span className="text-xs text-[var(--ref-on-surface-variant)]">
                            {entry.categoryName} ({entry.share}%)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* AI Insights */}
              {selectedPeriod && (
                <AIInsightCard 
                  type="budget" 
                  periodId={parseInt(selectedPeriodId) || undefined}
                />
              )}
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

            <CurrencyInput
              label="Planned amount"
              value={budgetForm.plannedAmount}
              onChange={(value) =>
                setBudgetForm({ ...budgetForm, plannedAmount: value })
              }
              size="md"
              required
              error={formError}
            />

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
            <CurrencyInput
              label="Planned amount"
              value={budgetForm.plannedAmount}
              onChange={(value) =>
                setBudgetForm({ ...budgetForm, plannedAmount: value })
              }
              size="md"
              required
              error={formError}
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
      </PageContainer>
    </RequireAuth>
  );
}
