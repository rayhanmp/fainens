import { useMemo } from 'react';
import type { AgentFinancialFacts, BudgetPlan, BudgetSummary, api } from '../../lib/api';
import { findCurrentPeriod, formatCurrency, formatDayMonth } from '../../lib/utils';
import { usePeriodsQuery } from '../periods/queries';
import { usePendingTransactionsQuery } from '../transactions/queries';
import { useGoalsQuery } from '../goals/queries';
import { useGoalDueTasksQuery } from '../goals/notes/queries';
import { useGoalRemindersQuery } from '../goals/trip/queries';
import { useAverageSpending } from '../goals/use-headline';
import {
  useDashboardLoansQuery,
  useDashboardOverviewQuery,
  useDashboardPayLaterQuery,
  useDashboardPeriodQueries,
  useDashboardReconciliationQuery,
  useDashboardSubscriptionsQuery,
} from './queries';
import { buildAttentionItems, goalReminders, type Attention } from './attention';
import { upcomingCommitments } from './commitments';

type Period = Awaited<ReturnType<typeof api.periods.list>>[number];
type DashboardAnalytics = Awaited<ReturnType<typeof api.analytics.dashboard>>;
type Facts = AgentFinancialFacts['data'];
type ReconciliationHistory = Awaited<ReturnType<typeof api.accounts.reconciliationHistory>>;
type Loan = Awaited<ReturnType<typeof api.loans.list>>[number];
type PayLaterObligations = Awaited<ReturnType<typeof api.paylater.obligations>>;
type SubscriptionData = Awaited<ReturnType<typeof api.subscriptions.list>>;

export function budgetPlansFromPayload(payload: BudgetSummary | BudgetSummary[] | undefined): BudgetPlan[] {
  const summary = Array.isArray(payload) ? payload[0] : payload;
  return Array.isArray(summary?.plans) ? summary.plans : [];
}

/**
 * What the bell says needs attention, worked out the same way wherever it's asked: the Dashboard
 * shows it, and every other page counts it for the badge in the navigation. Notifications always
 * describe the current period, whichever period is being browsed. The queries are shared, so the
 * Dashboard asks for nothing twice.
 */
export function useAttentionItems(now: number): Attention[] {
  const periodsQuery = usePeriodsQuery();
  const analyticsQuery = useDashboardOverviewQuery();
  const reconciliationQuery = useDashboardReconciliationQuery(1);
  const loansQuery = useDashboardLoansQuery();
  const paylaterQuery = useDashboardPayLaterQuery();
  const subscriptionsQuery = useDashboardSubscriptionsQuery();
  const pendingTransactionsQuery = usePendingTransactionsQuery();
  const goalsQuery = useGoalsQuery();
  const goalTasksQuery = useGoalDueTasksQuery();
  const goalRemindersQuery = useGoalRemindersQuery();
  const averageSpending = useAverageSpending();

  const periods = useMemo(() => (periodsQuery.data ?? []) as Period[], [periodsQuery.data]);
  const currentPeriod = useMemo(() => findCurrentPeriod(periods, now) ?? null, [periods, now]);
  const currentPeriodQueries = useDashboardPeriodQueries(currentPeriod?.id ?? null);
  const currentFacts = (currentPeriodQueries.facts.data?.data ?? null) as Facts | null;
  const currentBudgetRows = useMemo(() => budgetPlansFromPayload(currentPeriodQueries.budget.data as BudgetSummary | BudgetSummary[] | undefined), [currentPeriodQueries.budget.data]);
  const currentOutlook = currentPeriodQueries.outlook.data?.periodId === currentPeriod?.id ? currentPeriodQueries.outlook.data ?? null : null;

  const analytics = (analyticsQuery.data ?? null) as DashboardAnalytics | null;
  const reconciliation = (reconciliationQuery.data ?? null) as ReconciliationHistory | null;
  const loans = useMemo(() => (loansQuery.data ?? []) as Loan[], [loansQuery.data]);
  const paylater = (paylaterQuery.data ?? null) as PayLaterObligations | null;
  const subscriptions = (subscriptionsQuery.data ?? null) as SubscriptionData | null;
  const pendingTransactionCount = pendingTransactionsQuery.data?.length ?? 0;
  const commitments = useMemo(() => upcomingCommitments({
    subscriptions: subscriptions?.subscriptions ?? [],
    payLater: paylater?.obligations ?? [],
    loans,
  }, now), [now, loans, paylater, subscriptions]);

  return useMemo(() => buildAttentionItems({
    now,
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
    goals: goalsQuery.data ? { ...goalReminders(goalsQuery.data, now, averageSpending), tasks: goalTasksQuery.data ?? [], kinds: goalRemindersQuery.data ?? [] } : null,
  }, { amount: formatCurrency, date: formatDayMonth }), [analytics, averageSpending, commitments, currentBudgetRows, currentFacts, currentOutlook, currentPeriod, now, goalsQuery.data, goalTasksQuery.data, goalRemindersQuery.data, loans, paylater, pendingTransactionCount, reconciliation, subscriptions]);
}
