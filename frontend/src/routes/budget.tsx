import { createFileRoute, Link, useSearch, useNavigate } from '@tanstack/react-router';
import { Calculator } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { CurrencyInput } from '../components/ui/CurrencyInput';
import { PageHeader } from '../components/ui/PageHeader';
import { PageContainer } from '../components/ui/PageContainer';
import { useConfirm } from '../components/ui/ConfirmDialog';
import { RequireAuth } from '../lib/auth';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatCurrency, cn, parseIdNominalToInt, formatIdNominalInput } from '../lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import {
  useApplyBudgetTemplateMutation,
  useBudgetCategoriesQuery,
  useBudgetComparisonQuery,
  useBudgetPeriodsQuery,
  useBudgetQuery,
  useBudgetTemplatesQuery,
  useCreateBudgetMutation,
  useCreateBudgetTemplateMutation,
  useDeleteBudgetMutation,
  useDeleteBudgetTemplateMutation,
  useUpdateBudgetMutation,
} from '../features/budgets/queries';
import { queryKeys } from '../features/core/query-keys';
import {
  Plus,
  PiggyBank,
  Target,
  ChevronRight,
  Save,
  Copy,
  TrendingUp,
  TrendingDown,
  MoreVertical,
  MoreHorizontal,
  ArrowRightLeft,
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
  status: 'open' | 'closed';
  coverageStatus: 'complete' | 'partial' | 'skipped' | 'unknown';
  coverageReason: string | null;
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
  const navigate = useNavigate();
  const search = useSearch({ from: '/budget' }) as { periodId?: string };
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>(search.periodId || '');
  const [comparePeriodId, setComparePeriodId] = useState<string>('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isApplyTemplateModalOpen, setIsApplyTemplateModalOpen] = useState(false);
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const { confirm } = useConfirm();
  const templateMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (templateMenuRef.current && !templateMenuRef.current.contains(event.target as Node)) {
        setIsTemplateMenuOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  const [editingBudget, setEditingBudget] = useState<BudgetRow | null>(null);
  const [movingBudget, setMovingBudget] = useState<BudgetRow | null>(null);
  const [movePeriodId, setMovePeriodId] = useState('');
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

  const periodsQuery = useBudgetPeriodsQuery();
  const categoriesQuery = useBudgetCategoriesQuery();
  const budgetQuery = useBudgetQuery(selectedPeriodId ? parseInt(selectedPeriodId, 10) : undefined);
  const comparisonQuery = useBudgetComparisonQuery(
    selectedPeriodId ? parseInt(selectedPeriodId, 10) : null,
    comparePeriodId ? parseInt(comparePeriodId, 10) : null,
  );
  const templatesQuery = useBudgetTemplatesQuery();
  const createBudgetMutation = useCreateBudgetMutation();
  const updateBudgetMutation = useUpdateBudgetMutation();
  const deleteBudgetMutation = useDeleteBudgetMutation();
  const createTemplateMutation = useCreateBudgetTemplateMutation();
  const applyTemplateMutation = useApplyBudgetTemplateMutation();
  const deleteTemplateMutation = useDeleteBudgetTemplateMutation();
  const periods = (periodsQuery.data ?? []) as Period[];
  const categories = (categoriesQuery.data ?? []) as Category[];
  const templates = (templatesQuery.data ?? []) as Template[];
  const budgetPayload = budgetQuery.data;
  const budgetSummary = Array.isArray(budgetPayload) ? budgetPayload[0] : budgetPayload;
  const budgetRows = (budgetSummary?.plans ?? []) as BudgetRow[];
  const periodIncome = budgetSummary?.income ?? 0;
  const budgetPercentOfIncome = budgetSummary?.percentOfIncome ?? 0;
  const comparisonData = (comparisonQuery.data ?? []) as ComparisonData[];
  const isLoading = periodsQuery.isLoading || categoriesQuery.isLoading || budgetQuery.isLoading || templatesQuery.isLoading;
  const loadError = periodsQuery.error?.message ?? categoriesQuery.error?.message ?? budgetQuery.error?.message ?? templatesQuery.error?.message ?? null;

  useEffect(() => {
    if (!selectedPeriodId && periods.length > 0) setSelectedPeriodId(periods[0].id.toString());
  }, [periods, selectedPeriodId]);

  const loadData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.budgets.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.periods.all }),
    ]);
  };

  const selectedPeriod = periods.find((p) => p.id.toString() === selectedPeriodId);
  const isPeriodClosed = selectedPeriod?.status === 'closed';
  const isPeriodTracked = selectedPeriod?.coverageStatus === 'complete' || selectedPeriod?.coverageStatus === 'partial';

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
      await createBudgetMutation.mutateAsync({
        periodId: parseInt(selectedPeriodId, 10),
        categoryId: parseInt(budgetForm.categoryId, 10),
        plannedAmount: amount,
      });
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
      await updateBudgetMutation.mutateAsync({ id: editingBudget.id, data: { plannedAmount: amount } });
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
      await createTemplateMutation.mutateAsync({
        name: templateForm.name,
        description: templateForm.description,
        periodId: parseInt(selectedPeriodId, 10),
      });
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
      await applyTemplateMutation.mutateAsync({ templateId, data: {
        periodId: parseInt(selectedPeriodId, 10),
        replaceExisting,
      } });
      setIsApplyTemplateModalOpen(false);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteBudget = async (budgetId: number) => {
    const confirmed = await confirm({
      title: 'Delete Budget Line',
      message: 'Are you sure you want to delete this budget line?',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await deleteBudgetMutation.mutateAsync(budgetId);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const openMoveModal = (budget: BudgetRow) => {
    if (isPeriodClosed) return;
    setMovingBudget(budget);
    setMovePeriodId('');
    setFormError('');
  };

  const closeMoveModal = () => {
    setMovingBudget(null);
    setMovePeriodId('');
    setFormError('');
  };

  const handleMoveBudget = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!movingBudget) return;
    const targetPeriodId = Number(movePeriodId);
    if (!Number.isSafeInteger(targetPeriodId) || targetPeriodId <= 0 || targetPeriodId === movingBudget.periodId) {
      setFormError('Choose a different open salary period');
      return;
    }
    setFormError('');
    setIsSubmitting(true);
    try {
      await updateBudgetMutation.mutateAsync({ id: movingBudget.id, data: { periodId: targetPeriodId } });
      closeMoveModal();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteTemplate = async (templateId: number) => {
    const confirmed = await confirm({
      title: 'Delete Template',
      message: 'Are you sure you want to delete this template?',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await deleteTemplateMutation.mutateAsync(templateId);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const openBudgetModal = () => {
    if (isPeriodClosed) return;
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
    if (isPeriodClosed) return;
    setEditingBudget(budget);
    setBudgetForm({
      categoryId: budget.categoryId.toString(),
      plannedAmount: formatIdNominalInput(budget.plannedAmount.toString()),
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
    const sorted = [...budgetRows]
      .sort((a, b) => b.plannedAmount - a.plannedAmount)
    const visible = sorted.slice(0, 5)
      .map((row) => {
        const cat = categories.find(c => c.id === row.categoryId);
        return {
          ...row,
          share: Math.round((row.plannedAmount / totalBudgeted) * 100),
          color: cat?.color || 'var(--ref-primary)',
        };
      });
    const omitted = sorted.slice(5).reduce((sum, row) => sum + row.plannedAmount, 0);
    if (omitted > 0) {
      visible.push({
        id: -1,
        periodId: Number(selectedPeriodId) || -1,
        categoryId: -1,
        categoryName: 'Other',
        plannedAmount: omitted,
        actualAmount: 0,
        percentUsed: 0,
        variance: 0,
        share: Math.round((omitted / totalBudgeted) * 100),
        color: '#a0a4b0',
      });
    }
    return visible;
  }, [budgetRows, totalBudgeted, categories, selectedPeriodId]);

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
                ? `${selectedPeriod.name} · ${formatPeriodRange(selectedPeriod)}${isPeriodClosed ? ' · CLOSED — read only' : ''}`
                : 'Plan spending by category for each salary period.'
            }
          />
          <div className="flex flex-wrap items-center gap-3">
            {periods.length > 0 && (
              <Select
                value={selectedPeriodId}
                onChange={(e) => {
                  setSelectedPeriodId(e.target.value);
                  void navigate({ to: '/budget', search: { periodId: e.target.value }, replace: true });
                }}
                options={periods.map((p) => ({ value: p.id.toString(), label: `${p.name}${p.status === 'closed' ? ' (closed)' : ''}` }))}
                className="min-w-[180px] rounded-full border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] text-xs font-bold"
              />
            )}
            
            {/* Template button with dropdown */}
            <div className="relative" ref={templateMenuRef}>
              <button
                type="button"
                onClick={() => setIsTemplateMenuOpen(!isTemplateMenuOpen)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--ref-surface-container-lowest)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)] hover:text-white transition-colors shadow-sm border border-[var(--color-border)]"
                title="Templates"
              >
                <Copy className="h-4 w-4" />
              </button>
              {isTemplateMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-[var(--ref-surface-container-lowest)] rounded-xl editorial-shadow border border-[var(--color-border)] py-2 z-50">
                  {templates.length > 0 && (
                    <button
                      disabled={isPeriodClosed}
                      onClick={() => { setIsApplyTemplateModalOpen(true); setIsTemplateMenuOpen(false); }}
                      className="flex w-full items-center gap-3 px-4 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--ref-surface-container-low)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Copy className="h-4 w-4" />
                      Apply Template
                    </button>
                  )}
                  <button
                    onClick={() => { openTemplateModal(); setIsTemplateMenuOpen(false); }}
                    className="flex w-full items-center gap-3 px-4 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--ref-surface-container-low)]"
                  >
                    <Save className="h-4 w-4" />
                    Save as Template
                  </button>
                </div>
              )}
            </div>

            {/* More menu - Categories, Wishlist, Subscriptions */}
            <div className="relative" ref={moreMenuRef}>
              <button
                type="button"
                onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--ref-surface-container-lowest)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)] hover:text-white transition-colors shadow-sm border border-[var(--color-border)]"
                title="More"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {isMoreMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-[var(--ref-surface-container-lowest)] rounded-xl editorial-shadow border border-[var(--color-border)] py-2 z-50">
                  <button type="button" onClick={() => { setIsMoreMenuOpen(false); navigate({ to: '/savings-simulator' }); }} className="flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--ref-surface-container-low)]">
                    <Calculator className="h-4 w-4" />Savings simulator
                  </button>
                  <Link
                    to="/categories"
                    className="flex items-center gap-3 px-4 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--ref-surface-container-low)]"
                    onClick={() => setIsMoreMenuOpen(false)}
                  >
                    <Tag className="h-4 w-4" />
                    Categories
                  </Link>
                  <Link
                    to="/wishlist"
                    className="flex items-center gap-3 px-4 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--ref-surface-container-low)]"
                    onClick={() => setIsMoreMenuOpen(false)}
                  >
                    <Sparkles className="h-4 w-4" />
                    Wishlist
                  </Link>
                  <Link
                    to="/subscriptions"
                    className="flex items-center gap-3 px-4 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--ref-surface-container-low)]"
                    onClick={() => setIsMoreMenuOpen(false)}
                  >
                    <Repeat className="h-4 w-4" />
                    Subscriptions
                  </Link>
                </div>
              )}
            </div>
            
            <Button
              className="rounded-full px-6 py-3 shadow-lg shadow-[var(--color-accent)]/20"
              onClick={openBudgetModal}
              disabled={!selectedPeriod || isPeriodClosed}
            >
              <Plus className="h-4 w-4" />
              Add budget line
            </Button>
          </div>
        </div>

        <nav aria-label="Planning tools" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 md:hidden">
          <Link to="/salary-income" className="shrink-0 rounded-full bg-[var(--ref-surface-container-low)] px-4 py-2.5 text-xs font-bold">Income</Link>
          <Link to="/subscriptions" className="shrink-0 rounded-full bg-[var(--ref-surface-container-low)] px-4 py-2.5 text-xs font-bold">Bills</Link>
          <Link to="/savings-simulator" className="shrink-0 rounded-full bg-[var(--ref-surface-container-low)] px-4 py-2.5 text-xs font-bold">Savings</Link>
          <Link to="/paylater" className="shrink-0 rounded-full bg-[var(--ref-surface-container-low)] px-4 py-2.5 text-xs font-bold">Pay later</Link>
          <Link to="/loans" className="shrink-0 rounded-full bg-[var(--ref-surface-container-low)] px-4 py-2.5 text-xs font-bold">Loans</Link>
        </nav>

        {loadError && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-[var(--color-danger)]/25 bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]">
            <span>Budget data could not be refreshed. Showing the last available snapshot.</span>
            <button type="button" onClick={() => void loadData()} className="shrink-0 font-semibold underline">Try again</button>
          </div>
        )}

        {/* Bento summary - Cards at the top */}
        {selectedPeriod && (
          <div className="mobile-summary-grid grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-6">
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
                  {isPeriodTracked ? formatCurrency(periodIncome) : 'Not tracked'}
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
                  {isPeriodTracked ? formatCurrency(totalSpent) : 'Not tracked'}
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
                  {isPeriodTracked ? formatCurrency(totalRemaining) : 'Not tracked'}
                </p>
              </div>
              <div className="mt-4 text-sm font-semibold text-[var(--ref-secondary)]">
                {!isPeriodTracked ? 'Coverage incomplete' : totalRemaining >= 0 ? 'Headroom this period' : 'Over budget'}
              </div>
            </div>
          </div>
        )}

        {isPeriodClosed && (
          <div className="rounded-xl border border-[var(--color-warning)] bg-[var(--color-warning)]/10 px-4 py-3 text-sm text-[var(--color-text-primary)]">
            This accounting period is closed. Budget history is read-only until it is reopened from Salary Periods.
          </div>
        )}
        {selectedPeriod && !isPeriodTracked && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            This period is marked <strong>{selectedPeriod.coverageStatus}</strong>. Budget actuals are not tracked, so empty totals are not zero activity or an under-budget result.
            {selectedPeriod.coverageReason ? ` Reason: ${selectedPeriod.coverageReason}.` : ''}
            <Link to="/periods" className="ml-2 font-semibold underline">Review coverage</Link>
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
              <Button className="rounded-full" onClick={openBudgetModal} disabled={isPeriodClosed}>
                <Plus className="w-4 h-4" />
                Add first budget line
              </Button>
              {templates.length > 0 && (
                <Button variant="secondary" className="rounded-full" onClick={() => setIsApplyTemplateModalOpen(true)} disabled={isPeriodClosed}>
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
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
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
                                {isPeriodTracked && pct > 100 && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--ref-error)]/10 text-[var(--ref-error)]">
                                    Over
                                  </span>
                                )}
                                {isPeriodTracked && pct >= 75 && pct <= 100 && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-600">
                                    Near
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
                                <span>{isPeriodTracked ? `${formatCurrency(row.actualAmount)} of ${formatCurrency(row.plannedAmount)}` : 'Actuals not tracked'}</span>
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
                                  isPeriodTracked && pct > 100 ? 'text-[var(--ref-error)]' : 'text-[var(--color-text-primary)]',
                                )}
                              >
                                {isPeriodTracked ? `${Math.min(pct, 999).toFixed(0)}%` : '—'}
                              </span>
                              {!isPeriodClosed && <div className="relative">
                                <button
                                  type="button"
                                  onClick={() => setMenuRowId(menuRowId === row.id ? null : row.id)}
                                  className="grid h-11 w-11 place-items-center rounded-xl text-[var(--color-muted)] hover:bg-[var(--ref-surface-container)] cursor-pointer"
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
                                        className="flex min-h-11 w-full items-center px-3 text-left text-sm hover:bg-[var(--ref-surface-container-low)] cursor-pointer"
                                        onClick={() => {
                                          setMenuRowId(null);
                                          openEditModal(row);
                                        }}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm hover:bg-[var(--ref-surface-container-low)] cursor-pointer"
                                        onClick={() => {
                                          setMenuRowId(null);
                                          openMoveModal(row);
                                        }}
                                      >
                                        <ArrowRightLeft className="h-3.5 w-3.5" />
                                        Move to period
                                      </button>
                                      <button
                                        type="button"
                                        className="flex min-h-11 w-full items-center px-3 text-left text-sm text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 cursor-pointer"
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
                              </div>}
                            </div>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--ref-surface-container-lowest)] mt-2" style={{ marginRight: '44px' }}>
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${Math.min(pct, 100)}%`,
                                backgroundColor: pct > 100 ? 'var(--ref-error)' : pct > 85 ? 'var(--color-warning)' : categoryColor,
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
                  className="mt-6 flex w-full items-center justify-center gap-1 rounded-full border border-transparent bg-[var(--ref-surface-container-highest)] py-3 text-center text-xs font-bold text-[var(--ref-on-surface-variant)] transition-colors hover:border-[var(--color-border)] hover:bg-[var(--color-surface)]"
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

        {/* Move Budget Modal */}
        <Modal
          isOpen={movingBudget != null}
          onClose={closeMoveModal}
          title="Move budget line"
          subtitle={`Move ${movingBudget?.categoryName || 'this category'} to another salary period.`}
          size="xl"
        >
          <form onSubmit={handleMoveBudget} className="space-y-5">
            <Select
              label="Target salary period"
              value={movePeriodId}
              onChange={(event) => setMovePeriodId(event.target.value)}
              options={[
                { value: '', label: 'Choose an open period…' },
                ...periods
                  .filter((period) => period.id !== movingBudget?.periodId && period.status !== 'closed')
                  .map((period) => ({ value: period.id.toString(), label: period.name })),
              ]}
              required
            />
            <div className="rounded-xl bg-[var(--ref-surface-container-low)] p-4 text-sm text-[var(--ref-on-surface-variant)]">
              The planned amount of {movingBudget ? formatCurrency(movingBudget.plannedAmount) : ''} moves with this line. The target period must not already contain this category.
            </div>
            {formError && <p className="text-sm text-[var(--color-danger)]">{formError}</p>}
            <div className="flex flex-wrap gap-3 pt-2">
              <Button type="submit" isLoading={isSubmitting} className="min-w-[140px]">
                Move budget line
              </Button>
              <Button type="button" variant="secondary" onClick={closeMoveModal}>
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
                        onClick={async () => {
                          const confirmed = await confirm({
                            title: 'Replace All Budgets',
                            message: 'This will replace all existing budgets. Continue?',
                            confirmLabel: 'Replace',
                            variant: 'warning',
                          });
                          if (confirmed) {
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
