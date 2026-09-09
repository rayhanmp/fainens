import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ChevronDown,
  CircleDollarSign,
  Info,
  Landmark,
  Plus,
  ReceiptText,
  Send,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { AgentOrbActions } from '../components/ui/AgentOrbActions';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { PageHeader } from '../components/ui/PageHeader';
import { PageContainer } from '../components/ui/PageContainer';
import { RequireAuth } from '../lib/auth';
import type { api, AgentFinancialFacts, BudgetOutlook, BudgetPlan, BudgetSummary } from '../lib/api';
import { fetchOnboardingStatus } from '../lib/onboarding-status';
import { cn, formatCurrency, formatDate } from '../lib/utils';
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

function DashboardPage() {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [isTransactionOpen, setIsTransactionOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isAttentionExpanded, setIsAttentionExpanded] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState('');
  const reviewedOutlookRevisionRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const reviewBudgetOutlookMutation = useReviewBudgetOutlookMutation();

  const periodsQuery = usePeriodsQuery();
  const accountsQuery = useAccountsLedgerQuery();
  const categoriesQuery = useCategoriesQuery();
  const tagsQuery = useTagsQuery();
  const analyticsQuery = useDashboardOverviewQuery();
  const reconciliationQuery = useDashboardReconciliationQuery(1);
  const loansQuery = useDashboardLoansQuery();
  const paylaterQuery = useDashboardPayLaterQuery();
  const subscriptionsQuery = useDashboardSubscriptionsQuery();
  const periods = (periodsQuery.data ?? []) as Period[];
  const accounts = (accountsQuery.data ?? []) as Account[];
  const categories = (categoriesQuery.data ?? []) as Category[];
  const tags = (tagsQuery.data ?? []) as Tag[];
  const analytics = (analyticsQuery.data ?? null) as DashboardAnalytics | null;
  const reconciliation = (reconciliationQuery.data ?? null) as ReconciliationHistory | null;
  const loans = (loansQuery.data ?? []) as Loan[];
  const paylater = (paylaterQuery.data ?? null) as PayLaterObligations | null;
  const subscriptions = (subscriptionsQuery.data ?? null) as SubscriptionData | null;
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
      const now = Date.now();
      const currentPeriod = periods.find((period) => period.startDate <= now && now <= period.endDate + DAY_MS - 1);
      return String((currentPeriod ?? periods[0])?.id ?? '');
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

  const attentionItems = useMemo<Attention[]>(() => {
    const next: Attention[] = [];
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
    const reconciliationAgeDays = latestReconciliation ? Math.floor((Date.now() - latestReconciliation.asOfDate) / DAY_MS) : null;
    if (!latestReconciliation || (reconciliationAgeDays != null && reconciliationAgeDays > 30)) {
      next.push({
        id: 'reconciliation', tone: 'warning', title: latestReconciliation ? 'Accounts need a fresh check' : 'No account reconciliation yet',
        detail: latestReconciliation ? `Last checked ${reconciliationAgeDays} days ago.` : 'Confirm your current balances so the position stays trustworthy.',
        to: '/accounts', action: 'Reconcile accounts',
      });
    }
    const overdueLoans = loans.filter((loan) => loan.isOverdue);
    if (overdueLoans.length > 0) {
      next.push({ id: 'loans', tone: 'danger', title: `${overdueLoans.length} loan${overdueLoans.length === 1 ? '' : 's'} overdue`, detail: 'Review repayment status and follow up with the counterparty.', to: '/loans', action: 'Open loans' });
    }
    const overduePaylater = paylater?.obligations.filter((item) => item.status === 'overdue') ?? [];
    const soonPaylater = paylater?.obligations.filter((item) => item.status === 'due_soon') ?? [];
    if (overduePaylater.length > 0 || soonPaylater.length > 0) {
      const count = overduePaylater.length || soonPaylater.length;
      next.push({ id: 'paylater', tone: overduePaylater.length ? 'danger' : 'warning', title: overduePaylater.length ? `${overduePaylater.length} PayLater payment${overduePaylater.length === 1 ? '' : 's'} overdue` : `${count} PayLater payment${count === 1 ? '' : 's'} due soon`, detail: 'Review the outstanding balance and upcoming due dates.', to: '/paylater', action: 'Open PayLater' });
    }
    const dueSubscriptions = subscriptions?.renewalPreview.occurrences.filter((occurrence) => occurrence.dueAt <= Date.now() + 7 * DAY_MS) ?? [];
    if (dueSubscriptions.length > 0) {
      next.push({ id: 'subscriptions', tone: 'info', title: `${dueSubscriptions.length} subscription renewal${dueSubscriptions.length === 1 ? '' : 's'} due soon`, detail: 'Review upcoming recurring charges before they post.', to: '/subscriptions', action: 'Review subscriptions' });
    }
    const riskyBudget = budgetSummary.isTracked ? budgetRows.find((row) => row.percentUsed >= 100) : undefined;
    const projectedBudget = budgetSummary.isTracked && !riskyBudget
      ? budgetOutlook?.categories.find((row) => row.riskStatus === 'at_risk')
      : undefined;
    if (riskyBudget || projectedBudget) {
      const row = riskyBudget ?? projectedBudget!;
      next.push({ id: 'budget', tone: riskyBudget ? 'danger' : 'warning', title: riskyBudget ? `${row.categoryName} is over budget` : `${row.categoryName} may exceed its budget`, detail: riskyBudget ? `${formatCurrency(row.actualAmount)} spent against ${formatCurrency(row.plannedAmount)} planned.` : 'Completed-period history suggests this budget may be exceeded.', to: '/budget', action: 'Review budget' });
    }
    const unallocated = facts?.facts.byCategory.find((row) => row.categoryId == null && row.spentCents > 0);
    if (unallocated) {
      next.push({ id: 'unallocated', tone: 'info', title: 'Some spending is unallocated', detail: `${formatCurrency(unallocated.spentCents)} cannot yet be attributed to a category.`, to: '/transactions', action: 'Classify activity' });
    }
    const priority = { danger: 0, warning: 1, info: 2 } as const;
    return next.sort((a, b) => priority[a.tone] - priority[b.tone]).slice(0, 5);
  }, [analytics, budgetOutlook, budgetRows, budgetSummary.isTracked, facts, loans, paylater, reconciliation, selectedPeriod, subscriptions]);

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

  const coverageWarnings = facts?.coverage.warnings ?? [];
  const periodIncome = facts?.facts.totalIncomeCents ?? 0;
  const periodExpense = facts?.facts.totalSpentCents ?? 0;
  const periodIsTracked = selectedPeriod?.coverageStatus === 'complete' || selectedPeriod?.coverageStatus === 'partial';
  const periodNet = periodIsTracked ? periodIncome - periodExpense : null;
  const selectedPeriodAsOf = facts?.facts.asOfMs ?? Date.now();
  const notificationItems = attentionItems.filter((item) => item.id !== 'coverage');
  const visibleRecent = recent.filter((transaction) => !isTransferFee(transaction));
  const budgetRemaining = budgetOutlook?.total.remainingAmount ?? budgetSummary.remaining ?? 0;
  const dailyBudget = budgetOutlook && budgetOutlook.daysRemaining > 0 ? Math.max(0, Math.round(budgetRemaining / budgetOutlook.daysRemaining)) : null;
  const openAgent = (prompt = agentPrompt) => {
    const text = prompt.trim();
    void navigate({ to: '/agent', search: text ? { prompt: text } : {} } as any);
  };

  if (isLoading) {
    return <RequireAuth><PageContainer><div className="h-8 w-56 animate-pulse rounded bg-[var(--ref-surface-container-highest)]" /><div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((key) => <div key={key} className="h-44 animate-pulse rounded-3xl bg-[var(--ref-surface-container-highest)]" />)}</div></PageContainer></RequireAuth>;
  }

  return (
    <RequireAuth>
      <PageContainer>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <PageHeader subtext="Decision centre" title="Your financial position" description={`Current position as of ${formatAsOf(Date.now())}${selectedPeriod ? ` · period view: ${selectedPeriod.name}` : ''}`} />
          <div className="flex flex-wrap items-center gap-2">
            {periods.length > 0 && <Select value={selectedPeriodId} onChange={(event) => setSelectedPeriodId(event.target.value)} options={periods.map((period) => ({ value: String(period.id), label: period.name }))} className="min-w-[170px] rounded-full border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] text-xs font-bold" />}
            <button type="button" onClick={() => setIsReportOpen(true)} className="hidden rounded-full border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-4 py-2.5 text-xs font-bold text-[var(--ref-primary)] transition-colors hover:bg-[var(--ref-surface-container-low)] md:inline-flex">Export report</button>
            <Button className="hidden rounded-full md:inline-flex" onClick={() => setIsTransactionOpen(true)}><Plus className="mr-2 h-4 w-4" />Add transaction</Button>
          </div>
        </div>

        {combinedLoadError && <div className="mt-5 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{combinedLoadError}</div>}
        {coverageWarnings.length > 0 && <Link to="/periods" className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><span><strong>Read this period carefully.</strong> {coverageWarnings[0]} <span className="ml-1 font-semibold underline">Review coverage</span></span></Link>}
        {notificationItems.length > 0 && <div className="mt-5 rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-4 py-3 text-sm"><div className="flex items-center gap-3"><AlertTriangle className={cn('h-5 w-5 shrink-0', notificationItems[0].tone === 'danger' ? 'text-rose-600' : notificationItems[0].tone === 'warning' ? 'text-amber-600' : 'text-sky-600')} /><p className="min-w-0 flex-1 font-bold">{notificationItems.length} item{notificationItems.length === 1 ? '' : 's'} may need your attention.</p><button type="button" onClick={() => setIsAttentionExpanded((current) => !current)} aria-expanded={isAttentionExpanded} aria-controls="dashboard-attention-details" className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-[var(--ref-primary)] transition-colors hover:bg-[var(--ref-primary)]/10">{isAttentionExpanded ? 'Hide details' : 'View details'}<ChevronDown className={cn('h-4 w-4 transition-transform', isAttentionExpanded && 'rotate-180')} /></button></div>{isAttentionExpanded && <div id="dashboard-attention-details" className="mt-3 space-y-2 border-t border-[var(--color-border)] pt-3">{notificationItems.map((item) => <div key={item.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><p className="min-w-0 flex-1 text-[var(--ref-on-surface-variant)]"><span className="font-semibold text-[var(--ref-on-surface)]">{item.title}:</span> {item.detail}</p><Link to={item.to} className="shrink-0 font-semibold text-[var(--ref-primary)] hover:underline">{item.action}</Link></div>)}</div>}</div>}

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
        <section className="mt-6 hidden grid-cols-1 gap-4 md:grid md:grid-cols-2 xl:grid-cols-4">
          <article className="cash-satin relative overflow-hidden rounded-3xl bg-[var(--ref-primary-container)] p-6 text-[var(--ref-on-primary-container)]"><Wallet className="h-5 w-5" /><p className="mt-4 text-xs font-bold uppercase tracking-widest">Available cash</p><p className="mt-3 font-headline text-3xl font-extrabold tracking-tight">{analytics ? formatCurrency(analytics.netWorth.liquidAssets) : '—'}</p><p className="mt-4 text-xs">Cash-equivalent assets only · current balance</p></article>
          <article className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 shadow-sm"><Landmark className="h-5 w-5 text-[var(--ref-primary)]" /><p className="mt-4 text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">Net worth</p><p className="mt-2 font-headline text-3xl font-extrabold tracking-tight text-[var(--ref-on-surface)]">{analytics ? formatCurrency(analytics.netWorth.netWorth) : '—'}</p><p className="mt-3 text-xs text-[var(--ref-on-surface-variant)]">Assets {analytics ? formatCurrency(analytics.netWorth.totalAssets) : '—'} · Liabilities {analytics ? formatCurrency(analytics.netWorth.totalLiabilities) : '—'}</p></article>
          <article className="relative rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 shadow-sm"><div className="flex items-center justify-between"><CalendarClock className="h-5 w-5 text-[var(--ref-primary)]" />{analytics?.runway && <div className="group relative"><button type="button" aria-label="Show runway calculation" title="Show runway calculation" className="rounded-full p-1 text-[var(--ref-outline)] transition-colors hover:bg-[var(--ref-surface-container-high)] hover:text-[var(--ref-on-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--ref-primary)]"><Info className="h-4 w-4" /></button><div role="tooltip" className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden w-64 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3 text-left text-xs text-[var(--ref-on-surface)] shadow-lg group-hover:block group-focus-within:block"><p className="font-bold">Runway calculation</p>{analytics.runway.isUnbounded ? <p className="mt-1 leading-relaxed">No recorded monthly burn, so the estimate is unbounded.</p> : <p className="mt-1 leading-relaxed">{formatCurrency(analytics.runway.liquidAssets)} cash ÷ {formatCurrency(analytics.runway.grossBurnRate)} average monthly burn = {analytics.runway.runwayMonths?.toLocaleString('en-US', { maximumFractionDigits: 1 })} months.</p>}<p className="mt-2 text-[var(--ref-on-surface-variant)]">Based on recorded operating expenses over the last three months.</p></div></div>}</div><p className="mt-4 text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">Cash runway</p><p className="mt-2 font-headline text-3xl font-extrabold tracking-tight text-[var(--ref-on-surface)]">{analytics?.runway.isUnbounded ? 'No observed burn' : analytics?.runway.runwayMonths != null ? `${analytics.runway.runwayMonths.toLocaleString('en-US', { maximumFractionDigits: 1 })} months` : '—'}</p>{analytics?.runway && <p className="mt-3 text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">{analytics.runway.isUnbounded ? `${formatCurrency(analytics.runway.liquidAssets)} available · no recorded burn` : 'Covers spending at current burn.'}</p>}</article>
          <article className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 shadow-sm"><CircleDollarSign className="h-5 w-5 text-[var(--ref-primary)]" /><p className="mt-4 text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">Period cash flow</p><p className={cn('mt-2 font-headline text-3xl font-extrabold tracking-tight', periodNet == null ? 'text-[var(--ref-on-surface)]' : periodNet >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]')}>{periodNet == null ? 'Not tracked' : `${periodNet >= 0 ? '+' : ''}${formatCurrency(periodNet)}`}</p><p className="mt-3 text-xs text-[var(--ref-on-surface-variant)]">{periodIsTracked ? `Income ${formatCurrency(periodIncome)} · Spending ${formatCurrency(periodExpense)}` : 'Coverage is incomplete; recorded totals are not comparable.'}</p></article>
        </section>

        <section className="mt-6 grid grid-cols-1 items-stretch gap-5 xl:grid-cols-3"><div className="h-full xl:col-span-2"><NetWorthChart /></div><div className="flex h-full flex-col gap-5"><SpendingTrendChart periodId={selectedPeriod?.id ?? null} /><aside className="relative self-start overflow-hidden rounded-3xl bg-[var(--ref-secondary-container)] p-5 text-[var(--ref-on-secondary-container)]"><div className="relative flex flex-col gap-4"><div className="min-w-0"><div className="flex items-center gap-3"><AgentOrbActions state={agentPrompt.trim() ? 'ready' : 'idle'} onPrompt={(prompt) => { setAgentPrompt(prompt); requestAnimationFrame(() => document.getElementById('dashboard-agent-prompt')?.focus()); }} /><p className="text-xs font-bold uppercase tracking-widest opacity-70">Ask Fainens</p></div><h2 className="mt-1 font-headline text-2xl font-extrabold">What do you want to understand?</h2><p className="mt-2 text-sm leading-relaxed opacity-90">Ask about spending, balances, obligations, or a purchase decision.</p></div><form className="relative min-w-0" onSubmit={(event) => { event.preventDefault(); openAgent(); }}><label htmlFor="dashboard-agent-prompt" className="sr-only">Ask Fainens a question</label><div className="flex gap-2"><input id="dashboard-agent-prompt" value={agentPrompt} onChange={(event) => setAgentPrompt(event.target.value)} placeholder="e.g. Where did most of my money go?" className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white/80 px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-black/20" /><button type="submit" disabled={agentPrompt.trim().length < 2} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[var(--ref-on-secondary-container)] px-3 py-2.5 text-sm font-bold text-[var(--ref-secondary-container)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"><Send className="h-4 w-4" /><span className="sr-only sm:not-sr-only">Ask</span></button></div><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setAgentPrompt('What were my top 10 expenses recently?')} className="rounded-full bg-black/10 px-3 py-1.5 text-xs font-semibold hover:bg-black/15">Top expenses</button><button type="button" onClick={() => setAgentPrompt('How is my budget tracking this period?')} className="rounded-full bg-black/10 px-3 py-1.5 text-xs font-semibold hover:bg-black/15">Budget pace</button><button type="button" onClick={() => setAgentPrompt('What bills and obligations are coming up?')} className="rounded-full bg-black/10 px-3 py-1.5 text-xs font-semibold hover:bg-black/15">Upcoming bills</button></div></form></div></aside></div></section>

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
