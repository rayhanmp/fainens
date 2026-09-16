import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  BarChart3,
  Bell,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Flame,
  Info,
  Percent,
  Plus,
  ReceiptText,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { AgentOrbActions } from '../components/ui/AgentOrbActions';
import { PageContainer } from '../components/ui/PageContainer';
import { RequireAuth, useAuth } from '../lib/auth';
import type { api, AgentFinancialFacts, BudgetOutlook, BudgetPlan, BudgetSummary } from '../lib/api';
import { fetchOnboardingStatus } from '../lib/onboarding-status';
import { cn, findCurrentPeriod, formatCurrency, formatDate } from '../lib/utils';
import { NetWorthChart, SpendingTrendChart } from '../components/analytics';
import { TransactionModal } from '../components/transactions/TransactionModal';
import { MonthlyReportModal } from '../components/pdf/MonthlyReportModal';
import { useAccountsLedgerQuery } from '../features/accounts/queries';
import { useCategoriesQuery, useTagsQuery } from '../features/categories/queries';
import { usePeriodsQuery } from '../features/periods/queries';
import {
  useDashboardOverviewQuery,
  useDashboardLoansQuery,
  useDashboardPayLaterQuery,
  useDashboardPeriodQueries,
  useDashboardReconciliationQuery,
  useDashboardSubscriptionsQuery,
} from '../features/dashboard/queries';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../features/core/query-keys';
import { useReviewBudgetOutlookMutation } from '../features/budgets/queries';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useUiStore } from '../stores/ui-store';
import { useNetWorthTrendQuery } from '../features/analytics/queries';
import { useAgentProfileQuery } from '../features/agent/queries';
import { usePendingTransactionsQuery } from '../features/transactions/queries';
import mountainHero from '../assets/dashboard-mountain-hero.png';

export const Route = createFileRoute('/')({
  component: DashboardPage,
  beforeLoad: async () => {
    const status = await fetchOnboardingStatus();
    if (status?.needsOnboarding) throw redirect({ to: '/onboarding' });
  },
});

const DAY_MS = 86_400_000;

type Period = Awaited<ReturnType<typeof api.periods.list>>[number];
type Account = Awaited<ReturnType<typeof api.accounts.list>>[number];
type Category = Awaited<ReturnType<typeof api.categories.list>>[number];
type Tag = Awaited<ReturnType<typeof api.tags.list>>[number];
type DashboardAnalytics = Awaited<ReturnType<typeof api.analytics.dashboard>>;
type RecentTransaction = {
  id: number;
  date: number;
  description: string;
  notes?: string | null;
  linkedTxId?: number | null;
  categoryId?: number | null;
  expenseCents?: number;
  incomeCents?: number;
  debitCents?: number;
  creditCents?: number;
};
type Facts = AgentFinancialFacts['data'];
type ReconciliationHistory = Awaited<ReturnType<typeof api.accounts.reconciliationHistory>>;
type Loan = Awaited<ReturnType<typeof api.loans.list>>[number];
type PayLaterObligations = Awaited<ReturnType<typeof api.paylater.obligations>>;
type SubscriptionData = Awaited<ReturnType<typeof api.subscriptions.list>>;

type Attention = {
  id: string;
  tone: 'danger' | 'warning' | 'info';
  title: string;
  detail: string;
  to: '/accounts' | '/budget' | '/loans' | '/paylater' | '/periods' | '/subscriptions' | '/transactions';
  action: string;
};

const attentionReadStoragePrefix = 'fainens.dashboard.notifications.read';

function attentionReadKey(item: Attention): string {
  return `${item.id}|${item.title}|${item.detail}`;
}

function classifyTx(tx: RecentTransaction): 'expense' | 'income' | 'neutral' {
  const expense = tx.expenseCents ?? 0;
  const income = tx.incomeCents ?? 0;
  if (expense > 0 && income <= 0) return 'expense';
  if (income > 0 && expense <= 0) return 'income';
  return 'neutral';
}

function transactionAmount(tx: RecentTransaction): number {
  const expense = tx.expenseCents ?? 0;
  const income = tx.incomeCents ?? 0;
  if (expense !== 0) return Math.abs(expense);
  if (income !== 0) return Math.abs(income);
  return Math.max(tx.debitCents ?? 0, tx.creditCents ?? 0);
}

function isTransferFee(tx: RecentTransaction): boolean {
  return tx.linkedTxId != null && (
    /^transfer fee:/i.test(tx.description) ||
    /^admin fee for transfer #\d+/i.test(tx.notes ?? '')
  );
}

function coverageLabel(status: Period['coverageStatus'] | undefined): string {
  if (status === 'complete') return 'Complete coverage';
  if (status === 'partial') return 'Partially captured';
  if (status === 'skipped') return 'Skipped period';
  return 'Coverage needs review';
}

function formatAsOf(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function budgetPlansFromPayload(payload: BudgetSummary | BudgetSummary[] | undefined): BudgetPlan[] {
  const summary = Array.isArray(payload) ? payload[0] : payload;
  return Array.isArray(summary?.plans) ? summary.plans : [];
}

function formatForecastRange(low: number | null, high: number | null, midpoint: number | null): string | null {
  if (midpoint == null) return null;
  if (low == null || high == null || low === high) return formatCurrency(midpoint);
  return `${formatCurrency(low)}–${formatCurrency(high)}`;
}

function formatConfidenceLabel(confidence: BudgetOutlook['confidence']): string {
  return confidence.charAt(0).toUpperCase() + confidence.slice(1);
}

function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function fallbackName(email: string | undefined): string {
  const localPart = email?.split('@')[0].replace(/[._-]+/g, ' ').trim();
  if (!localPart || localPart === 'demo') return 'there';
  return localPart.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function MetricHint({ children }: { children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      <button type="button" aria-label="More information" className="grid h-5 w-5 place-items-center rounded-full text-[var(--ref-outline)] transition-colors hover:bg-[var(--ref-surface-container-high)] hover:text-[var(--ref-on-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)]">
        <Info className="h-3.5 w-3.5" />
      </button>
      <span role="tooltip" className="pointer-events-none absolute bottom-[calc(100%+0.5rem)] left-0 z-30 hidden w-56 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3 text-left text-xs leading-relaxed text-[var(--ref-on-surface)] shadow-xl group-hover:block group-focus-within:block">
        {children}
      </span>
    </span>
  );
}

function DashboardPage() {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [dashboardNow] = useState(() => Date.now());
  const { user } = useAuth();
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [isPeriodPickerOpen, setIsPeriodPickerOpen] = useState(false);
  const periodPickerRef = useRef<HTMLDivElement>(null);
  const periodPickerTriggerRef = useRef<HTMLButtonElement>(null);
  const [isTransactionOpen, setIsTransactionOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const reviewedOutlookRevisionRef = useRef<string | null>(null);
  const [readAttentionIds, setReadAttentionIds] = useState<Set<string>>(() => new Set());
  const [readAttentionStateLoaded, setReadAttentionStateLoaded] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const reviewBudgetOutlookMutation = useReviewBudgetOutlookMutation();
  const setDashboardNotificationCount = useUiStore((state) => state.setDashboardNotificationCount);
  const netWorthTrendQuery = useNetWorthTrendQuery('30d');
  const agentProfileQuery = useAgentProfileQuery();

  const periodsQuery = usePeriodsQuery();
  const accountsQuery = useAccountsLedgerQuery();
  const categoriesQuery = useCategoriesQuery();
  const tagsQuery = useTagsQuery();
  const analyticsQuery = useDashboardOverviewQuery();
  const reconciliationQuery = useDashboardReconciliationQuery(1);
  const loansQuery = useDashboardLoansQuery();
  const paylaterQuery = useDashboardPayLaterQuery();
  const subscriptionsQuery = useDashboardSubscriptionsQuery();
  const pendingTransactionsQuery = usePendingTransactionsQuery();
  const periods = (periodsQuery.data ?? []) as Period[];
  const accounts = (accountsQuery.data ?? []) as Account[];
  const categories = (categoriesQuery.data ?? []) as Category[];
  const tags = (tagsQuery.data ?? []) as Tag[];
  const analytics = (analyticsQuery.data ?? null) as DashboardAnalytics | null;
  const reconciliation = (reconciliationQuery.data ?? null) as ReconciliationHistory | null;
  const loans = (loansQuery.data ?? []) as Loan[];
  const paylater = (paylaterQuery.data ?? null) as PayLaterObligations | null;
  const subscriptions = (subscriptionsQuery.data ?? null) as SubscriptionData | null;
  const pendingTransactionCount = pendingTransactionsQuery.data?.length ?? 0;
  const attentionReadStorageKey = `${attentionReadStoragePrefix}:${user?.email ?? 'default'}`;
  const overviewQueries = [periodsQuery, accountsQuery, categoriesQuery, tagsQuery, analyticsQuery, reconciliationQuery, loansQuery, paylaterQuery, subscriptionsQuery];
  const isLoading = overviewQueries.some((query) => query.isLoading);
  const loadError = overviewQueries.find((query) => query.error)?.error?.message ?? null;
  const refreshDashboard = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.periods.all });
  };

  useEffect(() => {
    setSelectedPeriodId((current) => {
      if (current && periods.some((period) => String(period.id) === current)) return current;
      return String(findCurrentPeriod(periods)?.id ?? '');
    });
  }, [periods]);

  const selectedPeriod = useMemo(
    () => periods.find((period) => String(period.id) === selectedPeriodId) ?? null,
    [periods, selectedPeriodId],
  );

  const periodQueries = useDashboardPeriodQueries(selectedPeriod?.id ?? null);
  const facts = (periodQueries.facts.data?.data ?? null) as Facts | null;
  const budgetRows = useMemo(() => budgetPlansFromPayload(periodQueries.budget.data as BudgetSummary | BudgetSummary[] | undefined), [periodQueries.budget.data]);
  const recent = periodQueries.recent.data?.data ?? [];
  const budgetOutlook = periodQueries.outlook.data ?? null;
  const isPeriodLoading = selectedPeriod != null && [periodQueries.facts, periodQueries.budget, periodQueries.recent, periodQueries.outlook].some((query) => query.isLoading);
  const periodLoadError = [periodQueries.facts, periodQueries.budget, periodQueries.recent, periodQueries.outlook].find((query) => query.error)?.error?.message ?? null;
  const combinedLoadError = loadError ?? periodLoadError;

  useEffect(() => {
    const outlook = periodQueries.outlook.data;
    if (!selectedPeriod || !outlook || outlook.patternReview.applied || !outlook.categories.some((row) => row.outlierCount > 0)) return;
    const reviewRevision = outlook.patternReview.evidenceRevision;
    const reviewKey = `${selectedPeriod.id}:${reviewRevision}`;
    if (reviewedOutlookRevisionRef.current === reviewKey) return;
    reviewedOutlookRevisionRef.current = reviewKey;
    void reviewBudgetOutlookMutation.mutateAsync(selectedPeriod.id).catch(() => undefined);
  }, [periodQueries.outlook.data, reviewBudgetOutlookMutation.mutateAsync, selectedPeriod]);

  useEffect(() => {
    const task = (periodQueries.review.data as { task?: { status?: string } } | undefined)?.task;
    if (task?.status !== 'completed' || !selectedPeriod) return;
    void queryClient.invalidateQueries({ queryKey: [...queryKeys.dashboard.period(selectedPeriod.id), 'outlook'] });
  }, [periodQueries.review.data, queryClient, selectedPeriod]);

  const budgetSummary = useMemo(() => {
    const totalPlanned = budgetRows.reduce((sum, row) => sum + row.plannedAmount, 0);
    const totalActual = budgetRows.reduce((sum, row) => sum + row.actualAmount, 0);
    const isTracked = selectedPeriod?.coverageStatus === 'complete' || selectedPeriod?.coverageStatus === 'partial';
    const remaining = totalPlanned - totalActual;
    return {
      totalPlanned,
      remaining: isTracked ? remaining : null,
      isTracked,
    };
  }, [budgetRows, selectedPeriod]);

  const commitmentCutoff = dashboardNow + 30 * DAY_MS;
  const upcomingSubscriptions = [...(subscriptions?.subscriptions ?? [])]
    .filter((item) => item.status === 'active' && item.nextRenewalAt <= commitmentCutoff)
    .sort((a, b) => a.nextRenewalAt - b.nextRenewalAt);
  const upcomingPayLater = paylater?.obligations.filter((item) => item.outstandingCents > 0 && item.dueDateMs != null && item.dueDateMs <= commitmentCutoff) ?? [];
  const upcomingLoans = loans.filter((loan) => loan.direction === 'borrowed' && loan.status === 'active' && loan.remainingCents > 0 && loan.dueDate != null && loan.dueDate <= commitmentCutoff);
  const subscriptionCommitmentTotal = upcomingSubscriptions.reduce((sum, item) => sum + item.amount, 0);
  const payLaterCommitmentTotal = upcomingPayLater.reduce((sum, item) => sum + item.outstandingCents, 0);
  const loanCommitmentTotal = upcomingLoans.reduce((sum, item) => sum + item.remainingCents, 0);
  const upcomingCommitmentTotal = subscriptionCommitmentTotal + payLaterCommitmentTotal + loanCommitmentTotal;
  const upcomingCommitmentCount = upcomingSubscriptions.length + upcomingPayLater.length + upcomingLoans.length;

  const attentionItems = useMemo<Attention[]>(() => {
    const next: Attention[] = [];
    if (pendingTransactionCount > 0) {
      next.push({
        id: 'pending-transactions',
        tone: 'warning',
        title: `${pendingTransactionCount} pending transaction${pendingTransactionCount === 1 ? '' : 's'}`,
        detail: 'Review imported or AI-parsed activity before it is posted to the ledger.',
        to: '/transactions',
        action: 'Review pending transactions',
      });
    }
    if (!analytics?.trialBalance.isBalanced) {
      next.push({ id: 'trial-balance', tone: 'danger', title: 'Ledger needs review', detail: 'The trial balance is not currently balanced.', to: '/accounts', action: 'Review accounts' });
    }
    if (selectedPeriod && selectedPeriod.coverageStatus !== 'complete') {
      const detail = selectedPeriod.coverageReason
        ?? (selectedPeriod.coverageStatus === 'skipped'
          ? 'Recorded activity is not zero activity for this period.'
          : 'Review coverage before relying on trends or averages.');
      next.push({ id: 'coverage', tone: selectedPeriod.coverageStatus === 'partial' ? 'warning' : 'danger', title: coverageLabel(selectedPeriod.coverageStatus), detail, to: '/periods', action: 'Review period' });
    }
    const latestReconciliation = reconciliation?.sessions.find((session) => session.lifecycleStatus === 'active');
    const reconciliationAgeDays = latestReconciliation ? Math.floor((dashboardNow - latestReconciliation.asOfDate) / DAY_MS) : null;
    if (!latestReconciliation || (reconciliationAgeDays != null && reconciliationAgeDays > 30)) {
      next.push({
        id: 'reconciliation', tone: 'warning', title: latestReconciliation ? 'Accounts need a fresh check' : 'No account reconciliation yet',
        detail: latestReconciliation ? `Last checked ${reconciliationAgeDays} days ago.` : 'Confirm your current balances so the position stays trustworthy.',
        to: '/accounts', action: 'Reconcile accounts',
      });
    }
    const overdueLoans = loans.filter((loan) => loan.isOverdue);
    const dueSoonLoans = upcomingLoans.filter((loan) => loan.dueDate != null && loan.dueDate > dashboardNow && loan.dueDate <= dashboardNow + 7 * DAY_MS);
    if (overdueLoans.length > 0) {
      next.push({ id: 'loans', tone: 'danger', title: `${overdueLoans.length} loan${overdueLoans.length === 1 ? '' : 's'} overdue`, detail: 'Review repayment status and follow up with the counterparty.', to: '/loans', action: 'Open loans' });
    } else if (dueSoonLoans.length > 0) {
      const dueSoonTotal = dueSoonLoans.reduce((sum, loan) => sum + loan.remainingCents, 0);
      next.push({ id: 'loans-soon', tone: 'warning', title: `${dueSoonLoans.length} loan${dueSoonLoans.length === 1 ? '' : 's'} due in 7 days`, detail: `${formatCurrency(dueSoonTotal)} due next, starting ${formatDate(dueSoonLoans[0].dueDate!)}`, to: '/loans', action: 'Open loans' });
    } else if (upcomingLoans.length > 0) {
      next.push({ id: 'loans-upcoming', tone: 'info', title: `${upcomingLoans.length} loan${upcomingLoans.length === 1 ? '' : 's'} due in 30 days`, detail: `${formatCurrency(loanCommitmentTotal)} outstanding, next due ${formatDate(upcomingLoans[0].dueDate!)}.`, to: '/loans', action: 'Open loans' });
    }
    const overduePaylater = paylater?.obligations.filter((item) => item.status === 'overdue') ?? [];
    const soonPaylater = paylater?.obligations.filter((item) => item.status === 'due_soon') ?? [];
    if (overduePaylater.length > 0 || soonPaylater.length > 0) {
      next.push({ id: 'paylater', tone: overduePaylater.length ? 'danger' : 'warning', title: overduePaylater.length ? `${overduePaylater.length} PayLater payment${overduePaylater.length === 1 ? '' : 's'} overdue` : `${soonPaylater.length} PayLater payment${soonPaylater.length === 1 ? '' : 's'} due soon`, detail: `${formatCurrency((overduePaylater.length ? overduePaylater : soonPaylater).reduce((sum, item) => sum + item.outstandingCents, 0))} outstanding across these payments.`, to: '/paylater', action: 'Open PayLater' });
    } else if (upcomingPayLater.length > 0) {
      next.push({ id: 'paylater-upcoming', tone: 'info', title: `${upcomingPayLater.length} PayLater payment${upcomingPayLater.length === 1 ? '' : 's'} due in 30 days`, detail: `${formatCurrency(payLaterCommitmentTotal)} outstanding, review the next due dates.`, to: '/paylater', action: 'Open PayLater' });
    }
    const overdueSubscriptions = subscriptions?.renewalPreview.occurrences.filter((occurrence) => occurrence.dueAt <= dashboardNow) ?? [];
    const dueSoonSubscriptions = upcomingSubscriptions.filter((subscription) => subscription.nextRenewalAt > dashboardNow && subscription.nextRenewalAt <= dashboardNow + 7 * DAY_MS);
    if (overdueSubscriptions.length > 0) {
      const overdueTotal = overdueSubscriptions.reduce((sum, occurrence) => sum + occurrence.amount, 0);
      next.push({ id: 'subscriptions-overdue', tone: 'danger', title: `${overdueSubscriptions.length} subscription renewal${overdueSubscriptions.length === 1 ? '' : 's'} overdue`, detail: `${formatCurrency(overdueTotal)} is waiting for review before it is posted.`, to: '/subscriptions', action: 'Review subscriptions' });
    } else if (dueSoonSubscriptions.length > 0) {
      const dueSoonTotal = dueSoonSubscriptions.reduce((sum, subscription) => sum + subscription.amount, 0);
      next.push({ id: 'subscriptions-soon', tone: 'warning', title: `${dueSoonSubscriptions.length} subscription${dueSoonSubscriptions.length === 1 ? '' : 's'} due in 7 days`, detail: `${formatCurrency(dueSoonTotal)} due next, starting ${formatDate(dueSoonSubscriptions[0].nextRenewalAt)}.`, to: '/subscriptions', action: 'Review subscriptions' });
    } else if (upcomingSubscriptions.length > 0) {
      next.push({ id: 'subscriptions-upcoming', tone: 'info', title: `${upcomingSubscriptions.length} subscription${upcomingSubscriptions.length === 1 ? '' : 's'} due in 30 days`, detail: `${formatCurrency(subscriptionCommitmentTotal)} total, next due ${formatDate(upcomingSubscriptions[0].nextRenewalAt)}.`, to: '/subscriptions', action: 'Review subscriptions' });
    }
    const overBudgetRows = budgetSummary.isTracked ? budgetRows.filter((row) => row.percentUsed >= 100) : [];
    const projectedBudgetRows = budgetSummary.isTracked && overBudgetRows.length === 0
      ? (budgetOutlook?.categories.filter((row) => row.riskStatus === 'at_risk') ?? [])
      : [];
    if (overBudgetRows.length > 0) {
      const overrunTotal = overBudgetRows.reduce((sum, row) => sum + Math.max(0, row.actualAmount - row.plannedAmount), 0);
      const topCategories = overBudgetRows.slice(0, 2).map((row) => row.categoryName).join(' and ');
      next.push({ id: 'budget-overrun', tone: 'danger', title: `${overBudgetRows.length} categor${overBudgetRows.length === 1 ? 'y is' : 'ies are'} over budget`, detail: `${formatCurrency(overrunTotal)} over plan, led by ${topCategories}.`, to: '/budget', action: 'Review budget' });
    } else if (projectedBudgetRows.length > 0) {
      const topCategories = projectedBudgetRows.slice(0, 2).map((row) => row.categoryName).join(' and ');
      next.push({ id: 'budget-risk', tone: 'warning', title: `${projectedBudgetRows.length} categor${projectedBudgetRows.length === 1 ? 'y is' : 'ies are'} at risk`, detail: `${topCategories} may exceed the plan based on the current outlook.`, to: '/budget', action: 'Review budget' });
    }
    const unallocated = facts?.facts.byCategory.find((row) => row.categoryId == null && row.spentCents > 0);
    if (unallocated) {
      next.push({ id: 'unallocated', tone: 'info', title: 'Some spending is unallocated', detail: `${formatCurrency(unallocated.spentCents)} cannot yet be attributed to a category.`, to: '/transactions', action: 'Classify activity' });
    }
    const priority = { danger: 0, warning: 1, info: 2 } as const;
    return next.sort((a, b) => priority[a.tone] - priority[b.tone]).slice(0, 8);
  }, [analytics, budgetOutlook, budgetRows, budgetSummary.isTracked, dashboardNow, facts, loans, paylater, pendingTransactionCount, reconciliation, selectedPeriod, subscriptionCommitmentTotal, subscriptions, upcomingSubscriptions]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(attentionReadStorageKey) ?? '[]');
      setReadAttentionIds(new Set(Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : []));
    } catch {
      setReadAttentionIds(new Set());
    } finally {
      setReadAttentionStateLoaded(true);
    }
  }, [attentionReadStorageKey]);

  useEffect(() => {
    if (!readAttentionStateLoaded) return;
    try {
      localStorage.setItem(attentionReadStorageKey, JSON.stringify([...readAttentionIds]));
    } catch {
      // Browser storage can be unavailable in private or restricted contexts.
    }
  }, [attentionReadStorageKey, readAttentionIds, readAttentionStateLoaded]);

  const unreadAttentionItems = useMemo(
    () => attentionItems.filter((item) => !readAttentionIds.has(attentionReadKey(item))),
    [attentionItems, readAttentionIds],
  );

  const markAttentionRead = (item: Attention) => {
    setReadAttentionIds((current) => new Set(current).add(attentionReadKey(item)));
  };

  const markAllAttentionRead = () => {
    setReadAttentionIds((current) => {
      const next = new Set(current);
      attentionItems.forEach((item) => next.add(attentionReadKey(item)));
      return next;
    });
  };

  const planRows = useMemo(() => {
    if (budgetOutlook && budgetOutlook.periodId === selectedPeriod?.id && budgetOutlook.categories.length > 0) {
      const riskRank = { over_budget: 0, at_risk: 1, unknown: 2, within_budget: 3 } as const;
      return [...budgetOutlook.categories]
        .sort((a, b) => riskRank[a.riskStatus] - riskRank[b.riskStatus] || b.actualAmount / Math.max(1, b.plannedAmount) - a.actualAmount / Math.max(1, a.plannedAmount))
        .slice(0, 5)
        .map((row) => ({ name: row.categoryName, actual: row.actualAmount, planned: row.plannedAmount, outlook: row }));
    }
    if (budgetRows.length > 0) {
      return [...budgetRows]
        .sort((a, b) => Math.max(b.percentUsed, b.actualAmount / Math.max(1, b.plannedAmount) * 100) - Math.max(a.percentUsed, a.actualAmount / Math.max(1, a.plannedAmount) * 100))
        .slice(0, 5)
        .map((row) => ({ name: row.categoryName, actual: row.actualAmount, planned: row.plannedAmount, outlook: null }));
    }
    return (facts?.facts.byCategory ?? []).filter((row) => row.spentCents > 0).slice(0, 5)
      .map((row) => ({ name: row.category, actual: row.spentCents, planned: 0, outlook: null }));
  }, [budgetOutlook, budgetRows, facts, selectedPeriod]);

  const periodIncome = facts?.facts.totalIncomeCents ?? 0;
  const periodExpense = facts?.facts.totalSpentCents ?? 0;
  const periodIsTracked = selectedPeriod?.coverageStatus === 'complete' || selectedPeriod?.coverageStatus === 'partial';
  const periodNet = periodIsTracked ? periodIncome - periodExpense : null;
  const selectedPeriodAsOf = facts?.facts.asOfMs ?? dashboardNow;
  const visibleRecent = recent.filter((transaction) => !isTransferFee(transaction));
  const budgetRemaining = budgetOutlook?.total.remainingAmount ?? budgetSummary.remaining ?? 0;
  const dailyBudget = budgetOutlook && budgetOutlook.daysRemaining > 0 ? Math.max(0, Math.round(budgetRemaining / budgetOutlook.daysRemaining)) : null;
  const savingsRate = periodIsTracked && periodIncome > 0 ? (periodNet! / periodIncome) * 100 : null;
  const preferredName = agentProfileQuery.data?.nickname?.trim() || fallbackName(user?.email);
  const netWorthSeries = netWorthTrendQuery.data?.series ?? [];
  const netWorthAtStart = netWorthSeries[0]?.netWorth;
  const netWorthNow = netWorthSeries.at(-1)?.netWorth;
  const netWorthChangePercent = netWorthAtStart != null && netWorthNow != null && netWorthAtStart !== 0
    ? ((netWorthNow - netWorthAtStart) / Math.abs(netWorthAtStart)) * 100
    : null;
  const budgetOverrun = periodIsTracked && budgetRemaining < 0;
  const heroHeadline = budgetOverrun
    ? 'Your budget needs attention.'
    : netWorthChangePercent == null
      ? upcomingCommitmentTotal > 0 ? 'Your next moves are visible.' : 'Your position is taking shape.'
      : netWorthChangePercent >= 10
        ? 'Strong momentum is building.'
        : netWorthChangePercent > 0
          ? 'Progress is moving in the right direction.'
          : netWorthChangePercent < -5
            ? 'Let\u2019s protect your runway.'
            : netWorthChangePercent < 0
              ? 'A small reset can help.'
              : upcomingCommitmentTotal > 0
                ? 'Your next commitments are in view.'
                : 'You\u2019re holding steady.';
  const heroMessage = budgetOverrun
    ? `${formatCurrency(Math.abs(budgetRemaining))} over the ${selectedPeriod?.name ?? 'current'} budget. Review the categories driving the overrun.`
    : netWorthChangePercent == null
      ? upcomingCommitmentTotal > 0
        ? `${formatCurrency(upcomingCommitmentTotal)} in commitments are due within the next 30 days. Keep them in your plan.`
        : 'Keep building your financial history. A clearer trend is just ahead.'
      : netWorthChangePercent > 0
        ? `Your net worth increased by ${Math.abs(netWorthChangePercent).toFixed(1)}% in the last 30 days.${upcomingCommitmentTotal > 0 ? ` Upcoming commitments total ${formatCurrency(upcomingCommitmentTotal)}.` : ' Keep building momentum.'}`
        : netWorthChangePercent < 0
          ? `Your net worth decreased by ${Math.abs(netWorthChangePercent).toFixed(1)}% in the last 30 days. Review the trend and plan your next move.`
          : upcomingCommitmentTotal > 0
            ? `Your net worth held steady over the last 30 days. Upcoming commitments total ${formatCurrency(upcomingCommitmentTotal)}.`
            : 'Your net worth held steady over the last 30 days. Consistency is a strong foundation.';
  const selectedPeriodIndex = periods.findIndex((period) => String(period.id) === selectedPeriodId);
  const olderPeriod = selectedPeriodIndex >= 0 ? periods[selectedPeriodIndex + 1] : undefined;
  const newerPeriod = selectedPeriodIndex > 0 ? periods[selectedPeriodIndex - 1] : undefined;
  const openAgent = (prompt = '') => {
    const text = prompt.trim();
    void navigate({ to: '/agent', search: text ? { prompt: text } : {} } as any);
  };

  useEffect(() => {
    setDashboardNotificationCount(unreadAttentionItems.length);
  }, [setDashboardNotificationCount, unreadAttentionItems.length]);

  useEffect(() => {
    if (!isPeriodPickerOpen) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (periodPickerRef.current && !periodPickerRef.current.contains(event.target as Node)) setIsPeriodPickerOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [isPeriodPickerOpen]);

  if (isLoading) {
    return <RequireAuth><PageContainer><div className="h-8 w-56 animate-pulse rounded bg-[var(--ref-surface-container-highest)]" /><div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((key) => <div key={key} className="h-44 animate-pulse rounded-3xl bg-[var(--ref-surface-container-highest)]" />)}</div></PageContainer></RequireAuth>;
  }

  return (
    <RequireAuth>
      <PageContainer className="space-y-4 sm:space-y-4">
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--ref-secondary)]">Decision centre</p>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Position as of {formatAsOf(dashboardNow)}</p>
          </div>
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            {periods.length > 0 && <div className="flex w-fit max-w-full shrink-0 items-center rounded-full border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-1 shadow-sm">
              <button type="button" disabled={!olderPeriod} onClick={() => olderPeriod && setSelectedPeriodId(String(olderPeriod.id))} className="grid h-9 w-9 place-items-center rounded-full text-[var(--ref-on-surface-variant)] transition-colors hover:bg-[var(--ref-surface-container-low)] disabled:cursor-not-allowed disabled:opacity-30" aria-label="Previous period" title={olderPeriod ? `Previous: ${olderPeriod.name}` : 'No previous period'}><ChevronLeft className="h-4 w-4" /></button>
              <div ref={periodPickerRef} className="relative w-[min(145px,calc(100vw-7rem))] shrink-0">
                <button ref={periodPickerTriggerRef} type="button" onClick={() => setIsPeriodPickerOpen((open) => !open)} onKeyDown={(event) => { if (event.key === 'Escape') { setIsPeriodPickerOpen(false); periodPickerTriggerRef.current?.focus(); } }} className={cn('relative flex h-9 w-full items-center justify-center rounded-lg px-4 text-center text-xs font-bold text-[var(--ref-on-surface)] transition-colors hover:bg-[var(--ref-surface-container-low)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)]', isPeriodPickerOpen && 'bg-[var(--ref-surface-container-low)] text-[var(--ref-primary)]')} aria-haspopup="listbox" aria-expanded={isPeriodPickerOpen} aria-label="Dashboard period">
                  <span className="-translate-x-1 truncate text-center">{selectedPeriod?.name ?? 'Select period'}</span><ChevronDown className={cn('absolute right-2 h-4 w-4 transition-transform', isPeriodPickerOpen && 'rotate-180')} />
                </button>
                {isPeriodPickerOpen && <div role="listbox" aria-label="Dashboard periods" className="period-picker-scroll absolute left-0 top-[calc(100%+0.55rem)] z-50 max-h-60 w-full overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-1.5 shadow-2xl">
                  {periods.map((period) => <button key={period.id} type="button" role="option" aria-selected={String(period.id) === selectedPeriodId} onClick={() => { setSelectedPeriodId(String(period.id)); setIsPeriodPickerOpen(false); periodPickerTriggerRef.current?.focus(); }} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setIsPeriodPickerOpen(false); periodPickerTriggerRef.current?.focus(); } }} className={cn('w-full rounded-xl px-3 py-2 text-left text-xs font-semibold transition-colors', String(period.id) === selectedPeriodId ? 'bg-[var(--ref-primary)] text-white shadow-sm' : 'text-[var(--ref-on-surface)] hover:bg-[var(--ref-surface-container-low)]')}>{period.name}</button>)}
                </div>}
              </div>
              <button type="button" disabled={!newerPeriod} onClick={() => newerPeriod && setSelectedPeriodId(String(newerPeriod.id))} className="grid h-9 w-9 place-items-center rounded-full text-[var(--ref-on-surface-variant)] transition-colors hover:bg-[var(--ref-surface-container-low)] disabled:cursor-not-allowed disabled:opacity-30" aria-label="Next period" title={newerPeriod ? `Next: ${newerPeriod.name}` : 'No next period'}><ChevronRight className="h-4 w-4" /></button>
            </div>}
            <details className="group relative">
              <summary className="relative grid h-11 w-11 cursor-pointer list-none place-items-center rounded-full border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] text-[var(--ref-on-surface-variant)] shadow-sm transition-colors hover:bg-[var(--ref-surface-container-low)] [&::-webkit-details-marker]:hidden" aria-label="Dashboard notifications">
                <Bell className="h-5 w-5" />
                {unreadAttentionItems.length > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-[var(--color-background)]">{Math.min(unreadAttentionItems.length, 9)}</span>}
              </summary>
              <div className="absolute right-0 top-[calc(100%+0.65rem)] z-40 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3 shadow-2xl">
                <div className="flex items-center justify-between gap-3 px-2 py-1"><h2 className="font-headline text-base font-extrabold">Notifications</h2><div className="flex items-center gap-2"><span className="text-xs text-[var(--ref-on-surface-variant)]">{unreadAttentionItems.length || 'All clear'}</span>{unreadAttentionItems.length > 0 && <button type="button" onClick={markAllAttentionRead} className="text-[11px] font-bold text-[var(--ref-primary)] hover:underline">Mark all read</button>}</div></div>
                {attentionItems.length === 0 ? <p className="px-2 py-5 text-sm text-[var(--ref-on-surface-variant)]">Nothing needs your attention right now.</p> : <div className="mt-2 divide-y divide-[var(--color-border)]">{attentionItems.map((item) => { const isRead = readAttentionIds.has(attentionReadKey(item)); return <div key={item.id} className={cn('flex items-start gap-2', isRead && 'opacity-60')}><Link to={item.to} className="flex min-w-0 flex-1 gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-[var(--ref-surface-container-low)]"><span className={cn('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', isRead ? 'bg-slate-400' : item.tone === 'danger' ? 'bg-rose-500' : item.tone === 'warning' ? 'bg-amber-500' : 'bg-sky-500')} /><span className="min-w-0"><strong className="block text-sm">{item.title}</strong><span className="mt-0.5 block text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">{item.detail}</span><span className="mt-1.5 block text-xs font-bold text-[var(--ref-primary)]">{item.action}</span></span></Link><button type="button" onClick={() => markAttentionRead(item)} className="mt-3 shrink-0 px-1 text-[10px] font-bold text-[var(--ref-on-surface-variant)] hover:text-[var(--ref-primary)] hover:underline">{isRead ? 'Read' : 'Mark read'}</button></div>; })}</div>}
              </div>
            </details>
          </div>
        </div>

        <section className="relative rounded-3xl bg-[#102b4d] text-white" aria-labelledby="dashboard-hero-title">
            <img src={mountainHero} alt="" className="absolute inset-0 h-full w-full rounded-3xl object-cover object-center" />
            <div className="absolute inset-0 rounded-3xl bg-[linear-gradient(90deg,rgba(7,29,55,0.98)_0%,rgba(9,35,66,0.88)_48%,rgba(12,41,72,0.35)_100%)]" />
            <div className="absolute inset-0 rounded-3xl bg-[linear-gradient(0deg,rgba(5,24,44,0.5),transparent_55%)]" />
            <div className="relative grid gap-5 p-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,1fr)] lg:items-center">
              <div className="min-w-0">
                <div>
                <p className="text-sm font-semibold text-white/88">{timeOfDayGreeting()}, {preferredName}</p>
                  <h1 id="dashboard-hero-title" className="mt-1 text-2xl leading-tight tracking-tight text-white sm:text-3xl">{heroHeadline}</h1>
                  <p className="mt-2 text-sm leading-relaxed text-white/88">{heroMessage}</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => setIsTransactionOpen(true)} className="inline-flex min-h-11 items-center justify-center gap-2.5 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-[#10243e] shadow-sm transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[#132747] text-white"><Plus className="h-3.5 w-3.5" strokeWidth={3} /></span>
                  Add transaction
                </button>
                <button type="button" onClick={() => setIsReportOpen(true)} className="inline-flex min-h-11 items-center justify-center gap-2.5 rounded-full border border-white/55 bg-white/5 px-5 py-2.5 text-sm font-bold text-white backdrop-blur-sm transition hover:bg-white/12 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                  <BarChart3 className="h-5 w-5" />
                  View report
                </button>
                </div>
              </div>
              <aside className="hidden rounded-2xl border border-white/20 bg-[#091d35]/55 p-4 backdrop-blur-sm lg:block" aria-label="Financial summary">
                <div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-widest text-white/65">At a glance</p><Wallet className="h-4 w-4 text-white/75" /></div>
                <Link to="/accounts" className="mt-3 block"><span className="text-xs text-white/70">Available cash</span><strong className="mt-0.5 block truncate text-xl">{analytics ? formatCurrency(analytics.netWorth.liquidAssets) : '—'}</strong></Link>
                <div className="mt-3 grid grid-cols-3 gap-3 border-t border-white/15 pt-3 text-xs">
                  <Link to="/accounts"><span className="block text-white/60">Net worth</span><strong className="mt-1 block truncate">{analytics ? formatCurrency(analytics.netWorth.netWorth) : '—'}</strong></Link>
                  <Link to="/budget"><span className="block text-white/60">Budget left</span><strong className="mt-1 block truncate">{periodIsTracked ? formatCurrency(budgetRemaining) : 'Review'}</strong></Link>
                  <div className="group relative min-w-0">
                    <button type="button" className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" aria-describedby="upcoming-commitments-tip">
                      <span className="block truncate text-white/60">Due · 30d</span>
                      <strong className="mt-1 block truncate">{upcomingCommitmentCount > 0 ? formatCurrency(upcomingCommitmentTotal) : 'None'}</strong>
                    </button>
                    <div id="upcoming-commitments-tip" role="tooltip" className="pointer-events-none absolute bottom-[calc(100%+0.75rem)] right-0 z-30 hidden max-h-60 w-64 overflow-y-auto rounded-xl border border-white/20 bg-[#07182d] p-3 text-left shadow-xl group-hover:block group-focus-within:block">
                      <p className="font-bold text-white">Upcoming commitments</p>
                      {upcomingCommitmentCount === 0 ? <p className="mt-1 text-[11px] leading-relaxed text-white/70">No subscriptions, PayLater, or borrowed loans due in the next 30 days.</p> : <div className="mt-2 space-y-1.5 text-[11px] text-white/70">
                        {upcomingSubscriptions.length > 0 && <p className="flex justify-between gap-3"><span>Subscriptions · {upcomingSubscriptions.length}</span><strong className="text-white">{formatCurrency(subscriptionCommitmentTotal)}</strong></p>}
                        {upcomingSubscriptions.length > 0 && <div className="mt-2 space-y-1 border-t border-white/15 pt-2">
                          {upcomingSubscriptions.map((subscription) => <p key={subscription.id} className="flex items-center justify-between gap-3"><span className="flex min-w-0 items-center gap-1"><span className="min-w-0 truncate text-white/75">{subscription.name}</span><span className="shrink-0 whitespace-nowrap text-white/45">· {formatDate(subscription.nextRenewalAt)}</span></span><strong className="shrink-0 text-white">{formatCurrency(subscription.amount)}</strong></p>)}
                        </div>}
                        {upcomingPayLater.length > 0 && <p className="flex justify-between gap-3"><span>PayLater · {upcomingPayLater.length}</span><strong className="text-white">{formatCurrency(payLaterCommitmentTotal)}</strong></p>}
                        {upcomingLoans.length > 0 && <p className="flex justify-between gap-3"><span>Borrowed loans · {upcomingLoans.length}</span><strong className="text-white">{formatCurrency(loanCommitmentTotal)}</strong></p>}
                      </div>}
                    </div>
                  </div>
                </div>
              </aside>
            </div>
        </section>

        {combinedLoadError && <div className="mt-5 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{combinedLoadError}</div>}

        <section className="mt-5 space-y-4 md:hidden" aria-label="Today">
          <div className="cash-satin rounded-[1.75rem] bg-[var(--ref-primary-container)] p-5 text-[var(--ref-on-primary-container)]">
            <p className="text-[11px] font-bold uppercase tracking-widest opacity-75">Available today</p>
            <p className="mt-2 font-headline text-3xl font-extrabold tracking-tight">{analytics ? formatCurrency(analytics.netWorth.liquidAssets) : '—'}</p>
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-black/10 pt-4 text-sm">
              <Link to="/budget" className="rounded-2xl bg-white/15 p-3"><span className="block text-[10px] font-bold uppercase tracking-wide opacity-70">Budget left</span><strong className="mt-1 block truncate">{periodIsTracked ? formatCurrency(budgetRemaining) : 'Review period'}</strong></Link>
              <Link to="/accounts" className="rounded-2xl bg-white/15 p-3"><span className="block text-[10px] font-bold uppercase tracking-wide opacity-70">Net worth</span><strong className="mt-1 block truncate">{analytics ? formatCurrency(analytics.netWorth.netWorth) : '—'}</strong></Link>
            </div>
          </div>
          {dailyBudget != null && <Link to="/budget" className="flex items-center justify-between rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-4 py-3"><span><span className="block text-xs text-[var(--ref-on-surface-variant)]">Safe daily pace</span><strong className="text-sm">{formatCurrency(dailyBudget)} per day</strong></span><ArrowRight className="h-4 w-4 text-[var(--ref-primary)]" /></Link>}
          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-4">
            <div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">Recent activity</p><h2 className="font-headline text-lg font-extrabold">Latest recorded</h2></div><Link to="/transactions" className="rounded-full px-3 py-2 text-xs font-bold text-[var(--ref-primary)]">See all</Link></div>
            <div className="mt-2 divide-y divide-[var(--color-border)]">{visibleRecent.length === 0 ? <p className="py-6 text-sm text-[var(--ref-on-surface-variant)]">No activity in this period.</p> : visibleRecent.slice(0, 4).map((tx) => { const kind = classifyTx(tx); const category = tx.categoryId == null ? null : categories.find((item) => item.id === tx.categoryId); return <Link key={tx.id} to="/transactions" search={{ transactionId: String(tx.id) }} className="flex items-center justify-between gap-3 py-3"><span className="min-w-0"><strong className="block truncate text-sm">{tx.description}</strong><span className="mt-0.5 block truncate text-xs text-[var(--ref-on-surface-variant)]">{category?.name ?? (kind === 'income' ? 'Income' : 'Unallocated')} · {formatDate(tx.date)}</span></span><strong className={cn('shrink-0 text-sm tabular-nums', kind === 'expense' ? 'text-[var(--color-danger)]' : kind === 'income' ? 'text-[var(--color-success)]' : '')}>{kind === 'expense' ? '-' : kind === 'income' ? '+' : ''}{formatCurrency(transactionAmount(tx))}</strong></Link>; })}</div>
          </div>
        </section>

        {!isMobile && <div>
        <section aria-label="Financial pulse" className="grid grid-cols-1 rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-5 py-4 shadow-sm md:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0 pb-4 md:pb-0 md:pr-5">
            <p className="flex items-center gap-2 text-xs text-[var(--ref-on-surface-variant)]"><CircleDollarSign className="h-4 w-4" />Period cash flow <MetricHint>{periodIsTracked ? `${formatCurrency(periodIncome)} income minus ${formatCurrency(periodExpense)} spending.` : 'Complete period coverage to calculate cash flow.'}</MetricHint></p>
            <p className={cn('mt-1 break-words text-xl font-bold tabular-nums', periodNet == null ? '' : periodNet >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]')}>{periodNet == null ? 'Not tracked' : `${periodNet >= 0 ? '+' : ''}${formatCurrency(periodNet)}`}</p>
          </div>
          <div className="min-w-0 border-t border-[var(--color-border)] py-4 md:border-l md:border-t-0 md:px-5 md:py-0">
            <p className="flex items-center gap-2 text-xs text-[var(--ref-on-surface-variant)]"><Percent className="h-4 w-4" />Savings rate <MetricHint>{savingsRate == null ? 'Needs tracked income for this period.' : 'Share of period income retained after recorded spending.'}</MetricHint></p>
            <p className={cn('mt-1 text-xl font-bold tabular-nums', savingsRate != null && savingsRate < 0 ? 'text-[var(--color-danger)]' : 'text-[var(--ref-on-surface)]')}>{savingsRate == null ? '—' : `${savingsRate.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`}</p>
          </div>
          <div className="min-w-0 border-t border-[var(--color-border)] pt-4 md:border-t-0 md:pr-5 xl:border-l xl:px-5 xl:pt-0">
            <p className="flex items-center gap-2 text-xs text-[var(--ref-on-surface-variant)]"><Flame className="h-4 w-4" />Monthly burn <MetricHint>Average operating spend over the last three months.</MetricHint></p>
            <p className="mt-1 break-words text-xl font-bold tabular-nums">{analytics ? formatCurrency(analytics.burnRate.grossBurnRate) : '—'}</p>
          </div>
          <div className="min-w-0 border-t border-[var(--color-border)] pt-4 md:border-t-0 md:border-l md:pl-5 xl:pt-0">
            <p className="flex items-center gap-2 text-xs text-[var(--ref-on-surface-variant)]"><CalendarClock className="h-4 w-4" />Cash runway <MetricHint>Estimated months of liquid cash at the current monthly burn.</MetricHint></p>
            <p className="mt-1 break-words text-xl font-bold tabular-nums">{analytics?.runway.isUnbounded ? 'No observed burn' : analytics?.runway.runwayMonths != null ? `${analytics.runway.runwayMonths.toLocaleString('en-US', { maximumFractionDigits: 1 })} months` : '—'}</p>
          </div>
        </section>

        <section className="mt-6 grid grid-cols-1 items-stretch gap-5 xl:grid-cols-3">
          <NetWorthChart className="xl:col-span-2 xl:h-[24rem]" />
          <SpendingTrendChart periodId={selectedPeriod?.id ?? null} className="xl:h-[24rem]" />
        </section>

        <div className="fixed bottom-5 right-5 z-30 sm:bottom-7 sm:right-7">
          <AgentOrbActions state="idle" onPrompt={openAgent} />
        </div>

        <section className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 shadow-sm xl:col-span-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">Budget outlook</p>
                <h2 className="mt-1 font-headline text-xl font-extrabold text-[var(--ref-on-surface)]">Spending by category</h2>
              </div>
              {budgetSummary.totalPlanned > 0 && budgetSummary.isTracked ? <div className="flex flex-col items-end text-right">
                <div className="flex items-center gap-1">
                  <p className="text-sm font-bold text-[var(--ref-on-surface)]">{formatCurrency(budgetRemaining)} remaining</p>
                  {budgetOutlook?.total.projectedAmount != null && <div className="group relative">
                    <button type="button" aria-label="Show budget outlook" title="Show budget outlook" className="rounded-full p-1 text-[var(--ref-outline)] transition-colors hover:bg-[var(--ref-surface-container-high)] hover:text-[var(--ref-on-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--ref-primary)]"><Info className="h-3.5 w-3.5" /></button>
                    <div role="tooltip" className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden w-64 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3 text-left text-xs text-[var(--ref-on-surface)] shadow-lg group-hover:block group-focus-within:block"><p className="font-bold">Budget outlook</p><p className="mt-1 leading-relaxed">Likely finish {formatForecastRange(budgetOutlook.total.projectedLowAmount, budgetOutlook.total.projectedHighAmount, budgetOutlook.total.projectedAmount)}.</p>{dailyBudget != null && <p className="mt-1 text-[var(--ref-on-surface-variant)]">{formatCurrency(dailyBudget)} daily budget for the remaining days.</p>}<p className="mt-1 text-[var(--ref-on-surface-variant)]">{formatConfidenceLabel(budgetOutlook.confidence)} confidence · based on {budgetOutlook.eligiblePeriodCount} completed periods.</p>{budgetOutlook.patternReview.applied && <><p className="mt-1 text-[var(--ref-on-surface-variant)]">Pattern review applied to {budgetOutlook.patternReview.categoryCount} categor{budgetOutlook.patternReview.categoryCount === 1 ? 'y' : 'ies'}.</p><p className="mt-1 text-[var(--ref-on-surface-variant)]">Flagged purchase{budgetOutlook.patternReview.categoryCount === 1 ? '' : 's'}: {budgetOutlook.categories.filter((row) => row.patternReview).map((row) => `${row.patternReview!.description} (${formatCurrency(row.patternReview!.amount)}, ${row.patternReview!.classification.replace('_', ' ')})`).join(', ')}.</p></>}</div>
                  </div>}
                </div>
                {budgetOutlook?.total.projectedAmount != null && <p className="mt-1 text-xs font-semibold text-[var(--ref-on-surface-variant)]">Likely finish {formatForecastRange(budgetOutlook.total.projectedLowAmount, budgetOutlook.total.projectedHighAmount, budgetOutlook.total.projectedAmount)}</p>}
              </div> : <Link to="/budget" className="text-sm font-bold text-[var(--ref-primary)] hover:underline">{budgetSummary.totalPlanned > 0 ? 'Review coverage' : 'Set a budget'}</Link>}
            </div>
            {isPeriodLoading ? <div className="mt-6 h-56 animate-pulse rounded-2xl bg-[var(--ref-surface-container-highest)]" /> : !periodIsTracked ? <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">Budget and activity actuals are <strong>not tracked</strong> for this {selectedPeriod?.coverageStatus === 'skipped' ? 'skipped' : 'incomplete'} period. Empty totals are not a zero-activity result.</div> : planRows.length === 0 ? <div className="mt-6 rounded-2xl bg-[var(--ref-surface-container-low)] p-6 text-sm text-[var(--ref-on-surface-variant)]">No categorized spending for this period yet. Add transactions or set a budget to start planning.</div> : <div className="mt-6 space-y-5">{planRows.map((row) => {
              const ratio = row.planned > 0 ? row.actual / row.planned : 0;
              const actualOverBudget = row.planned > 0 && ratio >= 1;
              const actualNearBudget = row.planned > 0 && ratio >= 0.75;
              const outlookRange = formatForecastRange(row.outlook?.projectedLowAmount ?? null, row.outlook?.projectedHighAmount ?? null, row.outlook?.projectedAmount ?? null);
              return <div key={row.outlook?.categoryId ?? row.name}>
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="font-bold text-[var(--ref-on-surface)]">{row.name}</p>
                    <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">{row.planned > 0 ? `${formatCurrency(row.actual)} of ${formatCurrency(row.planned)}` : `${formatCurrency(row.actual)} recorded`}</p>
                  </div>
                  <p className={cn('text-sm font-bold', actualOverBudget ? 'text-[var(--color-danger)]' : actualNearBudget ? 'text-amber-700' : 'text-[var(--ref-primary)]')}>{row.planned > 0 ? `${Math.round(ratio * 100)}%` : formatCurrency(row.actual)}</p>
                </div>
                <div className="mt-2 h-3 overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]"><div className={cn('h-full rounded-full', actualOverBudget ? 'bg-[var(--color-danger)]' : actualNearBudget ? 'bg-amber-600' : 'bg-[var(--ref-primary)]')} style={{ width: `${Math.min(100, row.planned > 0 ? ratio * 100 : 100)}%` }} /></div>
                {outlookRange && <p className={cn('mt-1.5 text-[11px]', row.outlook?.riskStatus === 'at_risk' ? 'text-amber-800' : 'text-[var(--ref-on-surface-variant)]')}>Outlook: likely {outlookRange} by period end{row.outlook?.scheduledRemainingAmount ? ` · includes ${formatCurrency(row.outlook.scheduledRemainingAmount)} scheduled` : ''}.</p>}
              </div>;
            })}</div>}
            <Link to="/budget" className="mt-6 inline-flex items-center gap-1 text-sm font-bold text-[var(--ref-primary)] hover:underline">Manage budget <ArrowRight className="h-4 w-4" /></Link>
          </div>
          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 shadow-sm"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">Recent activity</p><h2 className="mt-1 font-headline text-xl font-extrabold text-[var(--ref-on-surface)]">Latest recorded</h2></div><ReceiptText className="h-5 w-5 text-[var(--ref-primary)]" /></div><div className="mt-5 divide-y divide-[var(--color-border)]">{visibleRecent.length === 0 ? <p className="py-6 text-sm text-[var(--ref-on-surface-variant)]">No active transactions in this period.</p> : visibleRecent.slice(0, 8).map((tx) => { const kind = classifyTx(tx); const category = tx.categoryId == null ? null : categories.find((item) => item.id === tx.categoryId); return <div key={tx.id} className="py-3 first:pt-0"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold text-[var(--ref-on-surface)]">{tx.description}</p><p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">{category?.name ?? (kind === 'income' ? 'Income' : kind === 'neutral' ? 'Transfer or adjustment' : 'Unallocated')} · {formatDate(tx.date)}</p></div><p className={cn('shrink-0 font-mono text-sm font-bold', kind === 'expense' ? 'text-[var(--color-danger)]' : kind === 'income' ? 'text-[var(--color-success)]' : 'text-[var(--ref-on-surface)]')}>{kind === 'expense' ? '-' : kind === 'income' ? '+' : ''}{formatCurrency(transactionAmount(tx))}</p></div></div>; })}</div><Link to="/transactions" className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-[var(--ref-primary)] hover:underline">Open transactions <ArrowRight className="h-4 w-4" /></Link></div>
        </section>

        <section className="mt-6"><div className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ref-primary)]" /><div><h2 className="font-headline text-lg font-extrabold text-[var(--ref-on-surface)]">Data confidence</h2><p className="mt-1 text-sm text-[var(--ref-on-surface-variant)]">Position: current posted ledger balances · activity through {formatAsOf(selectedPeriodAsOf)} · reconciliation: {reconciliation?.sessions.find((session) => session.lifecycleStatus === 'active') ? 'recent check on record' : 'no current check on record'}.</p></div></div><Link to="/accounts" className="shrink-0 text-sm font-bold text-[var(--ref-primary)] hover:underline">Review accounts <ArrowRight className="inline h-4 w-4" /></Link></div></div></section>

        <TransactionModal isOpen={isTransactionOpen} onClose={() => setIsTransactionOpen(false)} onSaved={() => { setIsTransactionOpen(false); refreshDashboard(); }} accounts={accounts} categories={categories} tags={tags} editingTransaction={null} periodId={selectedPeriod?.id ?? null} />
        <MonthlyReportModal isOpen={isReportOpen} onClose={() => setIsReportOpen(false)} />
        </div>}
        {isMobile && <TransactionModal isOpen={isTransactionOpen} onClose={() => setIsTransactionOpen(false)} onSaved={() => { setIsTransactionOpen(false); refreshDashboard(); }} accounts={accounts} categories={categories} tags={tags} editingTransaction={null} periodId={selectedPeriod?.id ?? null} />}
      </PageContainer>
    </RequireAuth>
  );
}
