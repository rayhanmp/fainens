import { createFileRoute, Link, useSearch, useNavigate } from '@tanstack/react-router';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { PeriodPicker } from '../components/ui/PeriodPicker';
import { Modal } from '../components/ui/Modal';
import { CurrencyInput } from '../components/ui/CurrencyInput';
import { PageHeader } from '../components/ui/PageHeader';
import { PageContainer } from '../components/ui/PageContainer';
import { useConfirm } from '../components/ui/ConfirmDialog';
import { RequireAuth } from '../lib/auth';
import { useEffect, useMemo, useRef, useState } from 'react';
import { findCurrentPeriod, formatCurrency, cn, parseIdNominalToInt, formatIdNominalInput } from '../lib/utils';
import { api } from '../lib/api';
import { useQueryClient } from '@tanstack/react-query';
import {
  useApplyBudgetTemplateMutation,
  useBudgetCategoriesQuery,
  useBudgetComparisonQuery,
  useBudgetPeriodQuery,
  useBudgetPeriodsQuery,
  useBudgetQuery,
  useBudgetTemplatesQuery,
  useCreateBudgetLinesMutation,
  useCreateBudgetTemplateMutation,
  useCopyBudgetPeriodPlanMutation,
  useDeleteBudgetMutation,
  useDeleteBudgetTemplateMutation,
  useUpdateBudgetPeriodPlanMutation,
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
  Search,
  ArrowUp,
  ArrowDown,
  X,
  Sparkles,
  Info,
  Repeat,
  Tag,
  Pencil,
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
import { useDashboardSubscriptionsQuery } from '../features/dashboard/queries';
import { getSubscriptionDueByCategory } from '../features/budgets/subscription-budget';

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
  note: string | null;
}

interface BudgetSummaryData {
  plans: BudgetRow[];
  income: number;
  percentOfIncome: number;
  budgetNote: string | null;
  savingsTargetAmount: number;
  savingsTargetMode: 'amount' | 'income_percent';
  savingsTargetRate: number;
}

interface BudgetDraftLine {
  id: number;
  categoryId: string;
  plannedAmount: string;
  note: string;
  noteOpen: boolean;
}

interface Period {
  id: number;
  name: string;
  startDate: number;
  endDate: number;
  status: 'open' | 'closed';
  coverageStatus: 'complete' | 'partial' | 'skipped' | 'unknown';
  coverageReason: string | null;
  budgetNote?: string | null;
  savingsTargetAmount?: number;
  savingsTargetMode?: 'amount' | 'income_percent';
  savingsTargetRate?: number;
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

const budgetToolLinkClass = 'inline-flex shrink-0 items-center gap-2 rounded-full bg-[var(--ref-surface-container-low)] px-4 py-2.5 text-xs font-bold transition-all duration-150 hover:-translate-y-0.5 hover:bg-[var(--ref-primary)]/10 hover:text-[var(--ref-primary)] hover:shadow-sm active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)] focus-visible:outline-offset-2';

function BudgetPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: '/budget' }) as { periodId?: string };
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>(search.periodId || '');
  const [comparePeriodId, setComparePeriodId] = useState<string>('');
  const [reviewComparePeriodId, setReviewComparePeriodId] = useState<string>('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isApplyTemplateModalOpen, setIsApplyTemplateModalOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [isPeriodPlanModalOpen, setIsPeriodPlanModalOpen] = useState(false);
  const [budgetActionMessage, setBudgetActionMessage] = useState('');
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
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
    note: '',
  });
  const [budgetDraftLines, setBudgetDraftLines] = useState<BudgetDraftLine[]>([]);
  const [nextBudgetDraftId, setNextBudgetDraftId] = useState(1);
  const [draftMenuId, setDraftMenuId] = useState<number | null>(null);
  const [isBudgetReviewStep, setIsBudgetReviewStep] = useState(false);
  const [budgetDraftInsight, setBudgetDraftInsight] = useState<{ key: string; text: string } | null>(null);
  const [budgetDraftInsightError, setBudgetDraftInsightError] = useState<{ key: string; message: string } | null>(null);
  const [budgetDraftInsightLoadingKey, setBudgetDraftInsightLoadingKey] = useState<string | null>(null);
  const [budgetDraftInsightRetry, setBudgetDraftInsightRetry] = useState(0);
  const budgetDraftInsightCache = useRef(new Map<string, string>());
  const budgetDraftInsightRequests = useRef(new Map<string, Promise<string>>());
  const [isBudgetNoteOpen, setIsBudgetNoteOpen] = useState(false);
  const [isBudgetDropActive, setIsBudgetDropActive] = useState(false);

  const [periodPlanForm, setPeriodPlanForm] = useState({
    budgetNote: '',
    savingsTargetMode: 'amount' as 'amount' | 'income_percent',
    savingsTargetAmount: '',
    savingsTargetRate: '',
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
  const reviewComparisonQuery = useBudgetPeriodQuery(
    isBudgetReviewStep && reviewComparePeriodId ? parseInt(reviewComparePeriodId, 10) : null,
  );
  const comparisonQuery = useBudgetComparisonQuery(
    selectedPeriodId ? parseInt(selectedPeriodId, 10) : null,
    comparePeriodId ? parseInt(comparePeriodId, 10) : null,
  );
  const templatesQuery = useBudgetTemplatesQuery();
  const subscriptionsQuery = useDashboardSubscriptionsQuery();
  const createBudgetLinesMutation = useCreateBudgetLinesMutation();
  const updateBudgetMutation = useUpdateBudgetMutation();
  const deleteBudgetMutation = useDeleteBudgetMutation();
  const updateBudgetPeriodPlanMutation = useUpdateBudgetPeriodPlanMutation();
  const copyBudgetPeriodPlanMutation = useCopyBudgetPeriodPlanMutation();
  const createTemplateMutation = useCreateBudgetTemplateMutation();
  const applyTemplateMutation = useApplyBudgetTemplateMutation();
  const deleteTemplateMutation = useDeleteBudgetTemplateMutation();
  const periods = (periodsQuery.data ?? []) as Period[];
  const categories = (categoriesQuery.data ?? []) as Category[];
  const templates = (templatesQuery.data ?? []) as Template[];
  const budgetPayload = budgetQuery.data;
  const budgetSummary = (Array.isArray(budgetPayload) ? budgetPayload[0] : budgetPayload) as BudgetSummaryData | undefined;
  const budgetRows = budgetSummary?.plans ?? [];
  const reviewComparisonPayload = reviewComparisonQuery.data;
  const reviewComparisonSummary = (Array.isArray(reviewComparisonPayload) ? reviewComparisonPayload[0] : reviewComparisonPayload) as BudgetSummaryData | undefined | null;
  const reviewComparisonRows = reviewComparisonSummary?.plans ?? [];
  const periodIncome = budgetSummary?.income ?? 0;
  const budgetPercentOfIncome = budgetSummary?.percentOfIncome ?? 0;
  const comparisonData = (comparisonQuery.data ?? []) as ComparisonData[];
  const isLoading = periodsQuery.isLoading || categoriesQuery.isLoading || budgetQuery.isLoading || templatesQuery.isLoading || subscriptionsQuery.isLoading;
  const loadError = periodsQuery.error?.message ?? categoriesQuery.error?.message ?? budgetQuery.error?.message ?? templatesQuery.error?.message ?? null;

  useEffect(() => {
    const currentPeriod = findCurrentPeriod(periods);
    if (!selectedPeriodId && currentPeriod) setSelectedPeriodId(currentPeriod.id.toString());
  }, [periods, selectedPeriodId]);

  const loadData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.budgets.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.periods.all }),
    ]);
  };

  const selectedPeriod = periods.find((p) => p.id.toString() === selectedPeriodId);
  const selectedPeriodIndex = periods.findIndex((period) => period.id === selectedPeriod?.id);
  const previousBudgetPeriod = selectedPeriodIndex >= 0 ? periods[selectedPeriodIndex + 1] : undefined;
  const reviewComparisonPeriod = periods.find((period) => period.id.toString() === reviewComparePeriodId);
  const reviewComparisonTracksActuals = reviewComparisonPeriod?.coverageStatus === 'complete'
    || reviewComparisonPeriod?.coverageStatus === 'partial';
  const isPeriodClosed = selectedPeriod?.status === 'closed';
  const isPeriodTracked = selectedPeriod?.coverageStatus === 'complete' || selectedPeriod?.coverageStatus === 'partial';
  const subscriptionDueByCategory = useMemo(
    () => selectedPeriod
      ? getSubscriptionDueByCategory(
        subscriptionsQuery.data?.subscriptions ?? [],
        selectedPeriod.startDate,
        selectedPeriod.endDate,
      )
      : new Map<number, number>(),
    [selectedPeriod, subscriptionsQuery.data?.subscriptions],
  );

  const handleCreateBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (budgetDraftLines.length === 0) {
      setFormError('Add at least one category to your budget');
      return;
    }
    const categoryIds = budgetDraftLines.map((line) => Number(line.categoryId));
    if (new Set(categoryIds).size !== categoryIds.length) {
      setFormError('Each category can only be added once');
      setIsSubmitting(false);
      return;
    }
    const items = budgetDraftLines.map((line) => ({
      categoryId: Number(line.categoryId),
      plannedAmount: line.plannedAmount.trim() ? parseIdNominalToInt(line.plannedAmount) : Number.NaN,
      note: line.note.trim() || null,
    }));
    if (items.some((item) => !Number.isFinite(item.plannedAmount) || item.plannedAmount <= 0)) {
      setFormError('Enter a valid amount in IDR for every budget line');
      return;
    }

    const plannedTotalAfterSave = totalBudgeted + items.reduce((sum, item) => sum + item.plannedAmount, 0);
    let savingsTargetOverride: {
      savingsTargetAmount: number;
      savingsTargetMode: 'amount' | 'income_percent';
      savingsTargetRate: number;
    } | undefined;
    if (isPeriodTracked && periodIncome > 0 && plannedTotalAfterSave > periodIncome - savingsTargetAmount) {
      const adjustedSavingsAmount = Math.max(0, periodIncome - plannedTotalAfterSave);
      const adjustedSavingsRate = (adjustedSavingsAmount / periodIncome) * 100;
      const savingsMode = budgetSummary?.savingsTargetMode ?? 'amount';
      const overTargetAmount = plannedTotalAfterSave - (periodIncome - savingsTargetAmount);
      const goesOverIncome = plannedTotalAfterSave > periodIncome;
      const confirmed = await confirm({
        title: 'Adjust savings target?',
        message: `These allocations exceed your current savings-based budget limit by ${formatCurrency(overTargetAmount)}. If you continue, the savings target will be adjusted from ${formatCurrency(savingsTargetAmount)} to ${formatCurrency(adjustedSavingsAmount)} (${adjustedSavingsRate.toFixed(1)}% of income).${goesOverIncome ? ` Your allocations will also exceed income by ${formatCurrency(plannedTotalAfterSave - periodIncome)}.` : ''}`,
        confirmLabel: 'Save and adjust target',
        variant: 'warning',
      });
      if (!confirmed) return;
      savingsTargetOverride = {
        savingsTargetAmount: adjustedSavingsAmount,
        savingsTargetMode: savingsMode,
        savingsTargetRate: savingsMode === 'income_percent' ? adjustedSavingsRate : 0,
      };
    }

    setIsSubmitting(true);
    try {
      await createBudgetLinesMutation.mutateAsync({
        periodId: parseInt(selectedPeriodId, 10),
        items,
        ...(savingsTargetOverride && { savingsTargetOverride }),
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
      await updateBudgetMutation.mutateAsync({ id: editingBudget.id, data: { plannedAmount: amount, note: budgetForm.note.trim() || null } });
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
      const result = await applyTemplateMutation.mutateAsync({ templateId, data: {
        periodId: parseInt(selectedPeriodId, 10),
        replaceExisting,
      } });
      setIsApplyTemplateModalOpen(false);
      setSelectedTemplateId(null);
      setBudgetActionMessage(replaceExisting
        ? `Preset applied. ${result.applied} category allocations are now in the plan.`
        : `Preset merged. Added ${result.applied} new categor${result.applied === 1 ? 'y' : 'ies'}; kept ${result.skipped} existing.`);
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
    setBudgetDraftLines([]);
    setDraftMenuId(null);
    setReviewComparePeriodId(previousBudgetPeriod?.id.toString() ?? '');
    setIsBudgetReviewStep(false);
    setNextBudgetDraftId(0);
    setIsBudgetNoteOpen(false);
    setIsBudgetDropActive(false);
    setFormError('');
    setIsModalOpen(true);
  };

  const closeBudgetModal = () => {
    setIsModalOpen(false);
    setBudgetDraftLines([]);
    setDraftMenuId(null);
    setIsBudgetReviewStep(false);
    setIsBudgetDropActive(false);
    setFormError('');
  };

  const addBudgetDraftLine = (categoryId: number | string) => {
    const categoryIdString = String(categoryId);
    if (!categoryIdString || budgetRows.some((row) => String(row.categoryId) === categoryIdString)
      || budgetDraftLines.some((line) => line.categoryId === categoryIdString)) return;

    const suggestedAmount = subscriptionDueByCategory.get(Number(categoryIdString)) ?? 0;
    const formattedSuggestion = suggestedAmount > 0 ? formatIdNominalInput(String(suggestedAmount)) : '';
    const id = nextBudgetDraftId;
    setNextBudgetDraftId((current) => current + 1);
    setBudgetDraftLines((current) => [...current, {
      id,
      categoryId: categoryIdString,
      plannedAmount: formattedSuggestion,
      note: '',
      noteOpen: false,
    }]);
    setFormError('');
  };

  const continueToBudgetReview = () => {
    setFormError('');
    if (budgetDraftLines.length === 0) {
      setFormError('Add at least one category to your budget');
      return;
    }
    if (budgetDraftLines.some((line) => !line.plannedAmount.trim() || (parseIdNominalToInt(line.plannedAmount) || 0) <= 0)) {
      setFormError('Enter a valid amount in IDR for every budget line');
      return;
    }
    setIsBudgetDropActive(false);
    setIsBudgetReviewStep(true);
  };

  const openEditModal = (budget: BudgetRow) => {
    if (isPeriodClosed) return;
    setEditingBudget(budget);
    setIsBudgetNoteOpen(false);
    setBudgetForm({
      categoryId: budget.categoryId.toString(),
      plannedAmount: formatIdNominalInput(budget.plannedAmount.toString()),
      note: budget.note ?? '',
    });
    setFormError('');
    setIsEditModalOpen(true);
  };

  const closeEditModal = () => {
    setIsEditModalOpen(false);
    setEditingBudget(null);
    setBudgetForm({ categoryId: '', plannedAmount: '', note: '' });
    setIsBudgetNoteOpen(false);
    setFormError('');
  };

  const openPeriodPlanModal = () => {
    const mode = budgetSummary?.savingsTargetMode ?? 'amount';
    setPeriodPlanForm({
      budgetNote: budgetSummary?.budgetNote ?? '',
      savingsTargetMode: mode,
      savingsTargetAmount: budgetSummary?.savingsTargetAmount
        ? formatIdNominalInput(String(budgetSummary.savingsTargetAmount)) : '',
      savingsTargetRate: budgetSummary?.savingsTargetRate ? String(budgetSummary.savingsTargetRate) : '',
    });
    setFormError('');
    setIsPeriodPlanModalOpen(true);
  };

  const changeSavingsTargetMode = (nextMode: 'amount' | 'income_percent') => {
    setPeriodPlanForm((current) => {
      if (current.savingsTargetMode === nextMode) return current;

      if (nextMode === 'income_percent') {
        const amount = parseIdNominalToInt(current.savingsTargetAmount) || 0;
        return {
          ...current,
          savingsTargetMode: nextMode,
          savingsTargetRate: periodIncome > 0 ? ((amount / periodIncome) * 100).toFixed(2) : '',
        };
      }

      const rate = Number(current.savingsTargetRate) || 0;
      return {
        ...current,
        savingsTargetMode: nextMode,
        savingsTargetAmount: periodIncome > 0
          ? formatIdNominalInput(String(Math.round(periodIncome * rate / 100)))
          : current.savingsTargetAmount,
      };
    });
  };

  const handleUpdatePeriodPlan = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedPeriod) return;
    const savingsTargetAmount = periodPlanForm.savingsTargetMode === 'amount'
      ? periodPlanForm.savingsTargetAmount.trim() ? parseIdNominalToInt(periodPlanForm.savingsTargetAmount) : 0
      : budgetSummary?.savingsTargetAmount ?? 0;
    const savingsTargetRate = periodPlanForm.savingsTargetMode === 'income_percent'
      ? periodPlanForm.savingsTargetRate.trim() ? Number(periodPlanForm.savingsTargetRate) : 0
      : budgetSummary?.savingsTargetRate ?? 0;
    if (!Number.isFinite(savingsTargetAmount) || savingsTargetAmount < 0) {
      setFormError('Enter a valid savings target in IDR');
      return;
    }
    if (!Number.isFinite(savingsTargetRate) || savingsTargetRate < 0 || savingsTargetRate > 100) {
      setFormError('Enter a saving rate between 0 and 100%');
      return;
    }
    setFormError('');
    setIsSubmitting(true);
    try {
      await updateBudgetPeriodPlanMutation.mutateAsync({
        periodId: selectedPeriod.id,
        data: {
          budgetNote: periodPlanForm.budgetNote.trim() || null,
          savingsTargetAmount,
          savingsTargetMode: periodPlanForm.savingsTargetMode,
          savingsTargetRate,
        },
      });
      setIsPeriodPlanModalOpen(false);
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyPeriodPlan = async (sourcePeriodId: number) => {
    if (!selectedPeriod) return;
    setIsSubmitting(true);
    try {
      const result = await copyBudgetPeriodPlanMutation.mutateAsync({ periodId: selectedPeriod.id, sourcePeriodId });
      setBudgetActionMessage(`Copied ${result.copied} categories from ${periods.find((period) => period.id === sourcePeriodId)?.name ?? 'the previous period'}; kept ${result.skipped} existing.`);
    } catch (error) {
      alert((error as Error).message);
    } finally {
      setIsSubmitting(false);
    }
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
  const spendingProgress = totalBudgeted > 0 ? (totalSpent / totalBudgeted) * 100 : 0;
  const savingsTargetMode = budgetSummary?.savingsTargetMode ?? 'amount';
  const savingsTargetRate = budgetSummary?.savingsTargetRate ?? 0;
  const savingsTargetAmount = savingsTargetMode === 'income_percent'
    ? Math.round(periodIncome * savingsTargetRate / 100)
    : budgetSummary?.savingsTargetAmount ?? 0;
  const savingsRate = savingsTargetMode === 'income_percent'
    ? savingsTargetRate
    : periodIncome > 0 ? (savingsTargetAmount / periodIncome) * 100 : 0;
  const potentialSavingsAmount = periodIncome - totalBudgeted;
  const unassignedIncome = potentialSavingsAmount - savingsTargetAmount;
  const draftBudgetTotal = budgetDraftLines.reduce((sum, line) => sum + (parseIdNominalToInt(line.plannedAmount) || 0), 0);
  const categoryBudgetLimit = isPeriodTracked && periodIncome > 0 ? periodIncome - savingsTargetAmount : null;
  const availableBudgetBeforeDraft = categoryBudgetLimit == null ? null : categoryBudgetLimit - totalBudgeted;
  const availableBudgetAfterDraft = availableBudgetBeforeDraft == null ? null : availableBudgetBeforeDraft - draftBudgetTotal;
  const plannedBudgetAfterDraft = totalBudgeted + draftBudgetTotal;
  const plannedIncomeRemainder = periodIncome - plannedBudgetAfterDraft;
  const plannedSavingsTargetAfterDraft = isPeriodTracked && periodIncome > 0
    && plannedBudgetAfterDraft > periodIncome - savingsTargetAmount
    ? Math.max(0, plannedIncomeRemainder)
    : savingsTargetAmount;
  const plannedSavingsRateAfterDraft = periodIncome > 0 ? (plannedSavingsTargetAfterDraft / periodIncome) * 100 : 0;
  const plannedIncomeLeftAfterSavings = plannedIncomeRemainder - plannedSavingsTargetAfterDraft;
  const budgetFooterRemaining = isBudgetReviewStep && periodIncome > 0 ? plannedIncomeLeftAfterSavings : availableBudgetAfterDraft;
  const savingsTargetWillAdjust = isPeriodTracked && periodIncome > 0
    && plannedBudgetAfterDraft > periodIncome - savingsTargetAmount;
  const budgetChartPalette = ['#3157c8', '#18a27a', '#e39a2b', '#8b5cf6', '#e05b72', '#2999b5', '#82913a'];
  const budgetReviewAllocations = [
    ...budgetRows.map((row, index) => ({
      key: `existing-${row.id}`,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      plannedAmount: row.plannedAmount,
      note: row.note ?? null,
      isNew: false,
      color: categories.find((category) => category.id === row.categoryId)?.color ?? budgetChartPalette[index % budgetChartPalette.length],
    })),
    ...budgetDraftLines.map((line, index) => ({
      key: `draft-${line.id}`,
      categoryId: Number(line.categoryId),
      categoryName: categories.find((category) => String(category.id) === line.categoryId)?.name ?? 'Category',
      plannedAmount: parseIdNominalToInt(line.plannedAmount) || 0,
      note: line.note || null,
      isNew: true,
      color: categories.find((category) => String(category.id) === line.categoryId)?.color ?? budgetChartPalette[(budgetRows.length + index) % budgetChartPalette.length],
    })),
  ].sort((left, right) => right.plannedAmount - left.plannedAmount);
  const incomePlanCategoryShare = periodIncome > 0 ? Math.min(100, plannedBudgetAfterDraft / periodIncome * 100) : 0;
  const incomePlanSavingsShare = periodIncome > 0
    ? Math.min(Math.max(0, 100 - incomePlanCategoryShare), plannedSavingsTargetAfterDraft / periodIncome * 100)
    : 0;
  const incomePlanUnassignedShare = Math.max(0, 100 - incomePlanCategoryShare - incomePlanSavingsShare);
  const incomePlanColors = { budgeted: '#B9D1FF', savings: '#FFC46B', unassigned: '#55D6BE' };
  const reviewCurrentByCategory = new Map(budgetReviewAllocations.map((allocation) => [allocation.categoryId, allocation]));
  const reviewComparisonByCategory = new Map(reviewComparisonRows.map((row) => [row.categoryId, row]));
  const reviewComparisonCategoryChanges = budgetReviewAllocations
    .map((current) => {
      const previous = reviewComparisonByCategory.get(current.categoryId);
      return {
        categoryName: current.categoryName,
        currentPlanned: current.plannedAmount,
        previousPlanned: previous?.plannedAmount ?? 0,
        previousActual: previous?.actualAmount ?? 0,
        hasPreviousPlan: Boolean(previous),
        difference: current.plannedAmount - (previous?.plannedAmount ?? 0),
        spentDifference: reviewComparisonTracksActuals
          ? current.plannedAmount - (previous?.actualAmount ?? 0)
          : null,
      };
    })
    .filter((change) => change.hasPreviousPlan && (
      change.difference !== 0 || (change.spentDifference != null && change.spentDifference !== 0)
    ))
    .sort((left, right) => {
      const leftMagnitude = Math.max(Math.abs(left.difference), Math.abs(left.spentDifference ?? 0));
      const rightMagnitude = Math.max(Math.abs(right.difference), Math.abs(right.spentDifference ?? 0));
      return rightMagnitude - leftMagnitude;
    })
    .slice(0, 3);
  const reviewComparisonBarMax = Math.max(
    1,
    ...reviewComparisonCategoryChanges.flatMap((change) => [change.currentPlanned, change.previousPlanned]),
  );
  const newlyPlannedComparedCategories = budgetReviewAllocations
    .filter((allocation) => !reviewComparisonByCategory.has(allocation.categoryId));
  const noLongerPlannedComparedCategories = reviewComparisonRows
    .filter((row) => !reviewCurrentByCategory.has(row.categoryId) && row.actualAmount > 0)
    .sort((left, right) => right.actualAmount - left.actualAmount);
  const budgetDraftInsightKey = JSON.stringify({
    promptVersion: 2,
    periodName: selectedPeriod?.name ?? 'Selected period',
    income: periodIncome,
    currentSavingsTarget: savingsTargetAmount,
    proposedSavingsTarget: plannedSavingsTargetAfterDraft,
    categories: budgetReviewAllocations.map(({ categoryName, plannedAmount, note }) => ({ name: categoryName, plannedAmount, note })),
  });
  const currentBudgetDraftInsight = budgetDraftInsight?.key === budgetDraftInsightKey ? budgetDraftInsight.text : null;
  const currentBudgetDraftInsightError = budgetDraftInsightError?.key === budgetDraftInsightKey ? budgetDraftInsightError.message : null;
  const isGeneratingBudgetDraftInsight = budgetDraftInsightLoadingKey === budgetDraftInsightKey;
  const availableCategories = categories.filter((category) =>
    !budgetRows.some((row) => row.categoryId === category.id)
    && !budgetDraftLines.some((line) => Number(line.categoryId) === category.id),
  );
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
  const selectedTemplateExistingCount = selectedTemplate
    ? selectedTemplate.items.filter((item) => budgetRows.some((row) => row.categoryId === item.categoryId)).length
    : 0;
  const selectedTemplateMissingCount = selectedTemplate ? selectedTemplate.items.length - selectedTemplateExistingCount : 0;

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
        note: null,
        share: Math.round((omitted / totalBudgeted) * 100),
        color: '#a0a4b0',
      });
    }
    return visible;
  }, [budgetRows, totalBudgeted, categories, selectedPeriodId]);

  useEffect(() => {
    if (!isBudgetReviewStep) return;

    const cachedInsight = budgetDraftInsightCache.current.get(budgetDraftInsightKey);
    if (cachedInsight != null) {
      setBudgetDraftInsight({ key: budgetDraftInsightKey, text: cachedInsight });
      setBudgetDraftInsightLoadingKey(null);
      setBudgetDraftInsightError(null);
      return;
    }

    let cancelled = false;
    setBudgetDraftInsightError(null);
    setBudgetDraftInsightLoadingKey(budgetDraftInsightKey);
    let request = budgetDraftInsightRequests.current.get(budgetDraftInsightKey);
    if (!request) {
      const payload = JSON.parse(budgetDraftInsightKey) as Parameters<typeof api.insights.generateBudgetDraft>[0];
      request = api.insights.generateBudgetDraft(payload).then((response) => response.insight);
      budgetDraftInsightRequests.current.set(budgetDraftInsightKey, request);
    }

    void request
      .then((insight) => {
        budgetDraftInsightCache.current.set(budgetDraftInsightKey, insight);
        if (!cancelled) setBudgetDraftInsight({ key: budgetDraftInsightKey, text: insight });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBudgetDraftInsightError({
            key: budgetDraftInsightKey,
            message: error instanceof Error ? error.message : 'Could not generate an AI insight.',
          });
        }
      })
      .finally(() => {
        if (budgetDraftInsightRequests.current.get(budgetDraftInsightKey) === request) {
          budgetDraftInsightRequests.current.delete(budgetDraftInsightKey);
        }
        if (!cancelled) setBudgetDraftInsightLoadingKey((current) => current === budgetDraftInsightKey ? null : current);
      });

    return () => { cancelled = true; };
  }, [isBudgetReviewStep, budgetDraftInsightKey, budgetDraftInsightRetry]);

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
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <PageHeader
            subtext="Plan this salary period"
            title="Budget"
            description={
              selectedPeriod
                ? `${formatPeriodRange(selectedPeriod)}${isPeriodClosed ? ' · Closed — read only' : ''}`
                : 'Give every rupiah a purpose and keep spending on track.'
            }
          />
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {periods.length > 0 && (
              <PeriodPicker
                periods={periods}
                value={selectedPeriodId}
                onChange={(periodId) => {
                  setSelectedPeriodId(periodId);
                  void navigate({ to: '/budget', search: { periodId }, replace: true });
                }}
                getPeriodLabel={(period) => `${period.name}${period.status === 'closed' ? ' (closed)' : ''}`}
                ariaLabel="Budget period"
              />
            )}
            
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 rounded-full px-4"
              onClick={() => { setSelectedTemplateId(null); setIsApplyTemplateModalOpen(true); }}
              disabled={!selectedPeriod || isPeriodClosed}
            >
              <Copy className="h-4 w-4" />
              Presets
            </Button>
            
            <Button
              className="min-h-11 rounded-full px-5 shadow-lg shadow-[var(--color-accent)]/20"
              onClick={openBudgetModal}
              disabled={!selectedPeriod || isPeriodClosed}
            >
              {budgetRows.length === 0 ? <Plus className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
              {budgetRows.length === 0 ? 'Manage budget' : 'Modify budget'}
            </Button>
          </div>
        </div>

        <nav aria-label="Budget planning tools" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          <Link to="/subscriptions" className={budgetToolLinkClass}><Repeat className="h-3.5 w-3.5" />Recurring commitments</Link>
          <Link to="/wishlist" className={budgetToolLinkClass}><Sparkles className="h-3.5 w-3.5" />Planned purchases</Link>
          <Link to="/categories" className={budgetToolLinkClass}><Tag className="h-3.5 w-3.5" />Manage categories</Link>
          <Link to="/savings-simulator" className={budgetToolLinkClass}>Savings simulator</Link>
        </nav>

        {loadError && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-[var(--color-danger)]/25 bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]">
            <span>Budget data could not be refreshed. Showing the last available snapshot.</span>
            <button type="button" onClick={() => void loadData()} className="shrink-0 font-semibold underline">Try again</button>
          </div>
        )}
        {budgetActionMessage && (
          <div role="status" className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--color-success)]/25 bg-[var(--color-success)]/10 px-4 py-3 text-sm text-[var(--ref-on-surface)]">
            <span>{budgetActionMessage}</span>
            <button type="button" onClick={() => setBudgetActionMessage('')} aria-label="Dismiss message" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-[var(--color-success)]/10"><X className="h-4 w-4" /></button>
          </div>
        )}

        {/* Period overview */}
        {selectedPeriod && (
          <section className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.85fr)]">
            <div className="relative overflow-hidden rounded-[2rem] bg-[var(--ref-primary-container)] p-6 text-white shadow-lg sm:p-8">
              <div className="relative z-10 flex min-h-[220px] flex-col justify-between">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/70">Spent this period</p>
                    <p className="mt-3 font-headline text-3xl font-extrabold tracking-tight sm:text-5xl">
                      {isPeriodTracked ? formatCurrency(totalSpent) : 'Not tracked'}
                    </p>
                    <p className="mt-2 text-sm font-medium text-white/70">of {formatCurrency(totalBudgeted)} planned</p>
                    {budgetSummary?.budgetNote && (
                      <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/85">“{budgetSummary.budgetNote}”</p>
                    )}
                  </div>
                  <span className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold backdrop-blur">
                    {isPeriodTracked ? `${Math.round(spendingProgress)}% used` : 'Incomplete data'}
                  </span>
                </div>
                <div className="mt-10">
                  <div className="h-3 overflow-hidden rounded-full bg-white/20">
                    <div
                      className={cn('h-full rounded-full transition-all', spendingProgress > 100 ? 'bg-rose-300' : 'bg-white')}
                      style={{ width: `${Math.min(spendingProgress, 100)}%` }}
                    />
                  </div>
                  <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="text-xs text-white/65">Remaining in budget</p>
                      <p className={cn('mt-1 text-xl font-bold sm:text-2xl', totalRemaining < 0 && 'text-rose-200')}>
                        {isPeriodTracked ? formatCurrency(totalRemaining) : '—'}
                      </p>
                    </div>
                    <p className="text-xs font-semibold text-white/70">{budgetRows.length} categor{budgetRows.length === 1 ? 'y' : 'ies'} planned</p>
                  </div>
                </div>
              </div>
              <div className="absolute -bottom-20 -right-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
            </div>

            <div className="rounded-[2rem] border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 editorial-shadow sm:p-7">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]">
                    <PiggyBank className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">Income plan</p>
                    <p className="mt-1 font-headline text-2xl font-bold text-[var(--ref-on-surface)]">
                      {isPeriodTracked ? formatCurrency(periodIncome) : 'Not tracked'}
                    </p>
                  </div>
                </div>
                {!isPeriodClosed && (
                  <button type="button" onClick={openPeriodPlanModal} className="grid h-10 w-10 place-items-center rounded-xl text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]" aria-label="Edit period plan" title="Edit period plan">
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="my-6 h-px bg-[var(--color-border)]" />
              <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                <div>
                  <p className="text-xs text-[var(--ref-on-surface-variant)]">Spending allocation</p>
                  <p className="mt-1 text-lg font-bold text-[var(--ref-on-surface)]">{budgetPercentOfIncome}%</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--ref-on-surface-variant)]">Saving rate</p>
                  <p className="mt-1 text-lg font-bold text-[var(--color-success)]">
                    {isPeriodTracked && (periodIncome > 0 || savingsTargetMode === 'income_percent') ? `${savingsRate.toFixed(1)}%` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--ref-on-surface-variant)]">Savings target</p>
                  <p className="mt-1 text-lg font-bold text-[var(--ref-on-surface)]">
                    {!isPeriodTracked ? '—' : savingsTargetMode === 'income_percent' && periodIncome <= 0 ? 'Add income' : formatCurrency(savingsTargetAmount)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--ref-on-surface-variant)]">Still unassigned</p>
                  <p className={cn('mt-1 text-lg font-bold', unassignedIncome < 0 ? 'text-[var(--ref-error)]' : 'text-[var(--ref-on-surface)]')}>
                    {isPeriodTracked && periodIncome > 0 ? formatCurrency(unassignedIncome) : '—'}
                  </p>
                </div>
              </div>
              {isPeriodTracked && periodIncome > 0 && (
                <p className="mt-6 rounded-2xl bg-[var(--ref-surface-container-low)] px-4 py-3 text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">
                  {unassignedIncome >= 0
                    ? `${formatCurrency(unassignedIncome)} is still available to assign to spending or savings.`
                    : `This plan exceeds income and savings capacity by ${formatCurrency(Math.abs(unassignedIncome))}.`}
                </p>
              )}
            </div>
          </section>
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

        {/* Budget controls */}
        {selectedPeriod && budgetRows.length > 0 && (
          <section className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3 shadow-sm sm:p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_190px_220px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" />
                <input
                  type="search"
                  aria-label="Search budget categories"
                  placeholder="Search budget categories"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-12 w-full rounded-2xl border border-transparent bg-[var(--ref-surface-container-low)] pl-11 pr-4 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-muted)] focus:border-[var(--ref-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ref-primary)]/15"
                />
              </div>
              <label className="relative">
                <span className="pointer-events-none absolute left-4 top-2 text-[9px] font-bold uppercase tracking-wider text-[var(--color-muted)]">Compare to</span>
                <select
                  aria-label="Compare budget period"
                  value={comparePeriodId}
                  onChange={(e) => setComparePeriodId(e.target.value)}
                  className="h-12 w-full cursor-pointer rounded-2xl border border-[var(--color-border)] bg-transparent px-4 pb-1 pt-4 text-sm font-semibold text-[var(--color-text-primary)] focus:border-[var(--ref-primary)] focus:ring-2 focus:ring-[var(--ref-primary)]/15"
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
              </label>
              <div className="flex items-center gap-2">
                <label className="relative min-w-0 flex-1">
                  <span className="pointer-events-none absolute left-4 top-2 text-[9px] font-bold uppercase tracking-wider text-[var(--color-muted)]">Sort by</span>
                  <select
                    aria-label="Sort budget categories"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    className="h-12 w-full cursor-pointer rounded-2xl border border-[var(--color-border)] bg-transparent px-4 pb-1 pt-4 text-sm font-semibold text-[var(--color-text-primary)] focus:border-[var(--ref-primary)] focus:ring-2 focus:ring-[var(--ref-primary)]/15"
                  >
                    <option value="name">Name</option>
                    <option value="percentUsed">% Used</option>
                    <option value="amountSpent">Amount Spent</option>
                    <option value="variance">Variance</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[var(--color-border)] text-[var(--color-muted)] transition-colors hover:bg-[var(--ref-surface-container-low)] hover:text-[var(--color-text-primary)]"
                  title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
                  aria-label={sortDirection === 'asc' ? 'Sort ascending' : 'Sort descending'}
                >
                  {sortDirection === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] px-1 pt-3">
              {[
                { value: 'all', label: 'All', count: stats.total },
                { value: 'over', label: 'Over', count: stats.over },
                { value: 'near', label: 'Near limit', count: stats.near },
                { value: 'under', label: 'On track', count: stats.under },
                { value: 'notStarted', label: 'Not started', count: stats.notStarted },
              ].map((filter) => (
                <button
                  type="button"
                  key={filter.value}
                  onClick={() => setFilterBy(filter.value as FilterOption)}
                  className={cn(
                    'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all',
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

              {activeFiltersCount > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setFilterBy('all');
                      setSearchQuery('');
                    }}
                    className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold text-[var(--color-muted)] transition-colors hover:bg-[var(--ref-surface-container-high)] hover:text-[var(--color-text-primary)]"
                  >
                    <X className="h-3 w-3" />
                    Clear
                  </button>
                </>
              )}
            </div>
          </section>
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
          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 editorial-shadow sm:p-10">
            <div className="mx-auto max-w-2xl text-center">
              <Target className="mx-auto mb-4 h-12 w-12 text-[var(--ref-primary)]" />
              <p className="font-headline text-2xl font-bold text-[var(--ref-on-surface)]">Build your plan for {selectedPeriod.name}</p>
              <p className="mx-auto mt-2 max-w-lg text-sm text-[var(--ref-on-surface-variant)]">
                Start from a familiar plan or build this period around what matters now. You can adjust every amount afterward.
              </p>
            </div>
            <div className="mx-auto mt-7 grid max-w-3xl gap-3 md:grid-cols-3">
              {previousBudgetPeriod && (
                <button type="button" onClick={() => void copyPeriodPlan(previousBudgetPeriod.id)} disabled={isPeriodClosed || isSubmitting} className="rounded-2xl border border-[var(--color-border)] p-5 text-left transition-colors hover:border-[var(--ref-primary)] hover:bg-[var(--ref-primary)]/5 disabled:opacity-50">
                  <Copy className="h-5 w-5 text-[var(--ref-primary)]" />
                  <strong className="mt-3 block text-sm">Copy previous period</strong>
                  <span className="mt-1 block text-xs text-[var(--ref-on-surface-variant)]">Use {previousBudgetPeriod.name} as your baseline.</span>
                </button>
              )}
              <button type="button" onClick={() => { setSelectedTemplateId(null); setIsApplyTemplateModalOpen(true); }} disabled={isPeriodClosed} className="rounded-2xl border border-[var(--color-border)] p-5 text-left transition-colors hover:border-[var(--ref-primary)] hover:bg-[var(--ref-primary)]/5 disabled:opacity-50">
                <Save className="h-5 w-5 text-[var(--ref-primary)]" />
                <strong className="mt-3 block text-sm">Use a preset</strong>
                <span className="mt-1 block text-xs text-[var(--ref-on-surface-variant)]">Apply a reusable spending baseline.</span>
              </button>
              <button type="button" onClick={openBudgetModal} disabled={isPeriodClosed} className="rounded-2xl border border-[var(--color-border)] p-5 text-left transition-colors hover:border-[var(--ref-primary)] hover:bg-[var(--ref-primary)]/5 disabled:opacity-50">
                <Plus className="h-5 w-5 text-[var(--ref-primary)]" />
                <strong className="mt-3 block text-sm">Start from scratch</strong>
                <span className="mt-1 block text-xs text-[var(--ref-on-surface-variant)]">Add your first category allocation.</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-3">
            {/* Budget progress */}
            <div className="lg:col-span-2">
              <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-4 shadow-sm sm:p-6">
                <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <h2 className="font-headline text-xl font-bold text-[var(--ref-on-surface)]">Category budgets</h2>
                    <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">Open a category to review its transactions.</p>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">
                    {filteredAndSortedRows.length} of {budgetRows.length} categories
                  </span>
                </div>
                <ul className="space-y-2">
                  {filteredAndSortedRows.map((row) => {
                    const pct = row.plannedAmount > 0 ? (row.actualAmount / row.plannedAmount) * 100 : 0;
                    const comparison = getComparisonForRow(row);
                    const cat = categories.find((c) => c.id === row.categoryId);
                    const categoryColor = cat?.color || 'var(--ref-primary)';
                    return (
                      <li key={row.id} className="group">
                        <div className="rounded-2xl border border-transparent p-4 transition-colors hover:border-[var(--color-border)] hover:bg-[var(--ref-surface-container-low)]">
                          <div className="flex items-center gap-3">
                            <Link
                              to="/transactions"
                              search={{ periodId: selectedPeriodId, categoryId: String(row.categoryId) }}
                              className="min-w-0 flex-1"
                            >
                              <div className="mb-1 flex items-center gap-2">
                                <p className="truncate text-sm font-bold text-[var(--color-text-primary)] transition-colors hover:text-[var(--color-accent)]">
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
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--color-text-secondary)]">
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
                              {row.note && <p className="mt-1.5 truncate text-xs italic text-[var(--ref-on-surface-variant)]">{row.note}</p>}
                            </Link>
                            <div className="flex items-center gap-3 sm:gap-4">
                              {isPeriodTracked && (
                                <div className="hidden min-w-[104px] text-right sm:block">
                                  <p className={cn('text-sm font-bold tabular-nums', row.variance < 0 ? 'text-[var(--ref-error)]' : 'text-[var(--ref-on-surface)]')}>
                                    {formatCurrency(row.variance)}
                                  </p>
                                  <p className="text-[10px] text-[var(--ref-on-surface-variant)]">remaining</p>
                                </div>
                              )}
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
                          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]">
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

            {/* Supporting context */}
            <div className="space-y-6">
              <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 editorial-shadow">
                <h2 className="font-headline text-lg font-bold text-[var(--ref-on-surface)]">Budget health</h2>
                <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">How your categories are tracking right now.</p>
                <div className="mt-5 grid grid-cols-2 gap-2">
                  {[
                    { label: 'Over', value: stats.over, color: 'var(--ref-error)', surface: 'var(--ref-error)' },
                    { label: 'Near limit', value: stats.near, color: 'var(--color-warning)', surface: 'var(--color-warning)' },
                    { label: 'On track', value: stats.under, color: 'var(--color-success)', surface: 'var(--color-success)' },
                    { label: 'Not started', value: stats.notStarted, color: 'var(--color-text-primary)', surface: 'var(--ref-surface-container-high)' },
                  ].map((item) => (
                    <div key={item.label} className="rounded-2xl px-4 py-3" style={{ backgroundColor: `color-mix(in srgb, ${item.surface} 10%, transparent)` }}>
                      <p className="text-2xl font-extrabold" style={{ color: item.color }}>{item.value}</p>
                      <p className="mt-1 text-xs font-semibold text-[var(--ref-on-surface-variant)]">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Budget mix */}
              <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 editorial-shadow">
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

        {/* Period plan modal */}
        <Modal
          isOpen={isPeriodPlanModalOpen}
          onClose={() => setIsPeriodPlanModalOpen(false)}
          title="Plan this period"
          subtitle="Set the intention and savings target that guide this budget."
          size="xl"
        >
          <form onSubmit={handleUpdatePeriodPlan} className="space-y-5">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--color-text-primary)]">What is different about this period?</span>
              <textarea
                value={periodPlanForm.budgetNote}
                onChange={(event) => setPeriodPlanForm({ ...periodPlanForm, budgetNote: event.target.value })}
                rows={4}
                maxLength={2000}
                placeholder="e.g., Comifuro month — intentionally increasing Hobby for tickets, transport, and merchandise."
                className="w-full resize-none rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-4 py-3 text-sm outline-none focus:border-[var(--ref-primary)] focus:ring-2 focus:ring-[var(--ref-primary)]/15"
              />
            </label>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">Savings target</legend>
              <div role="group" aria-label="Savings target type" className="grid grid-cols-2 gap-2 rounded-2xl bg-[var(--ref-surface-container-low)] p-1.5">
                {[
                  { value: 'amount', label: 'Fixed amount' },
                  { value: 'income_percent', label: '% of period income' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={periodPlanForm.savingsTargetMode === option.value}
                    onClick={() => changeSavingsTargetMode(option.value as 'amount' | 'income_percent')}
                    className={cn(
                      'min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors',
                      periodPlanForm.savingsTargetMode === option.value
                        ? 'bg-[var(--ref-surface-container-lowest)] text-[var(--ref-primary)] shadow-sm'
                        : 'text-[var(--ref-on-surface-variant)] hover:text-[var(--ref-on-surface)]',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
            {periodPlanForm.savingsTargetMode === 'amount' ? (
              <CurrencyInput
                label="Amount to save"
                value={periodPlanForm.savingsTargetAmount}
                onChange={(value) => setPeriodPlanForm({ ...periodPlanForm, savingsTargetAmount: value })}
                size="md"
                error={formError}
              />
            ) : (
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--color-text-primary)]">Percent of period income to save</span>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    inputMode="decimal"
                    aria-label="Savings percentage of income"
                    value={periodPlanForm.savingsTargetRate}
                    onChange={(event) => setPeriodPlanForm({ ...periodPlanForm, savingsTargetRate: event.target.value })}
                    className="h-12 w-full rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-4 pr-16 text-sm outline-none focus:border-[var(--ref-primary)] focus:ring-2 focus:ring-[var(--ref-primary)]/15"
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--ref-on-surface-variant)]">%</span>
                </div>
              </label>
            )}
            <div className="rounded-2xl bg-[var(--ref-surface-container-low)] p-4 text-sm text-[var(--ref-on-surface-variant)]">
              {periodIncome > 0
                ? periodPlanForm.savingsTargetMode === 'income_percent'
                  ? `That’s ${formatCurrency(Math.round(periodIncome * (Number(periodPlanForm.savingsTargetRate) || 0) / 100))} at the current recorded income of ${formatCurrency(periodIncome)}.`
                  : `That’s ${((parseIdNominalToInt(periodPlanForm.savingsTargetAmount) || 0) / periodIncome * 100).toFixed(1)}% of the current recorded income.`
                : 'The saving rate will appear after income is recorded for this period.'}
            </div>
            <div className="flex flex-wrap gap-3 pt-2">
              <Button type="submit" isLoading={isSubmitting}>Save period plan</Button>
              <Button type="button" variant="secondary" onClick={() => setIsPeriodPlanModalOpen(false)}>Cancel</Button>
            </div>
          </form>
        </Modal>

        {/* Create Budget Modal */}
        <Modal
          isOpen={isModalOpen}
          onClose={closeBudgetModal}
          title={isBudgetReviewStep ? 'Review your budget' : 'Build your budget'}
          subtitle={isBudgetReviewStep
            ? `Review the plan for ${selectedPeriod?.name} before saving.`
            : `Add categories for ${selectedPeriod?.name}. Available budget already accounts for your savings target.`}
          size="xl"
          footer={(
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className={cn('min-w-0', isBudgetReviewStep ? 'px-1' : 'flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl bg-[var(--ref-surface-container-low)] px-4 py-2.5 text-sm')}>
                {isBudgetReviewStep && <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ref-primary)]">Ready to save</p>}
                <div className={cn(
                  'flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1',
                  isBudgetReviewStep && 'mt-0.5 gap-x-2 gap-y-0.5',
                )}>
                  <span className="text-sm text-[var(--ref-on-surface-variant)]">
                    {isBudgetReviewStep
                      ? `${budgetReviewAllocations.length} categories · ${formatCurrency(plannedBudgetAfterDraft)} planned`
                      : `${budgetDraftLines.length} categor${budgetDraftLines.length === 1 ? 'y' : 'ies'} · ${formatCurrency(draftBudgetTotal)} planned`}
                  </span>
                  <span className={cn('text-sm font-semibold', budgetFooterRemaining != null && budgetFooterRemaining < 0 ? 'text-[var(--ref-error)]' : 'text-[var(--ref-on-surface)]')}>
                  {isBudgetReviewStep && periodIncome > 0
                    ? plannedIncomeRemainder - plannedSavingsTargetAfterDraft < 0
                      ? `Over income by ${formatCurrency(Math.abs(plannedIncomeRemainder))}`
                      : `${formatCurrency(plannedIncomeRemainder - plannedSavingsTargetAfterDraft)} left after savings`
                    : availableBudgetAfterDraft == null
                      ? isPeriodTracked ? 'Add income to see what remains' : 'Income tracking unavailable'
                      : availableBudgetAfterDraft < 0
                        ? `Over by ${formatCurrency(Math.abs(availableBudgetAfterDraft))}`
                        : `${formatCurrency(availableBudgetAfterDraft)} left after savings`}
                  </span>
                </div>
              </div>
              <div className="flex gap-3">
                {isBudgetReviewStep ? (
                  <>
                    <Button type="button" variant="secondary" onClick={() => { setIsBudgetReviewStep(false); setFormError(''); }}>Back</Button>
                    <Button type="submit" form="create-budget-form" isLoading={isSubmitting} disabled={budgetDraftLines.length === 0} className="min-w-[140px]">
                      Save budget
                    </Button>
                  </>
                ) : (
                  <Button type="button" onClick={continueToBudgetReview} disabled={budgetDraftLines.length === 0} className="min-w-[140px]">
                    Review plan
                  </Button>
                )}
                <Button type="button" variant="secondary" onClick={closeBudgetModal}>Cancel</Button>
              </div>
            </div>
          )}
        >
          <form
            id="create-budget-form"
            onSubmit={(event) => {
              if (isBudgetReviewStep) void handleCreateBudget(event);
              else {
                event.preventDefault();
                continueToBudgetReview();
              }
            }}
            className="space-y-5"
          >
            {isBudgetReviewStep ? (
              <div className="grid items-start gap-4 lg:grid-cols-[minmax(280px,0.78fr)_minmax(0,1.22fr)]">
                <div className="space-y-3">
                  <section className="overflow-hidden rounded-3xl bg-[var(--ref-primary)] p-5 text-white">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] opacity-75">Plan at a glance</p>
                    <p className="mt-2 text-3xl font-extrabold tabular-nums tracking-tight">{formatCurrency(plannedBudgetAfterDraft)}</p>
                    <p className="mt-1 text-xs opacity-75">Planned across {budgetReviewAllocations.length} categories</p>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <div className="rounded-2xl bg-white/10 px-3 py-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">Share of income</p>
                        <p className="mt-0.5 text-lg font-bold tabular-nums">{periodIncome > 0 ? `${(plannedBudgetAfterDraft / periodIncome * 100).toFixed(1)}%` : '—'}</p>
                      </div>
                      <div className="rounded-2xl bg-white/10 px-3 py-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">Left after savings</p>
                        <p className="mt-0.5 truncate text-lg font-bold tabular-nums">
                          {periodIncome > 0
                            ? plannedIncomeLeftAfterSavings < 0 ? `Over ${formatCurrency(Math.abs(plannedIncomeLeftAfterSavings))}` : formatCurrency(plannedIncomeLeftAfterSavings)
                            : '—'}
                        </p>
                      </div>
                    </div>

                {periodIncome > 0 && (
                  <div className="mt-5 border-t border-white/20 pt-4" aria-label="Income allocation chart">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <h3 className="text-xs font-bold">Income allocation</h3>
                      <span className="text-[10px] font-semibold opacity-70">{formatCurrency(periodIncome)} income</span>
                    </div>
                    <div
                      role="img"
                      aria-label={`Income split: budgeted ${formatCurrency(plannedBudgetAfterDraft)}, savings target ${formatCurrency(plannedSavingsTargetAfterDraft)}, unassigned ${formatCurrency(plannedIncomeLeftAfterSavings)}`}
                      className="flex h-3 overflow-hidden rounded-full bg-white/10"
                    >
                      {incomePlanCategoryShare > 0 && <span className="h-full" style={{ width: `${incomePlanCategoryShare}%`, backgroundColor: incomePlanColors.budgeted }} />}
                      {incomePlanSavingsShare > 0 && <span className="h-full" style={{ width: `${incomePlanSavingsShare}%`, backgroundColor: incomePlanColors.savings }} />}
                      {incomePlanUnassignedShare > 0 && <span className="h-full flex-1" style={{ backgroundColor: incomePlanColors.unassigned }} />}
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] leading-tight">
                      <div className="min-w-0">
                        <span className="flex items-center gap-1 opacity-80"><i className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: incomePlanColors.budgeted }} />Budgeted</span>
                        <strong className="mt-0.5 block truncate tabular-nums">{formatCurrency(plannedBudgetAfterDraft)}</strong>
                      </div>
                      <div className="min-w-0">
                        <span className="flex items-center gap-1 opacity-80"><i className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: incomePlanColors.savings }} />Savings</span>
                        <strong className="mt-0.5 block truncate tabular-nums">{formatCurrency(plannedSavingsTargetAfterDraft)}</strong>
                      </div>
                      <div className="min-w-0">
                        <span className="flex items-center gap-1 opacity-80"><i className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: incomePlanColors.unassigned }} />Unassigned</span>
                        <strong className="mt-0.5 block truncate tabular-nums">
                          {plannedIncomeLeftAfterSavings < 0 ? `Over ${formatCurrency(Math.abs(plannedIncomeLeftAfterSavings))}` : formatCurrency(plannedIncomeLeftAfterSavings)}
                        </strong>
                      </div>
                    </div>
                  </div>
                )}
                  </section>

                {isPeriodTracked && periodIncome > 0 && savingsTargetWillAdjust && (
                  <section className="rounded-2xl border border-[var(--ref-error)]/30 bg-[var(--ref-error)]/5 px-4 py-3">
                    <h3 className="text-sm font-bold text-[var(--ref-on-surface)]">Savings target will change</h3>
                    <p className="text-sm text-[var(--ref-on-surface-variant)]">
                      {formatCurrency(savingsTargetAmount)} ({savingsRate.toFixed(1)}%) → {formatCurrency(plannedSavingsTargetAfterDraft)} ({plannedSavingsRateAfterDraft.toFixed(1)}% of income). You’ll confirm before saving.
                    </p>
                  </section>
                )}

                <section className="rounded-2xl border border-[var(--ref-primary)]/20 bg-[var(--ref-primary)]/5 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 shrink-0 text-[var(--ref-primary)]" />
                    <h3 className="text-sm font-bold text-[var(--ref-on-surface)]">AI plan insight</h3>
                    <button
                      type="button"
                      title="Generated automatically using this plan’s income, category names, amounts, and notes via your configured AI provider."
                      aria-label="About this AI insight"
                      className="rounded-full text-[var(--ref-on-surface-variant)] hover:text-[var(--ref-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)]"
                    ><Info className="h-3.5 w-3.5" /></button>
                  </div>
                  <div className="pl-6">
                    <p aria-live="polite" className="mt-0.5 text-sm leading-snug text-[var(--ref-on-surface-variant)]">
                      {currentBudgetDraftInsight
                        ?? (isGeneratingBudgetDraftInsight
                          ? 'Looking for useful patterns in this plan…'
                          : currentBudgetDraftInsightError
                            ? 'AI insight is unavailable right now. You can still save your plan.'
                            : 'Preparing an insight for this draft…')}
                    </p>
                    {currentBudgetDraftInsightError && (
                      <button
                        type="button"
                        onClick={() => setBudgetDraftInsightRetry((attempt) => attempt + 1)}
                        className="mt-1 rounded-md text-xs font-semibold text-[var(--ref-primary)] hover:underline"
                      >Try again</button>
                    )}
                  </div>
                </section>
                </div>

                <section className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-5">
                  <div className="mb-4 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ref-primary)]">Allocation audit</p>
                      <h3 className="mt-1 text-lg font-bold text-[var(--ref-on-surface)]">Where your money goes</h3>
                      <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">Largest allocations appear first.</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <div className="text-right">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ref-on-surface-variant)]">{budgetReviewAllocations.length} categories</p>
                        <p className="mt-0.5 text-sm font-bold tabular-nums text-[var(--ref-on-surface)]">{formatCurrency(plannedBudgetAfterDraft)}</p>
                      </div>
                      <label>
                        <span className="sr-only">Compare this plan with another period</span>
                        <select
                          aria-label="Compare this plan with another period"
                          value={reviewComparePeriodId}
                          onChange={(event) => setReviewComparePeriodId(event.target.value)}
                          className="h-8 max-w-[180px] cursor-pointer rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-2 text-xs text-[var(--ref-on-surface)] focus:border-[var(--ref-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ref-primary)]/15"
                        >
                          <option value="">No comparison</option>
                          {periods.filter((period) => period.id.toString() !== selectedPeriodId).map((period) => (
                            <option key={period.id} value={period.id.toString()}>vs {period.name}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                  {plannedBudgetAfterDraft > 0 && (
                    <div
                      role="img"
                      aria-label={`Category allocation mix across ${budgetReviewAllocations.length} categories`}
                      className="mb-4 flex h-4 overflow-hidden rounded-full bg-[var(--ref-surface-container-high)]"
                    >
                      {budgetReviewAllocations.map((allocation) => (
                        <span
                          key={`mix-${allocation.key}`}
                          title={`${allocation.categoryName}: ${formatCurrency(allocation.plannedAmount)}`}
                          className="h-full min-w-0"
                          style={{
                            width: `${Math.max(0, allocation.plannedAmount / plannedBudgetAfterDraft * 100)}%`,
                            backgroundColor: allocation.color,
                          }}
                        />
                      ))}
                    </div>
                  )}
                  {reviewComparePeriodId && (
                    <div className="mb-4 rounded-2xl bg-[var(--ref-surface-container-low)] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-[10px] font-bold uppercase tracking-wider text-[var(--ref-on-surface-variant)]">
                          Category changes vs {reviewComparisonPeriod?.name ?? 'selected period'}
                        </p>
                        {reviewComparisonQuery.isLoading ? (
                          <span className="shrink-0 text-xs text-[var(--ref-on-surface-variant)]">Loading…</span>
                        ) : reviewComparisonRows.length > 0 ? (
                          <span className="shrink-0 text-[10px] text-[var(--ref-on-surface-variant)]">Plan vs prior plan</span>
                        ) : (
                          <span className="shrink-0 text-xs text-[var(--ref-on-surface-variant)]">No saved budget</span>
                        )}
                      </div>
                      {reviewComparisonRows.length > 0 && !reviewComparisonQuery.isLoading ? (
                        <>
                          <div className="mt-2 flex justify-end gap-3 text-[9px] text-[var(--ref-on-surface-variant)]">
                            <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[var(--ref-outline)]" />Prior plan</span>
                            <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[var(--ref-primary)]" />This plan</span>
                          </div>
                          {reviewComparisonCategoryChanges.length > 0 ? (
                            <ul className="mt-1 space-y-2">
                              {reviewComparisonCategoryChanges.map((change) => (
                                <li key={change.categoryName}>
                                  <div className="flex items-baseline justify-between gap-2 text-[10px]">
                                    <strong className="truncate text-[var(--ref-on-surface)]">{change.categoryName}</strong>
                                    <span className="shrink-0 tabular-nums text-[var(--ref-on-surface-variant)]">
                                      {change.difference === 0
                                        ? 'Same as prior budget'
                                        : `${change.difference > 0 ? '+' : '−'}${formatCurrency(Math.abs(change.difference))} vs prior budget`}
                                    </span>
                                  </div>
                                  <div className="mt-1 space-y-1">
                                    {[
                                      { label: 'Prior', amount: change.previousPlanned, color: 'var(--ref-outline)' },
                                      { label: 'Now', amount: change.currentPlanned, color: 'var(--ref-primary)' },
                                    ].map((bar) => (
                                      <div key={bar.label} className="grid grid-cols-[28px_minmax(24px,1fr)_auto] items-center gap-1.5 text-[9px]">
                                        <span className="text-[var(--ref-on-surface-variant)]">{bar.label}</span>
                                        <div className="h-1 overflow-hidden rounded-full bg-[var(--ref-surface-container-high)]">
                                          <div className="h-full rounded-full" style={{ width: `${bar.amount / reviewComparisonBarMax * 100}%`, backgroundColor: bar.color }} />
                                        </div>
                                        <span className="tabular-nums text-[var(--ref-on-surface)]">{formatCurrency(bar.amount)}</span>
                                      </div>
                                    ))}
                                  </div>
                                  <p className="mt-0.5 pl-[34px] text-[9px] text-[var(--ref-on-surface-variant)]">
                                    {change.spentDifference == null
                                      ? 'Actual spending was not tracked last period'
                                      : change.spentDifference === 0
                                        ? `Plan matches last period spend (${formatCurrency(change.previousActual)})`
                                        : `Plan is ${formatCurrency(Math.abs(change.spentDifference))} ${change.spentDifference > 0 ? 'above' : 'below'} last period spend (${formatCurrency(change.previousActual)})`}
                                  </p>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-2 text-[10px] text-[var(--ref-on-surface-variant)]">No changes to shared category allocations.</p>
                          )}
                          {newlyPlannedComparedCategories.length > 0 && (
                            <p className="mt-2 text-[10px] text-[var(--ref-on-surface-variant)]">
                              New: {newlyPlannedComparedCategories.slice(0, 2).map((category) => category.categoryName).join(', ')}
                              {newlyPlannedComparedCategories.length > 2 && ` +${newlyPlannedComparedCategories.length - 2}`}
                            </p>
                          )}
                          {noLongerPlannedComparedCategories[0] && (
                            <p className="mt-1 truncate text-[10px] text-[var(--ref-on-surface-variant)]" title={`Not planned now: ${noLongerPlannedComparedCategories[0].categoryName}; spent ${formatCurrency(noLongerPlannedComparedCategories[0].actualAmount)} last period`}>
                              Not planned now: {noLongerPlannedComparedCategories[0].categoryName} · spent {formatCurrency(noLongerPlannedComparedCategories[0].actualAmount)} last period
                            </p>
                          )}
                        </>
                      ) : !reviewComparisonQuery.isLoading && reviewComparisonPeriod ? (
                        <p className="mt-1 text-[10px] text-[var(--ref-on-surface-variant)]">Choose another period to compare against a saved plan.</p>
                      ) : null}
                    </div>
                  )}
                  <ul className="divide-y divide-[var(--color-border)]">
                    {budgetReviewAllocations.map((allocation) => {
                      const share = plannedBudgetAfterDraft > 0 ? allocation.plannedAmount / plannedBudgetAfterDraft * 100 : 0;
                      return (
                        <li key={allocation.key} className="py-2.5 first:pt-0 last:pb-0">
                          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 text-sm">
                            <span className="flex min-w-0 items-center gap-2 font-medium text-[var(--ref-on-surface)]">
                              <i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: allocation.color }} />
                              <span className="truncate">{allocation.categoryName}</span>
                              {allocation.isNew && <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-[var(--ref-primary)]">New</span>}
                            </span>
                            <span className="shrink-0 text-right font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatCurrency(allocation.plannedAmount)} <span className="inline-block w-12 text-xs font-medium text-[var(--ref-on-surface-variant)]">{share.toFixed(1)}%</span></span>
                          </div>
                          <div className="ml-[18px] mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--ref-surface-container-high)]">
                            <div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: allocation.color }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              </div>
            ) : categories.length === 0 ? (
              <div className="rounded-2xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-5">
                <p className="mb-2 text-sm font-semibold">No categories found.</p>
                <Link to="/categories" className="text-sm font-bold text-[var(--ref-primary)] underline">
                  Create categories first →
                </Link>
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-[minmax(210px,0.82fr)_minmax(0,1.55fr)]">
                <section className="min-w-0 rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-[var(--ref-on-surface)]">Available categories</h3>
                      <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">Drag across, or tap +</p>
                    </div>
                    <span className="rounded-full bg-[var(--ref-surface-container-high)] px-2.5 py-1 text-xs font-semibold text-[var(--ref-on-surface-variant)]">{availableCategories.length}</span>
                  </div>
                  <div className="max-h-[min(58vh,620px)] space-y-2 overflow-y-auto pr-1">
                    {availableCategories.length > 0 ? availableCategories.map((category) => {
                      const recurringAmount = subscriptionDueByCategory.get(category.id) ?? 0;
                      return (
                        <div
                          key={category.id}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData('text/plain', String(category.id));
                            event.dataTransfer.effectAllowed = 'copy';
                          }}
                          className="flex cursor-grab items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3 active:cursor-grabbing"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-[var(--ref-on-surface)]">{category.name}</p>
                            {recurringAmount > 0 && <p className="mt-1 truncate text-xs text-[var(--ref-on-surface-variant)]">Recurring · {formatCurrency(recurringAmount)}</p>}
                          </div>
                          <button
                            type="button"
                            onClick={() => addBudgetDraftLine(category.id)}
                            aria-label={`Add ${category.name}`}
                            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[var(--ref-primary)] hover:bg-[var(--ref-primary)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ref-primary)]/40"
                          ><Plus className="h-4 w-4" /></button>
                        </div>
                      );
                    }) : (
                      <p className="rounded-xl bg-[var(--ref-surface-container-lowest)] p-4 text-sm text-[var(--ref-on-surface-variant)]">Every category is already in this budget.</p>
                    )}
                  </div>
                </section>

                <section
                  aria-label="Budget allocations"
                  onDragOver={(event) => { event.preventDefault(); setIsBudgetDropActive(true); }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsBudgetDropActive(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsBudgetDropActive(false);
                    const categoryId = Number(event.dataTransfer.getData('text/plain'));
                    if (Number.isInteger(categoryId) && categoryId > 0) addBudgetDraftLine(categoryId);
                  }}
                  className={cn(
                    'min-h-64 space-y-3 rounded-2xl border-2 border-dashed p-3 transition-colors sm:p-4',
                    isBudgetDropActive ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)]/5' : 'border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]',
                  )}
                >
                  <div className="rounded-xl bg-[var(--ref-surface-container-low)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ref-on-surface-variant)]">Available to budget</p>
                        <p className={cn('mt-1 text-xl font-bold', availableBudgetBeforeDraft != null && availableBudgetBeforeDraft < 0 ? 'text-[var(--ref-error)]' : 'text-[var(--ref-on-surface)]')}>
                          {availableBudgetBeforeDraft == null
                            ? isPeriodTracked ? 'Add income first' : 'Tracking unavailable'
                            : availableBudgetBeforeDraft < 0
                              ? `Over by ${formatCurrency(Math.abs(availableBudgetBeforeDraft))}`
                              : formatCurrency(availableBudgetBeforeDraft)}
                        </p>
                      </div>
                      {isPeriodTracked && periodIncome > 0 && (
                        <p className="text-right text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">
                          {formatCurrency(periodIncome)} income<br />
                          − {formatCurrency(savingsTargetAmount)} savings ({savingsRate.toFixed(1)}%)
                        </p>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-[var(--ref-on-surface-variant)]">After savings target and current category budgets.</p>
                  </div>

                  {budgetDraftLines.length === 0 ? (
                    <div className="grid min-h-40 place-items-center rounded-xl px-4 py-7 text-center text-sm text-[var(--ref-on-surface-variant)]">
                      <p>{availableCategories.length === 0 ? 'All categories are already budgeted.' : isBudgetDropActive ? 'Drop a category to add it' : 'Drag a category here, or tap + to add one.'}</p>
                    </div>
                  ) : budgetDraftLines.map((line) => {
                    const category = categories.find((item) => String(item.id) === line.categoryId);
                    const categoryName = category?.name ?? 'Category';
                    const subscriptionAmount = subscriptionDueByCategory.get(Number(line.categoryId)) ?? 0;
                    const lineAmount = parseIdNominalToInt(line.plannedAmount) || 0;
                    const allocationShare = plannedBudgetAfterDraft > 0 ? (lineAmount / plannedBudgetAfterDraft) * 100 : 0;
                    return (
                      <div key={line.id} className="grid grid-cols-[minmax(0,1fr)_minmax(112px,0.8fr)_auto] items-center gap-x-2 gap-y-1.5 border-b border-[var(--color-border)] py-2 last:border-b-0 sm:gap-x-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold text-[var(--ref-on-surface)]">{categoryName}</h3>
                          {lineAmount > 0 && <p className="mt-0.5 truncate text-[10px] font-medium text-[var(--ref-primary)]">{allocationShare.toFixed(1)}% of planned total</p>}
                          {subscriptionAmount > 0 && <p className="mt-0.5 truncate text-[10px] text-[var(--ref-on-surface-variant)]">Recurring · {formatCurrency(subscriptionAmount)}</p>}
                        </div>
                        <div className="min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-2.5 py-1 focus-within:border-[var(--ref-primary)]">
                          <CurrencyInput
                            label={`Planned amount for ${categoryName}`}
                            labelClassName="sr-only"
                            value={line.plannedAmount}
                            onChange={(value) => setBudgetDraftLines((current) => current.map((item) => item.id === line.id ? { ...item, plannedAmount: value } : item))}
                            size="sm"
                            className="space-y-0"
                            showDivider={false}
                            required
                          />
                        </div>
                        <div className="relative justify-self-end">
                          <button
                            type="button"
                            onClick={() => setDraftMenuId(draftMenuId === line.id ? null : line.id)}
                            aria-label={`More actions for ${categoryName}`}
                            aria-haspopup="menu"
                            aria-expanded={draftMenuId === line.id}
                            className="grid h-9 w-9 place-items-center rounded-lg text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ref-primary)]/40"
                          ><MoreVertical className="h-4 w-4" /></button>
                          {draftMenuId === line.id && (
                            <>
                              <button
                                type="button"
                                className="fixed inset-0 z-10 cursor-default"
                                aria-label="Close menu"
                                onClick={() => setDraftMenuId(null)}
                              />
                              <div role="menu" className="absolute right-0 top-full z-20 mt-1 min-w-[150px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg">
                                {!line.noteOpen && (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="flex min-h-10 w-full items-center px-3 text-left text-sm hover:bg-[var(--ref-surface-container-low)]"
                                    onClick={() => {
                                      setDraftMenuId(null);
                                      setBudgetDraftLines((current) => current.map((item) => item.id === line.id ? { ...item, noteOpen: true } : item));
                                    }}
                                  >{line.note ? 'Edit note' : 'Add note'}</button>
                                )}
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="flex min-h-10 w-full items-center px-3 text-left text-sm text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
                                  onClick={() => {
                                    setDraftMenuId(null);
                                    setBudgetDraftLines((current) => current.filter((item) => item.id !== line.id));
                                  }}
                                >Remove</button>
                              </div>
                            </>
                          )}
                        </div>
                        {line.noteOpen && (
                          <div className="col-span-3">
                            <div className="mb-1 flex items-center justify-between px-1">
                              <span className="text-[11px] font-semibold text-[var(--ref-on-surface-variant)]">Note</span>
                              <button
                                type="button"
                                aria-expanded="true"
                                onClick={() => setBudgetDraftLines((current) => current.map((item) => item.id === line.id ? { ...item, noteOpen: false } : item))}
                                className="rounded-md px-1.5 py-1 text-[11px] font-semibold text-[var(--ref-primary)] hover:bg-[var(--ref-primary)]/5"
                              >Collapse</button>
                            </div>
                            <label className="block">
                              <span className="sr-only">Reason or note for {categoryName}</span>
                              <textarea
                                value={line.note}
                                onChange={(event) => setBudgetDraftLines((current) => current.map((item) => item.id === line.id ? { ...item, note: event.target.value } : item))}
                                rows={2}
                                maxLength={1000}
                                placeholder="e.g., Comifuro tickets, transport, and merchandise"
                                className="w-full resize-y rounded-lg border border-[var(--color-border)] bg-transparent px-2.5 py-2 text-sm outline-none focus:border-[var(--ref-primary)] focus:ring-2 focus:ring-[var(--ref-primary)]/15"
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </section>
              </div>
            )}
            {formError && <p role="alert" className="text-sm text-[var(--color-danger)]">{formError}</p>}

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

            <button
              type="button"
              aria-expanded={isBudgetNoteOpen}
              onClick={() => setIsBudgetNoteOpen((current) => !current)}
              className="rounded-lg px-2 py-2 text-xs font-semibold text-[var(--ref-primary)] hover:bg-[var(--ref-primary)]/5"
            >{isBudgetNoteOpen ? 'Hide note' : budgetForm.note ? 'Edit reason or note' : '+ Add reason or note'}</button>
            {isBudgetNoteOpen && (
              <label className="block">
                <span className="sr-only">Reason or note (optional)</span>
                <textarea
                  value={budgetForm.note}
                  onChange={(event) => setBudgetForm({ ...budgetForm, note: event.target.value })}
                  rows={3}
                  maxLength={1000}
                  placeholder="Why is this allocation different this period?"
                  className="w-full resize-none rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-4 py-3 text-sm outline-none focus:border-[var(--ref-primary)] focus:ring-2 focus:ring-[var(--ref-primary)]/15"
                />
              </label>
            )}

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

        {/* Save preset modal */}
        <Modal
          isOpen={isTemplateModalOpen}
          onClose={closeTemplateModal}
          title="Save as budget preset"
          subtitle="Reuse these category amounts as a starting point in future periods. Period and category notes are not included."
          size="xl"
        >
          <form onSubmit={handleSaveTemplate} className="space-y-5">
            <Input
              label="Preset name"
              value={templateForm.name}
              onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
              placeholder="e.g., Normal month"
              required
            />
            <Input
              label="Description (optional)"
              value={templateForm.description}
              onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })}
              placeholder="When should you use this preset?"
            />

            <div className="p-3 bg-[var(--ref-surface-container-low)] rounded-lg">
              <p className="text-xs text-[var(--color-text-secondary)]">
                This preset will contain {budgetRows.length} category allocations from {selectedPeriod?.name}. Your period-specific context stays private to this period.
              </p>
            </div>

            {formError && <p className="text-sm text-[var(--color-danger)]">{formError}</p>}

            <div className="flex flex-wrap gap-3 pt-2">
              <Button type="submit" isLoading={isSubmitting} className="min-w-[140px]">
                Save preset
              </Button>
              <Button type="button" variant="secondary" onClick={closeTemplateModal}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>

        {/* Budget presets modal */}
        <Modal
          isOpen={isApplyTemplateModalOpen}
          onClose={() => { setIsApplyTemplateModalOpen(false); setSelectedTemplateId(null); }}
          title="Budget presets"
          subtitle={`Choose a reusable starting point for ${selectedPeriod?.name}. Review the impact before replacing an existing plan.`}
          size="xl"
        >
          <div className="space-y-4">
            {templates.length === 0 ? (
              <div className="rounded-2xl bg-[var(--ref-surface-container-low)] p-6 text-center">
                <Save className="mx-auto h-7 w-7 text-[var(--ref-primary)]" />
                <p className="mt-3 text-sm font-bold text-[var(--ref-on-surface)]">No budget presets yet</p>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Once you have a useful plan, save it as a reusable baseline.</p>
                {budgetRows.length > 0 && <Button size="sm" className="mt-4" onClick={() => { setIsApplyTemplateModalOpen(false); openTemplateModal(); }}>Save current plan</Button>}
              </div>
            ) : (
              <div className="space-y-3">
                {templates.map((template) => (
                  <div
                    key={template.id}
                    className={cn('rounded-2xl border p-4 transition-colors', selectedTemplateId === template.id ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)]/5' : 'border-[var(--color-border)]')}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold">{template.name}</h3>
                        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{template.items.length} categories · {formatCurrency(template.items.reduce((sum, item) => sum + item.plannedAmount, 0))}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button type="button" size="sm" variant="secondary" aria-pressed={selectedTemplateId === template.id} onClick={() => setSelectedTemplateId(selectedTemplateId === template.id ? null : template.id)}>
                          {selectedTemplateId === template.id ? 'Hide preview' : 'Preview'}
                        </Button>
                        <Button type="button" size="sm" variant="danger" onClick={() => deleteTemplate(template.id)}>Delete</Button>
                      </div>
                    </div>
                    {template.description && (
                      <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                        {template.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {selectedTemplate && (
              <section className="rounded-2xl bg-[var(--ref-surface-container-low)] p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold">Preview: {selectedTemplate.name}</h3>
                    <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">
                      Merge adds {selectedTemplateMissingCount} missing categor{selectedTemplateMissingCount === 1 ? 'y' : 'ies'} and keeps {selectedTemplateExistingCount} existing allocation{selectedTemplateExistingCount === 1 ? '' : 's'} unchanged.
                    </p>
                    {budgetRows.length > 0 && <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">Replace removes {budgetRows.length} current categor{budgetRows.length === 1 ? 'y' : 'ies'} and uses these {selectedTemplate.items.length} preset allocations.</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ref-outline)]">Preset total</p>
                    <p className="mt-1 text-lg font-bold text-[var(--ref-on-surface)]">{formatCurrency(selectedTemplate.items.reduce((sum, item) => sum + item.plannedAmount, 0))}</p>
                  </div>
                </div>
                <ul className="mt-4 max-h-52 divide-y divide-[var(--color-border)] overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-4">
                  {selectedTemplate.items.map((item) => {
                    const existing = budgetRows.find((row) => row.categoryId === item.categoryId);
                    return (
                      <li key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                        <span className="min-w-0 truncate font-medium">{item.categoryName}{existing ? <span className="ml-2 text-xs text-[var(--ref-on-surface-variant)]">Current {formatCurrency(existing.plannedAmount)}</span> : <span className="ml-2 text-xs text-[var(--color-success)]">New</span>}</span>
                        <span className="shrink-0 font-semibold tabular-nums">{formatCurrency(item.plannedAmount)}</span>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void handleApplyTemplate(selectedTemplate.id, false)} isLoading={isSubmitting} disabled={selectedTemplateMissingCount === 0}>
                    Add {selectedTemplateMissingCount} missing categor{selectedTemplateMissingCount === 1 ? 'y' : 'ies'}
                  </Button>
                  {budgetRows.length > 0 && (
                    <Button type="button" variant="secondary" isLoading={isSubmitting} onClick={async () => {
                      const confirmed = await confirm({
                        title: 'Replace current plan?',
                        message: `Remove ${budgetRows.length} current allocations and replace them with ${selectedTemplate.items.length} categories from “${selectedTemplate.name}”?`,
                        confirmLabel: 'Replace plan',
                        variant: 'warning',
                      });
                      if (confirmed) await handleApplyTemplate(selectedTemplate.id, true);
                    }}>
                      Replace current plan
                    </Button>
                  )}
                </div>
              </section>
            )}
            <div className="flex flex-wrap justify-between gap-3 pt-2">
              {budgetRows.length > 0 && (
                <Button type="button" onClick={() => { setIsApplyTemplateModalOpen(false); openTemplateModal(); }}>
                  <Save className="h-4 w-4" /> Save current plan as preset
                </Button>
              )}
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
