import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Landmark,
  Plus,
  ReceiptText,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { PageHeader } from '../components/ui/PageHeader';
import { PageContainer } from '../components/ui/PageContainer';
import { RequireAuth } from '../lib/auth';
import { api, type AgentFinancialFacts, type BudgetPlan, type BudgetSummary } from '../lib/api';
import { fetchOnboardingStatus } from '../lib/onboarding-status';
import { cn, formatCurrency, formatDate } from '../lib/utils';
import { NetWorthChart } from '../components/analytics';
import { TransactionModal } from '../components/transactions/TransactionModal';
import { MonthlyReportModal } from '../components/pdf/MonthlyReportModal';

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
type RecentTransaction = Awaited<ReturnType<typeof api.transactions.list>>['data'][number];
type BudgetRow = BudgetPlan;
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
  if (tx.expenseCents > 0 && tx.incomeCents <= 0) return 'expense';
  if (tx.incomeCents > 0 && tx.expenseCents <= 0) return 'income';
  return 'neutral';
}

function transactionAmount(tx: RecentTransaction): number {
  if (tx.expenseCents !== 0) return Math.abs(tx.expenseCents);
  if (tx.incomeCents !== 0) return Math.abs(tx.incomeCents);
  return Math.max(tx.debitCents, tx.creditCents);
}

function coverageLabel(status: Period['coverageStatus'] | undefined): string {
  if (status === 'complete') return 'Complete coverage';
  if (status === 'partial') return 'Partially captured';
  if (status === 'skipped') return 'Skipped period';
  return 'Coverage needs review';
}

function coverageTone(status: Period['coverageStatus'] | undefined): string {
  if (status === 'complete') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'partial') return 'bg-amber-500/10 text-amber-800 dark:text-amber-200';
  return 'bg-rose-500/10 text-rose-800 dark:text-rose-200';
}

function formatAsOf(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function budgetPlansFromPayload(payload: BudgetSummary | BudgetSummary[]): BudgetPlan[] {
  const summary = Array.isArray(payload) ? payload[0] : payload;
  return Array.isArray(summary?.plans) ? summary.plans : [];
}

function DashboardPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [reconciliation, setReconciliation] = useState<ReconciliationHistory | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [paylater, setPaylater] = useState<PayLaterObligations | null>(null);
  const [subscriptions, setSubscriptions] = useState<SubscriptionData | null>(null);
  const [facts, setFacts] = useState<Facts | null>(null);
  const [budgetRows, setBudgetRows] = useState<BudgetRow[]>([]);
  const [recent, setRecent] = useState<RecentTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPeriodLoading, setIsPeriodLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isTransactionOpen, setIsTransactionOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    void (async () => {
      try {
        const [periodList, accountList, categoryList, tagList, dashboard, reconciliationHistory, activeLoans, obligations, subscriptionData] = await Promise.all([
          api.periods.list(),
          api.accounts.list(),
          api.categories.list(),
          api.tags.list(),
          api.analytics.dashboard(),
          api.accounts.reconciliationHistory(1),
          api.loans.list(),
          api.paylater.obligations(),
          api.subscriptions.list(),
        ]);
        if (cancelled) return;
        setPeriods(periodList);
        setAccounts(accountList);
        setCategories(categoryList);
        setTags(tagList);
        setAnalytics(dashboard);
        setReconciliation(reconciliationHistory);
        setLoans(activeLoans);
        setPaylater(obligations);
        setSubscriptions(subscriptionData);
        setSelectedPeriodId((current) => {
          if (current && periodList.some((period) => String(period.id) === current)) return current;
          const now = Date.now();
          const currentPeriod = periodList.find((period) => period.startDate <= now && now <= period.endDate + DAY_MS - 1);
          return String((currentPeriod ?? periodList[0])?.id ?? '');
        });
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not load the financial overview.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const selectedPeriod = useMemo(
    () => periods.find((period) => String(period.id) === selectedPeriodId) ?? null,
    [periods, selectedPeriodId],
  );

  useEffect(() => {
    if (!selectedPeriod) return;
    let cancelled = false;
    setIsPeriodLoading(true);
    void (async () => {
      try {
        const [financialFacts, budgets, recentResult] = await Promise.all([
          api.agent.financialFacts({ periodId: selectedPeriod.id }),
          api.budgets.list(String(selectedPeriod.id)),
          api.transactions.list({ periodId: String(selectedPeriod.id), limit: '8' }),
        ]);
        if (cancelled) return;
        setFacts(financialFacts.data);
        setBudgetRows(budgetPlansFromPayload(budgets));
        setRecent(recentResult.data);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not load selected-period data.');
      } finally {
        if (!cancelled) setIsPeriodLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedPeriod]);

  const periodTiming = useMemo(() => {
    if (!selectedPeriod) return null;
    const totalDays = Math.max(1, Math.round((selectedPeriod.endDate - selectedPeriod.startDate) / DAY_MS) + 1);
    const now = Date.now();
    const elapsed = now < selectedPeriod.startDate
      ? 0
      : now > selectedPeriod.endDate + DAY_MS - 1
        ? totalDays
        : Math.min(totalDays, Math.floor((now - selectedPeriod.startDate) / DAY_MS) + 1);
    return { totalDays, daysElapsed: elapsed, daysRemaining: Math.max(0, totalDays - elapsed) };
  }, [selectedPeriod]);

  const budgetSummary = useMemo(() => {
    const totalPlanned = budgetRows.reduce((sum, row) => sum + row.plannedAmount, 0);
    const totalActual = budgetRows.reduce((sum, row) => sum + row.actualAmount, 0);
    const remaining = totalPlanned - totalActual;
    return {
      totalPlanned,
      remaining,
      dailyRoom: periodTiming && periodTiming.daysRemaining > 0 && totalPlanned > 0
        ? Math.max(0, remaining / periodTiming.daysRemaining)
        : null,
    };
  }, [budgetRows, periodTiming]);

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
    const riskyBudget = budgetRows.find((row) => row.percentUsed >= 100);
    const projectedBudget = !riskyBudget && periodTiming && periodTiming.daysElapsed > 0
      ? budgetRows.find((row) => Math.round(row.actualAmount / periodTiming.daysElapsed * periodTiming.totalDays) > row.plannedAmount)
      : undefined;
    if (riskyBudget || projectedBudget) {
      const row = riskyBudget ?? projectedBudget!;
      next.push({ id: 'budget', tone: riskyBudget ? 'danger' : 'warning', title: riskyBudget ? `${row.categoryName} is over budget` : `${row.categoryName} may exceed its budget`, detail: riskyBudget ? `${formatCurrency(row.actualAmount)} spent against ${formatCurrency(row.plannedAmount)} planned.` : 'Current pace projects an overrun before the period ends.', to: '/budget', action: 'Review budget' });
    }
    const unallocated = facts?.facts.byCategory.find((row) => row.categoryId == null && row.spentCents > 0);
    if (unallocated) {
      next.push({ id: 'unallocated', tone: 'info', title: 'Some spending is unallocated', detail: `${formatCurrency(unallocated.spentCents)} cannot yet be attributed to a category.`, to: '/transactions', action: 'Classify activity' });
    }
    const priority = { danger: 0, warning: 1, info: 2 } as const;
    return next.sort((a, b) => priority[a.tone] - priority[b.tone]).slice(0, 5);
  }, [analytics, budgetRows, facts, loans, paylater, periodTiming, reconciliation, selectedPeriod, subscriptions]);

  const planRows = useMemo(() => {
    if (budgetRows.length > 0) {
      return [...budgetRows]
        .sort((a, b) => Math.max(b.percentUsed, b.actualAmount / Math.max(1, b.plannedAmount) * 100) - Math.max(a.percentUsed, a.actualAmount / Math.max(1, a.plannedAmount) * 100))
        .slice(0, 5)
        .map((row) => ({ name: row.categoryName, actual: row.actualAmount, planned: row.plannedAmount }));
    }
    return (facts?.facts.byCategory ?? []).filter((row) => row.spentCents > 0).slice(0, 5)
      .map((row) => ({ name: row.category, actual: row.spentCents, planned: 0 }));
  }, [budgetRows, facts]);

  const coverageWarnings = facts?.coverage.warnings ?? [];
  const periodIncome = facts?.facts.totalIncomeCents ?? 0;
  const periodExpense = facts?.facts.totalSpentCents ?? 0;
  const periodNet = periodIncome - periodExpense;
  const selectedPeriodAsOf = facts?.facts.asOfMs ?? Date.now();

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
            <button type="button" onClick={() => setIsReportOpen(true)} className="rounded-full border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-4 py-2.5 text-xs font-bold text-[var(--ref-primary)] transition-colors hover:bg-[var(--ref-surface-container-low)]">Export report</button>
            <Button className="rounded-full" onClick={() => setIsTransactionOpen(true)}><Plus className="mr-2 h-4 w-4" />Add transaction</Button>
          </div>
        </div>

        {loadError && <div className="mt-5 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{loadError}</div>}
        {selectedPeriod && <div className="mt-5 flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-1.5 font-semibold text-[var(--ref-on-surface-variant)]">Period facts through {formatAsOf(selectedPeriodAsOf)}</span><span className={cn('rounded-full px-3 py-1.5 font-semibold', coverageTone(selectedPeriod.coverageStatus))}>{coverageLabel(selectedPeriod.coverageStatus)}</span><span className="rounded-full border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-1.5 font-semibold text-[var(--ref-on-surface-variant)]">Position cards are current balances</span></div>}
        {coverageWarnings.length > 0 && <Link to="/periods" className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><span><strong>Read this period carefully.</strong> {coverageWarnings[0]} <span className="ml-1 font-semibold underline">Review coverage</span></span></Link>}

        <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <article className="relative overflow-hidden rounded-3xl bg-[var(--ref-primary-container)] p-6 text-[var(--ref-on-primary-container)]"><Wallet className="absolute -bottom-3 -right-2 h-28 w-28 opacity-10" /><p className="text-xs font-bold uppercase tracking-widest opacity-75">Available cash</p><p className="mt-3 font-headline text-3xl font-extrabold tracking-tight">{analytics ? formatCurrency(analytics.netWorth.liquidAssets) : '—'}</p><p className="mt-4 text-xs opacity-85">Cash-equivalent assets only · current balance</p></article>
          <article className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 shadow-sm"><Landmark className="h-5 w-5 text-[var(--ref-primary)]" /><p className="mt-4 text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">Net worth</p><p className="mt-2 font-headline text-3xl font-extrabold tracking-tight text-[var(--ref-on-surface)]">{analytics ? formatCurrency(analytics.netWorth.netWorth) : '—'}</p><p className="mt-3 text-xs text-[var(--ref-on-surface-variant)]">Assets {analytics ? formatCurrency(analytics.netWorth.totalAssets) : '—'} · liabilities {analytics ? formatCurrency(analytics.netWorth.totalLiabilities) : '—'}</p></article>
          <article className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 shadow-sm"><CalendarClock className="h-5 w-5 text-[var(--ref-primary)]" /><p className="mt-4 text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">Cash runway</p><p className="mt-2 font-headline text-3xl font-extrabold tracking-tight text-[var(--ref-on-surface)]">{analytics?.runway.isUnbounded ? 'No observed burn' : analytics?.runway.runwayMonths != null ? `${analytics.runway.runwayMonths} months` : '—'}</p>{analytics?.runway && <p className="mt-3 text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">{analytics.runway.isUnbounded ? `${formatCurrency(analytics.runway.liquidAssets)} cash available · no recorded monthly spending` : `${formatCurrency(analytics.runway.liquidAssets)} cash ÷ ${formatCurrency(analytics.runway.grossBurnRate)} monthly burn`}</p>}</article>
          <article className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 shadow-sm"><CircleDollarSign className="h-5 w-5 text-[var(--ref-primary)]" /><p className="mt-4 text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">Period cash flow</p><p className={cn('mt-2 font-headline text-3xl font-extrabold tracking-tight', periodNet >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]')}>{periodNet >= 0 ? '+' : ''}{formatCurrency(periodNet)}</p><p className="mt-3 text-xs text-[var(--ref-on-surface-variant)]">Income {formatCurrency(periodIncome)} · spending {formatCurrency(periodExpense)}</p></article>
        </section>

        <section className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-5 shadow-sm xl:col-span-2"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">Attention required</p><h2 className="mt-1 font-headline text-xl font-extrabold text-[var(--ref-on-surface)]">What deserves a decision</h2></div><span className="rounded-full bg-[var(--ref-surface-container-high)] px-3 py-1.5 text-xs font-bold text-[var(--ref-on-surface-variant)]">{attentionItems.length} item{attentionItems.length === 1 ? '' : 's'}</span></div><div className="mt-4 grid gap-2 md:grid-cols-2">{attentionItems.length === 0 ? <div className="flex items-center gap-3 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200 md:col-span-2"><CheckCircle2 className="h-5 w-5 shrink-0" />No immediate issues surfaced from your recorded data.</div> : attentionItems.map((item) => <Link key={item.id} to={item.to} className="group flex min-w-0 items-center gap-3 rounded-xl border border-[var(--color-border)] p-3 transition-colors hover:bg-[var(--ref-surface-container-low)]"><div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', item.tone === 'danger' ? 'bg-rose-500/10 text-rose-600' : item.tone === 'warning' ? 'bg-amber-500/10 text-amber-600' : 'bg-sky-500/10 text-sky-600')}><AlertTriangle className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-[var(--ref-on-surface)]">{item.title}</p><p className="mt-0.5 line-clamp-2 text-xs text-[var(--ref-on-surface-variant)]">{item.detail}</p></div><span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-[var(--ref-primary)]">{item.action}<ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></span></Link>)}</div></div>
          <aside className="relative overflow-hidden rounded-3xl bg-[var(--ref-secondary-container)] p-6 text-[var(--ref-on-secondary-container)]"><Bot className="absolute -bottom-6 -right-4 h-32 w-32 opacity-10" /><p className="text-xs font-bold uppercase tracking-widest opacity-70">Ask Fainens</p><h2 className="mt-2 font-headline text-2xl font-extrabold">Turn numbers into a next move.</h2><p className="mt-3 text-sm leading-relaxed opacity-90">Ask about spending patterns, upcoming obligations, a purchase decision, or prepare a transaction for approval.</p><div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold"><span className="rounded-full bg-black/10 px-3 py-1.5">Why is spending up?</span><span className="rounded-full bg-black/10 px-3 py-1.5">Can I afford this?</span><span className="rounded-full bg-black/10 px-3 py-1.5">Plan next period</span></div><Link to="/agent" className="relative mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--ref-on-secondary-container)] px-4 py-2.5 text-sm font-bold text-[var(--ref-secondary-container)] transition-transform hover:-translate-y-0.5">Open financial chat <ArrowRight className="h-4 w-4" /></Link></aside>
        </section>

        <section className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 shadow-sm xl:col-span-2"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">Plan versus actual</p><h2 className="mt-1 font-headline text-xl font-extrabold text-[var(--ref-on-surface)]">Spending pace by category</h2></div>{budgetSummary.totalPlanned > 0 ? <div className="text-left sm:text-right"><p className="text-sm font-bold text-[var(--ref-on-surface)]">{formatCurrency(budgetSummary.remaining)} left</p><p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">{budgetSummary.dailyRoom != null ? `${formatCurrency(budgetSummary.dailyRoom)} daily room` : 'Period is complete'}</p></div> : <Link to="/budget" className="text-sm font-bold text-[var(--ref-primary)] hover:underline">Set a budget</Link>}</div>{isPeriodLoading ? <div className="mt-6 h-56 animate-pulse rounded-2xl bg-[var(--ref-surface-container-highest)]" /> : planRows.length === 0 ? <div className="mt-6 rounded-2xl bg-[var(--ref-surface-container-low)] p-6 text-sm text-[var(--ref-on-surface-variant)]">No categorized spending for this period yet. Add transactions or set a budget to start planning.</div> : <div className="mt-6 space-y-5">{planRows.map((row) => { const ratio = row.planned > 0 ? row.actual / row.planned : 0; const projection = periodTiming && periodTiming.daysElapsed > 0 ? Math.round(row.actual / periodTiming.daysElapsed * periodTiming.totalDays) : row.actual; const isAtRisk = row.planned > 0 && (ratio >= 1 || projection > row.planned); return <div key={row.name}><div className="flex items-end justify-between gap-3"><div><p className="font-bold text-[var(--ref-on-surface)]">{row.name}</p><p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">{row.planned > 0 ? `${formatCurrency(row.actual)} of ${formatCurrency(row.planned)}` : `${formatCurrency(row.actual)} recorded`}</p></div><p className={cn('text-sm font-bold', isAtRisk ? 'text-[var(--color-danger)]' : 'text-[var(--ref-primary)]')}>{row.planned > 0 ? `${Math.round(ratio * 100)}%` : formatCurrency(row.actual)}</p></div><div className="mt-2 h-3 overflow-hidden rounded-full bg-[var(--ref-surface-container-highest)]"><div className={cn('h-full rounded-full', isAtRisk ? 'bg-[var(--color-danger)]' : 'bg-[var(--ref-primary)]')} style={{ width: `${Math.min(100, row.planned > 0 ? ratio * 100 : 100)}%` }} /></div>{row.planned > 0 && periodTiming && periodTiming.daysRemaining > 0 && <p className="mt-1.5 text-[11px] text-[var(--ref-on-surface-variant)]">At this pace: {formatCurrency(projection)} projected by period end.</p>}</div>; })}</div>}<Link to="/budget" className="mt-6 inline-flex items-center gap-1 text-sm font-bold text-[var(--ref-primary)] hover:underline">Manage budget <ArrowRight className="h-4 w-4" /></Link></div>
          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-6 shadow-sm"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-[var(--ref-outline)]">Recent activity</p><h2 className="mt-1 font-headline text-xl font-extrabold text-[var(--ref-on-surface)]">Latest recorded</h2></div><ReceiptText className="h-5 w-5 text-[var(--ref-primary)]" /></div><div className="mt-5 divide-y divide-[var(--color-border)]">{recent.length === 0 ? <p className="py-6 text-sm text-[var(--ref-on-surface-variant)]">No active transactions in this period.</p> : recent.map((tx) => { const kind = classifyTx(tx); const category = tx.categoryId == null ? null : categories.find((item) => item.id === tx.categoryId); return <div key={tx.id} className="py-3 first:pt-0"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold text-[var(--ref-on-surface)]">{tx.description}</p><p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">{category?.name ?? (kind === 'income' ? 'Income' : kind === 'neutral' ? 'Transfer or adjustment' : 'Unallocated')} · {formatDate(tx.date)}</p></div><p className={cn('shrink-0 font-mono text-sm font-bold', kind === 'expense' ? 'text-[var(--color-danger)]' : kind === 'income' ? 'text-[var(--color-success)]' : 'text-[var(--ref-on-surface)]')}>{kind === 'expense' ? '-' : kind === 'income' ? '+' : ''}{formatCurrency(transactionAmount(tx))}</p></div></div>; })}</div><Link to="/transactions" className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-[var(--ref-primary)] hover:underline">Open transactions <ArrowRight className="h-4 w-4" /></Link></div>
        </section>

        <section className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-3"><div className="xl:col-span-2"><NetWorthChart /></div><div className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-6"><ShieldCheck className="h-5 w-5 text-[var(--ref-primary)]" /><h2 className="mt-4 font-headline text-xl font-extrabold text-[var(--ref-on-surface)]">Data confidence</h2><div className="mt-4 space-y-3 text-sm text-[var(--ref-on-surface-variant)]"><p><strong className="text-[var(--ref-on-surface)]">Position:</strong> current posted ledger balances.</p><p><strong className="text-[var(--ref-on-surface)]">Period activity:</strong> through {formatAsOf(selectedPeriodAsOf)}.</p><p><strong className="text-[var(--ref-on-surface)]">Reconciliation:</strong> {reconciliation?.sessions.find((session) => session.lifecycleStatus === 'active') ? 'a recent balance check is on record.' : 'no current balance check is on record.'}</p></div><Link to="/accounts" className="mt-6 inline-flex items-center gap-1 text-sm font-bold text-[var(--ref-primary)] hover:underline">Review accounts <ArrowRight className="h-4 w-4" /></Link></div></section>

        <TransactionModal isOpen={isTransactionOpen} onClose={() => setIsTransactionOpen(false)} onSaved={() => { setIsTransactionOpen(false); setRefreshKey((key) => key + 1); }} accounts={accounts} categories={categories} tags={tags} editingTransaction={null} periodId={selectedPeriod?.id ?? null} />
        <MonthlyReportModal isOpen={isReportOpen} onClose={() => setIsReportOpen(false)} />
      </PageContainer>
    </RequireAuth>
  );
}
