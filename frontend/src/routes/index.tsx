import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AgentOrbActions } from '../components/ui/AgentOrbActions';
import { PageContainer } from '../components/ui/PageContainer';
import { PeriodPicker } from '../components/ui/PeriodPicker';
import { RequireAuth, useAuth } from '../lib/auth';
import { api, type AgentFinancialFacts, type BudgetPlan, type BudgetSummary } from '../lib/api';
import { fetchOnboardingStatus } from '../lib/onboarding-status';
import { findCurrentPeriod, formatCurrency, formatDateTime, formatDayMonth, formatTime } from '../lib/utils';
import { NetWorthChart, SpendingTrendChart } from '../components/analytics';
import { TransactionModal } from '../components/transactions/TransactionModal';
// The report modal pulls in the PDF engine; load it only when the report is opened.
const MonthlyReportModal = lazy(() => import('../components/pdf/MonthlyReportModal').then((module) => ({ default: module.MonthlyReportModal })));
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
import { queryKeys } from '../features/core/query-keys';
import { useReviewBudgetOutlookMutation } from '../features/budgets/queries';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useNow } from '../hooks/useNow';
import { useBalanceVisibility } from '../hooks/useBalanceVisibility';
import { useNetWorthTrendQuery } from '../features/analytics/queries';
import { useAgentProfileQuery, useFinancialFactsQuery } from '../features/agent/queries';
import { usePendingTransactionsQuery } from '../features/transactions/queries';
import { useGoalsQuery } from '../features/goals/queries';
import { useGoalDueTasksQuery } from '../features/goals/notes/queries';
import { useGoalRemindersQuery } from '../features/goals/trip/queries';
import { useAverageSpending } from '../features/goals/use-headline';
import { GoalsDashboardPanel } from '../features/dashboard/GoalsDashboardPanel';
import { useUiStore } from '../stores/ui-store';
import { DashboardViewMenu } from '../features/dashboard/DashboardViewMenu';
import { DashboardSections } from '../features/dashboard/DashboardSections';
import { DashboardNotifications } from '../features/dashboard/DashboardNotifications';
import { AttentionStrip } from '../features/dashboard/AttentionStrip';
import { useAttentionReadState } from '../features/dashboard/use-attention-read-state';
import { DashboardHero, DashboardTodayCard, type BalanceMetrics, type BudgetPace } from '../features/dashboard/DashboardHero';
import { PulsePanel } from '../features/dashboard/PulsePanel';
import { monthlySubscriptionCost, spentThroughDay, type PulseInputs, type PulseMetricId } from '../features/dashboard/pulse-metrics';
import { BudgetPanel } from '../features/dashboard/BudgetPanel';
import { ActivityPanel } from '../features/dashboard/ActivityPanel';
import { PaymentsPanel } from '../features/dashboard/PaymentsPanel';
import { buildAttentionItems, goalReminders, isTrackedCoverage } from '../features/dashboard/attention';
import { budgetUsedRatio, periodPacing } from '../features/dashboard/pacing';
import { upcomingCommitments } from '../features/dashboard/commitments';
import { fallbackName, heroCopy, percentChange, timeOfDayGreeting } from '../features/dashboard/hero-copy';
import { mergeDashboardViewChange, selectedDashboardPreset, usesOriginalDashboardSections, type DashboardSection } from '../features/dashboard/view-preferences';
import { useDashboardViewPreferences } from '../features/dashboard/use-view-preferences';
import { adjacentPeriodId, swipeStep, type PeriodStep } from '../features/dashboard/navigation';
import { useDashboardShortcuts } from '../features/dashboard/use-dashboard-shortcuts';
import { ShortcutsDialog } from '../features/dashboard/ShortcutsDialog';
import '../features/dashboard/dashboard.css';
import { DashboardRecap, DashboardRecapControl, DashboardRecapModal } from '../features/recaps/DashboardRecap';

export const Route = createFileRoute('/')({
  component: DashboardPage,
  beforeLoad: async () => {
    const status = await fetchOnboardingStatus();
    if (status?.needsOnboarding) throw redirect({ to: '/onboarding' });
  },
});

const STALE_DASHBOARD_MS = 5 * 60_000;
const NO_ROWS: never[] = [];

type Period = Awaited<ReturnType<typeof api.periods.list>>[number];
type Account = Awaited<ReturnType<typeof api.accounts.list>>[number];
type Category = Awaited<ReturnType<typeof api.categories.list>>[number];
type Tag = Awaited<ReturnType<typeof api.tags.list>>[number];
type DashboardAnalytics = Awaited<ReturnType<typeof api.analytics.dashboard>>;
type Facts = AgentFinancialFacts['data'];
type ReconciliationHistory = Awaited<ReturnType<typeof api.accounts.reconciliationHistory>>;
type Loan = Awaited<ReturnType<typeof api.loans.list>>[number];
type PayLaterObligations = Awaited<ReturnType<typeof api.paylater.obligations>>;
type SubscriptionData = Awaited<ReturnType<typeof api.subscriptions.list>>;

/** "Today, 17:04" for the live position; otherwise the full date and time in the user's format. */
function formatAsOf(timestamp: number, now: number): string {
  return new Date(timestamp).toDateString() === new Date(now).toDateString() ? `Today, ${formatTime(timestamp)}` : formatDateTime(timestamp);
}

function budgetPlansFromPayload(payload: BudgetSummary | BudgetSummary[] | undefined): BudgetPlan[] {
  const summary = Array.isArray(payload) ? payload[0] : payload;
  return Array.isArray(summary?.plans) ? summary.plans : [];
}

function DashboardPage() {
  const { preferences, updatePreferences } = useDashboardViewPreferences();
  const { balancesHidden, formatAmount, maskAmounts } = useBalanceVisibility();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const isOriginalView = selectedDashboardPreset(preferences) === 'original';
  // On phones the original view collapses to recent activity; a customized panel order is left as the user arranged it.
  const visiblePreferences = usesOriginalDashboardSections(preferences) && isMobile
    ? { ...preferences, hiddenSections: preferences.sectionOrder.filter(id => id !== 'activity') }
    : preferences;
  const updateVisiblePreferences = (next: typeof preferences) => updatePreferences(mergeDashboardViewChange(preferences, visiblePreferences, next));
  const [isEditingLayout, setIsEditingLayout] = useState(false);
  const dashboardNow = useNow();
  const { user } = useAuth();
  const [pinnedPeriodId, setPinnedPeriodId] = useState<string | null>(null);
  const [isTransactionOpen, setIsTransactionOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [recapModalPeriodId, setRecapModalPeriodId] = useState<number | null>(null);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const toggleBalancesHidden = useUiStore((state) => state.toggleBalancesHidden);
  const reviewedOutlookRevisionRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { mutateAsync: requestOutlookReview } = useReviewBudgetOutlookMutation();
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
  const periods = useMemo(() => (periodsQuery.data ?? []) as Period[], [periodsQuery.data]);
  const accounts = (accountsQuery.data ?? []) as Account[];
  const categories = (categoriesQuery.data ?? []) as Category[];
  const tags = (tagsQuery.data ?? []) as Tag[];
  const analytics = (analyticsQuery.data ?? null) as DashboardAnalytics | null;
  const reconciliation = (reconciliationQuery.data ?? null) as ReconciliationHistory | null;
  const loans = useMemo(() => (loansQuery.data ?? []) as Loan[], [loansQuery.data]);
  const paylater = (paylaterQuery.data ?? null) as PayLaterObligations | null;
  const subscriptions = (subscriptionsQuery.data ?? null) as SubscriptionData | null;
  const pendingTransactionCount = pendingTransactionsQuery.data?.length ?? 0;
  const overviewQueries = [periodsQuery, accountsQuery, categoriesQuery, tagsQuery, analyticsQuery, reconciliationQuery, loansQuery, paylaterQuery, subscriptionsQuery];
  // Only period and category lookups gate the page; every other panel shows its own loading state.
  const isLoading = periodsQuery.isLoading || categoriesQuery.isLoading;
  const isAnalyticsLoading = analyticsQuery.isLoading;
  const isCommitmentsLoading = loansQuery.isLoading || paylaterQuery.isLoading || subscriptionsQuery.isLoading;
  const loadError = overviewQueries.find((query) => query.error)?.error?.message ?? null;
  const refreshDashboard = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.periods.all });
  }, [queryClient]);
  const positionUpdatedAt = analyticsQuery.dataUpdatedAt || dashboardNow;
  // Pulse the "as of" time whenever fresh analytics arrive after the page first loaded.
  const analyticsUpdateCount = queryClient.getQueryState(queryKeys.dashboard.analytics)?.dataUpdateCount ?? 0;
  const [initialAnalyticsUpdateCount] = useState(analyticsUpdateCount);
  const positionJustRefreshed = analyticsUpdateCount > Math.max(initialAnalyticsUpdateCount, 1);

  // Window-focus refetching is off app-wide, so refresh a dashboard left open in a background tab.
  useEffect(() => {
    const refreshStaleDashboard = () => {
      const updatedAt = queryClient.getQueryState(queryKeys.dashboard.analytics)?.dataUpdatedAt ?? 0;
      if (document.visibilityState === 'visible' && Date.now() - updatedAt >= STALE_DASHBOARD_MS) refreshDashboard();
    };
    document.addEventListener('visibilitychange', refreshStaleDashboard);
    return () => document.removeEventListener('visibilitychange', refreshStaleDashboard);
  }, [queryClient, refreshDashboard]);

  const currentPeriod = useMemo(() => findCurrentPeriod(periods, dashboardNow) ?? null, [periods, dashboardNow]);

  // A period picked by hand sticks; otherwise the dashboard follows the current period, including across a rollover.
  const currentPeriodId = String(currentPeriod?.id ?? '');
  const selectedPeriodId = pinnedPeriodId != null && periods.some((period) => String(period.id) === pinnedPeriodId) ? pinnedPeriodId : currentPeriodId;
  const selectPeriod = (periodId: string) => setPinnedPeriodId(periodId === currentPeriodId ? null : periodId);
  const stepPeriod = (step: PeriodStep) => {
    const next = adjacentPeriodId(periods, selectedPeriodId, step);
    if (next) selectPeriod(next);
  };

  const selectedPeriod = useMemo(
    () => periods.find((period) => String(period.id) === selectedPeriodId) ?? null,
    [periods, selectedPeriodId],
  );

  // Notifications always describe the current period, whichever period is being browsed.
  const currentPeriodQueries = useDashboardPeriodQueries(currentPeriod?.id ?? null);
  const currentFacts = (currentPeriodQueries.facts.data?.data ?? null) as Facts | null;
  const currentBudgetRows = useMemo(() => budgetPlansFromPayload(currentPeriodQueries.budget.data as BudgetSummary | BudgetSummary[] | undefined), [currentPeriodQueries.budget.data]);
  const currentOutlook = currentPeriodQueries.outlook.data?.periodId === currentPeriod?.id ? currentPeriodQueries.outlook.data ?? null : null;

  const periodQueries = useDashboardPeriodQueries(selectedPeriod?.id ?? null);
  const facts = (periodQueries.facts.data?.data ?? null) as Facts | null;
  const budgetRows = useMemo(() => budgetPlansFromPayload(periodQueries.budget.data as BudgetSummary | BudgetSummary[] | undefined), [periodQueries.budget.data]);
  const categorySpending = facts?.facts.byCategory ?? NO_ROWS;
  const recent = periodQueries.recent.data?.data ?? NO_ROWS;
  const budgetOutlook = periodQueries.outlook.data ?? null;
  const isPeriodLoading = selectedPeriod != null && [periodQueries.facts, periodQueries.budget, periodQueries.recent, periodQueries.outlook].some((query) => query.isLoading);
  const periodLoadError = [periodQueries.facts, periodQueries.budget, periodQueries.recent, periodQueries.outlook].find((query) => query.error)?.error?.message ?? null;
  const combinedLoadError = loadError ?? periodLoadError;

  // The outlier review is an agent task, so only the live period's forecast gets one; browsing past periods never queues it.
  const currentReviewStatus = (currentPeriodQueries.review.data as { task?: { status?: string } } | undefined)?.task?.status;
  const currentReviewInFlight = currentReviewStatus === 'queued' || currentReviewStatus === 'running' || currentReviewStatus === 'retrying';
  useEffect(() => {
    if (!currentPeriod || !currentOutlook || currentReviewInFlight || currentPeriodQueries.review.isLoading) return;
    if (currentOutlook.patternReview.applied || !currentOutlook.categories.some((row) => row.outlierCount > 0)) return;
    const reviewKey = `${currentPeriod.id}:${currentOutlook.patternReview.evidenceRevision}`;
    if (reviewedOutlookRevisionRef.current === reviewKey) return;
    reviewedOutlookRevisionRef.current = reviewKey;
    void requestOutlookReview(currentPeriod.id).catch(() => undefined);
  }, [currentOutlook, currentPeriod, currentPeriodQueries.review.isLoading, currentReviewInFlight, requestOutlookReview]);

  useEffect(() => {
    if (currentReviewStatus !== 'completed' || !currentPeriod) return;
    void queryClient.invalidateQueries({ queryKey: [...queryKeys.dashboard.period(currentPeriod.id), 'outlook'] });
  }, [currentPeriod, currentReviewStatus, queryClient]);

  const commitments = useMemo(() => upcomingCommitments({
    subscriptions: subscriptions?.subscriptions ?? [],
    payLater: paylater?.obligations ?? [],
    loans,
  }, dashboardNow), [dashboardNow, loans, paylater, subscriptions]);

  // Goals feed the bell (what to put in, goals running late) and the pulse strip.
  const goalsQuery = useGoalsQuery();
  const goalTasksQuery = useGoalDueTasksQuery();
  const goalRemindersQuery = useGoalRemindersQuery();
  const averageSpending = useAverageSpending();
  const attentionItems = useMemo(() => buildAttentionItems({
    now: dashboardNow,
    pendingTransactionCount,
    ledgerBalanced: analytics ? analytics.trialBalance.isBalanced : null,
    currentPeriod,
    budgetRows: currentBudgetRows,
    outlookCategories: currentOutlook?.categories ?? [],
    unallocatedSpentCents: currentFacts?.facts.byCategory.find((row) => row.categoryId == null && row.spentCents > 0)?.spentCents ?? null,
    reconciliationSessions: reconciliation?.sessions ?? null,
    loans,
    payLaterObligations: paylater?.obligations ?? [],
    subscriptionRenewals: subscriptions?.renewalPreview.occurrences ?? [],
    commitments,
    goals: goalsQuery.data ? { ...goalReminders(goalsQuery.data, dashboardNow, averageSpending), tasks: goalTasksQuery.data ?? [], kinds: goalRemindersQuery.data ?? [] } : null,
  }, { amount: formatCurrency, date: formatDayMonth }), [analytics, averageSpending, commitments, currentBudgetRows, currentFacts, currentOutlook, currentPeriod, dashboardNow, goalsQuery.data, goalTasksQuery.data, goalRemindersQuery.data, loans, paylater, pendingTransactionCount, reconciliation, subscriptions]);
  // One read state for the bell and the inline strip, so marking an item read clears it from both.
  const attentionReadState = useAttentionReadState(attentionItems, user?.email);

  const periodIsTracked = isTrackedCoverage(selectedPeriod?.coverageStatus);
  const totalPlanned = budgetRows.reduce((sum, row) => sum + row.plannedAmount, 0);
  const totalActual = budgetRows.reduce((sum, row) => sum + row.actualAmount, 0);
  const budgetRemaining = budgetOutlook?.total.remainingAmount ?? (periodIsTracked ? totalPlanned - totalActual : 0);
  const dailyBudget = budgetOutlook && budgetOutlook.daysRemaining > 0 ? Math.max(0, Math.round(budgetRemaining / budgetOutlook.daysRemaining)) : null;
  const pacing = useMemo(() => (selectedPeriod ? periodPacing(selectedPeriod, dashboardNow) : null), [selectedPeriod, dashboardNow]);
  const budgetPaceRatio = budgetOutlook && periodIsTracked ? budgetUsedRatio(totalActual, totalPlanned) : null;
  const budgetPace: BudgetPace | null = pacing && periodIsTracked ? { pacing, usedRatio: budgetPaceRatio, dailyBudget, daysRemaining: budgetOutlook?.daysRemaining ?? null } : null;
  const netWorthSeries = netWorthTrendQuery.data?.series ?? [];
  const selectedPeriodEnded = selectedPeriod != null && selectedPeriod.id !== currentPeriod?.id && selectedPeriod.startDate < dashboardNow;
  const copy = heroCopy({
    budgetOverrun: periodIsTracked && budgetRemaining < 0 ? budgetRemaining : null,
    periodName: selectedPeriod?.name ?? null,
    periodEnded: selectedPeriodEnded,
    netWorthChangePercent: percentChange(netWorthSeries[0]?.netWorth, netWorthSeries.at(-1)?.netWorth),
    upcomingCommitmentTotal: commitments.total,
  }, formatAmount);
  const greeting = `${timeOfDayGreeting(new Date(dashboardNow).getHours())}, ${agentProfileQuery.data?.nickname?.trim() || fallbackName(user?.email)}`;

  const analyticsValue = (cents: number | undefined) => (cents != null ? formatAmount(cents) : isAnalyticsLoading ? 'Loading…' : '—');
  const balanceMetrics: BalanceMetrics = {
    cash: { label: 'Available cash', value: analyticsValue(analytics?.netWorth.liquidAssets), cents: analytics?.netWorth.liquidAssets, to: '/accounts' },
    budget: { label: 'Budget left', value: isPeriodLoading ? 'Loading…' : !periodIsTracked ? 'Not tracked' : totalPlanned <= 0 ? 'No budget yet' : formatAmount(budgetRemaining), cents: !isPeriodLoading && periodIsTracked && totalPlanned > 0 ? budgetRemaining : undefined, to: '/budget' },
    netWorth: { label: 'Net worth', value: analyticsValue(analytics?.netWorth.netWorth), cents: analytics?.netWorth.netWorth, to: '/accounts' },
  };

  const topCategory = categorySpending.reduce<(typeof categorySpending)[number] | null>((top, row) => (row.spentCents > 0 && (!top || row.spentCents > top.spentCents) ? row : top), null);
  // Data only some pulse metrics need is fetched while one of those metrics is on the strip.
  const showsPulse = (id: PulseMetricId) => !preferences.hiddenSections.includes('pulse') && preferences.pulseMetrics.includes(id);
  const previousPeriodId = adjacentPeriodId(periods, selectedPeriodId, 'older');
  const previousPeriod = periods.find((period) => String(period.id) === previousPeriodId) ?? null;
  const previousFactsQuery = useFinancialFactsQuery({ periodId: previousPeriod?.id }, showsPulse('spendVsLast') && previousPeriod != null);
  const reimbursementsQuery = useQuery({ queryKey: queryKeys.reimbursements.list(), queryFn: () => api.reimbursements.list(), enabled: showsPulse('reimbursementsDue') });
  const previousFacts = previousFactsQuery.data?.data.facts;
  const previousPeriodInput: PulseInputs['previousPeriod'] = !previousPeriod ? 'none' : !previousFacts || !pacing ? null
    : pacing.status === 'ended'
      ? { name: previousPeriod.name, spentToDateCents: previousFacts.totalSpentCents, dayIndex: pacing.totalDays }
      : { name: previousPeriod.name, spentToDateCents: spentThroughDay(previousFacts.rows, previousPeriod.startDate, pacing.dayIndex), dayIndex: pacing.dayIndex };
  const lentLoans = loans.filter((loan) => loan.direction === 'lent' && loan.status === 'active' && loan.remainingCents > 0);
  const openClaims = (reimbursementsQuery.data ?? []).filter((claim) => claim.outstandingAmount > 0);
  const netWorthFirst = netWorthSeries[0]?.netWorth;
  const netWorthLast = netWorthSeries.at(-1)?.netWorth;
  const pulseInputs: PulseInputs = {
    isTracked: periodIsTracked,
    incomeCents: facts?.facts.totalIncomeCents ?? 0,
    spentCents: facts?.facts.totalSpentCents ?? 0,
    transactionCount: facts?.facts.rows.length ?? 0,
    topCategory: topCategory ? { name: topCategory.categoryId == null ? 'Unallocated' : topCategory.category, spentCents: topCategory.spentCents } : null,
    burnRate: analytics?.burnRate.grossBurnRate ?? null,
    runway: analytics?.runway ?? null,
    netWorth: analytics?.netWorth.netWorth ?? null,
    liabilities: analytics?.netWorth.totalLiabilities ?? null,
    upcoming: isCommitmentsLoading ? null : { total: commitments.total, count: commitments.count },
    budget: periodIsTracked ? { planned: totalPlanned, actual: totalActual, dailyBudget, daysRemaining: budgetOutlook?.daysRemaining ?? null } : null,
    pacing,
    isAnalyticsLoading,
    isPeriodLoading,
    previousPeriod: previousPeriodInput,
    netWorthChange: netWorthFirst != null && netWorthLast != null ? { amount: netWorthLast - netWorthFirst, percent: percentChange(netWorthFirst, netWorthLast) } : null,
    owedToYou: loansQuery.data ? { total: lentLoans.reduce((sum, loan) => sum + loan.remainingCents, 0), count: lentLoans.length } : null,
    reimbursements: reimbursementsQuery.data ? { total: openClaims.reduce((sum, claim) => sum + claim.outstandingAmount, 0), count: openClaims.length } : null,
    subscriptions: subscriptions ? monthlySubscriptionCost(subscriptions.subscriptions) : null,
    pendingCount: pendingTransactionsQuery.data ? pendingTransactionCount : null,
    goals: goalsQuery.data ? { ...goalsQuery.data, activeCount: goalsQuery.data.goals.filter((goal) => goal.status === 'active').length } : null,
  };

  const closeShortcuts = useCallback(() => setIsShortcutsOpen(false), []);
  const showShortcuts = useCallback(() => setIsShortcutsOpen(true), []);
  useDashboardShortcuts({
    enabled: !isLoading && !isTransactionOpen && !isReportOpen && recapModalPeriodId == null && !isEditingLayout && !isShortcutsOpen,
    onStep: stepPeriod,
    onToggleBalances: toggleBalancesHidden,
    onShowHelp: showShortcuts,
  });

  const openAgent = (prompt = '') => {
    const text = prompt.trim();
    void navigate({ to: '/agent', search: text ? { prompt: text } : {} });
  };

  const dashboardSections: Record<DashboardSection, ReactNode> = {
    pulse: <PulsePanel metrics={preferences.pulseMetrics} onChangeMetrics={(pulseMetrics) => updatePreferences({ ...preferences, pulseMetrics })} inputs={pulseInputs} formatAmount={formatAmount} />,
    netWorth: <NetWorthChart hideAmounts={balancesHidden} periodId={selectedPeriod?.id ?? null} className="xl:h-[24rem]" />,
    spending: <SpendingTrendChart hideAmounts={balancesHidden} periodId={selectedPeriod?.id ?? null} className="xl:h-[24rem]" />,
    budget: <BudgetPanel periodId={selectedPeriod?.id ?? null} coverageStatus={selectedPeriod?.coverageStatus} isLoading={isPeriodLoading} isTracked={periodIsTracked} outlook={budgetOutlook} budgetRows={budgetRows} spending={categorySpending} totalPlanned={totalPlanned} remaining={budgetRemaining} dailyBudget={dailyBudget} formatAmount={formatAmount} />,
    activity: <ActivityPanel transactions={recent} categories={categories} compact={isMobile} now={dashboardNow} formatAmount={formatAmount} maskAmounts={maskAmounts} />,
    payments: <PaymentsPanel rows={commitments.rows} total={commitments.total} isLoading={isCommitmentsLoading} now={dashboardNow} formatAmount={formatAmount} maskAmounts={maskAmounts} />,
    goals: <GoalsDashboardPanel overview={goalsQuery.data} isLoading={goalsQuery.isPending} now={dashboardNow} formatAmount={formatAmount} />,
  };

  if (isLoading) {
    return <RequireAuth><PageContainer><div className="h-8 w-56 animate-pulse rounded bg-[var(--ref-surface-container-highest)]" /><div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((key) => <div key={key} className="h-44 animate-pulse rounded-3xl bg-[var(--ref-surface-container-highest)]" />)}</div></PageContainer></RequireAuth>;
  }

  const viewMenu = <DashboardViewMenu preferences={visiblePreferences} onChange={updateVisiblePreferences} preset={isOriginalView ? 'original' : undefined} onEditLayout={() => setIsEditingLayout(true)} />;

  return (
    <RequireAuth>
      <PageContainer className="dashboard-page space-y-4 sm:space-y-4"><div className="dashboard-content space-y-4">
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center justify-between gap-3 sm:block">
            <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--ref-secondary)]">Decision centre</p>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Position as of <span key={analyticsUpdateCount} className={positionJustRefreshed ? 'dashboard-position-updated' : undefined}>{formatAsOf(positionUpdatedAt, dashboardNow)}</span>{analyticsQuery.isFetching && !analyticsQuery.isLoading ? ' · Updating…' : ''}</p></div>
            {isMobile && viewMenu}
          </div>
          <div className="dashboard-toolbar flex items-center justify-between gap-2 sm:justify-end">
            {periods.length > 0 && (
              // Phones can swipe the picker sideways to step between periods.
              <div
                style={{ display: 'contents' }}
                onTouchStart={(event) => { const touch = event.touches[0]; swipeStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null; }}
                onTouchEnd={(event) => {
                  const start = swipeStartRef.current;
                  const touch = event.changedTouches[0];
                  swipeStartRef.current = null;
                  const step = start && touch ? swipeStep(touch.clientX - start.x, touch.clientY - start.y) : null;
                  if (step) stepPeriod(step);
                }}
              >
                <PeriodPicker periods={periods} value={selectedPeriodId} onChange={selectPeriod} ariaLabel="Dashboard period" className="dashboard-period-picker" />
              </div>
            )}
            {!isMobile && viewMenu}
            <DashboardRecapControl periodId={selectedPeriod?.id} onOpen={setRecapModalPeriodId} />
            <DashboardNotifications items={attentionItems} readState={attentionReadState} maskAmounts={maskAmounts} />
          </div>
        </div>

        <DashboardHero greeting={greeting} copy={copy} mainMetric={preferences.mainMetric} metrics={balanceMetrics} budgetPace={budgetPace} commitments={commitments} isCommitmentsLoading={isCommitmentsLoading} formatAmount={formatAmount} onAddTransaction={() => setIsTransactionOpen(true)} onViewReport={() => setIsReportOpen(true)} />

        <AttentionStrip items={attentionItems} readState={attentionReadState} maskAmounts={maskAmounts} />

        <DashboardRecap key={selectedPeriod?.id} periodId={selectedPeriod?.id} now={dashboardNow} onOpen={setRecapModalPeriodId} />
        {recapModalPeriodId != null && <DashboardRecapModal periodId={recapModalPeriodId} onClose={() => setRecapModalPeriodId(null)} />}

        {combinedLoadError && <div className="mt-5 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{combinedLoadError}</div>}

        <DashboardTodayCard mainMetric={preferences.mainMetric} metrics={balanceMetrics} dailyBudget={dailyBudget} formatAmount={formatAmount} />

        <DashboardSections preferences={visiblePreferences} sections={dashboardSections} editing={isEditingLayout} onChange={next => updatePreferences({ ...preferences, sectionOrder: next.sectionOrder, sectionSizes: next.sectionSizes })} onDone={() => setIsEditingLayout(false)} />
        {!isMobile && <div className="fixed bottom-5 right-[calc(1.25rem+var(--scroll-lock-gap,0px))] z-30 sm:bottom-7 sm:right-[calc(1.75rem+var(--scroll-lock-gap,0px))]"><AgentOrbActions state="idle" onPrompt={openAgent} /></div>}
        <TransactionModal isOpen={isTransactionOpen} onClose={() => setIsTransactionOpen(false)} onSaved={() => { setIsTransactionOpen(false); refreshDashboard(); }} accounts={accounts} categories={categories} tags={tags} editingTransaction={null} periodId={selectedPeriod?.id ?? null} />
        {isReportOpen && <Suspense fallback={null}><MonthlyReportModal isOpen onClose={() => setIsReportOpen(false)} /></Suspense>}
        <ShortcutsDialog open={isShortcutsOpen} onClose={closeShortcuts} />
        </div>
      </PageContainer>
    </RequireAuth>
  );
}
