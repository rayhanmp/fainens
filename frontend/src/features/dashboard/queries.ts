import { useQuery } from '@tanstack/react-query';
import {
  getBudgetOutlook,
  getDashboardAnalytics,
  getPaylaterObligations,
  listBudgets,
  listLoans,
  listReconciliation,
  listSubscriptions,
  listTransactions,
} from '../../generated/client';
import { queryKeys } from '../core/query-keys';
import { api } from '../../lib/api';
import { normalizeTimestamp, unwrapGenerated } from '../core/generated-response';

export const useDashboardQuery = () => useQuery({
  queryKey: queryKeys.dashboard.analytics,
  queryFn: async ({ signal }) => {
    const response = await getDashboardAnalytics({ signal });
    if (response.status !== 200) throw new Error('Failed to load dashboard analytics');
    return response.data;
  },
});

export function useDashboardOverviewQuery() {
  return useQuery({
    queryKey: queryKeys.dashboard.analytics,
    queryFn: () => unwrapGenerated(getDashboardAnalytics(), 200, 'Failed to load dashboard analytics'),
    placeholderData: (previous) => previous,
  });
}

export function useDashboardReconciliationQuery(limit = 1) {
  return useQuery({
    queryKey: [...queryKeys.dashboard.reconciliation, limit] as const,
    queryFn: () => unwrapGenerated(listReconciliation({ limit: String(limit) }), 200, 'Failed to load reconciliation history'),
    placeholderData: (previous) => previous,
  });
}

export function useDashboardLoansQuery() {
  return useQuery({
    queryKey: queryKeys.dashboard.loans,
    queryFn: () => unwrapGenerated(listLoans(), 200, 'Failed to load loans'),
    placeholderData: (previous) => previous,
  });
}

export function useDashboardPayLaterQuery() {
  return useQuery({
    queryKey: queryKeys.dashboard.paylater,
    queryFn: () => unwrapGenerated(getPaylaterObligations(), 200, 'Failed to load PayLater obligations'),
    placeholderData: (previous) => previous,
  });
}

export function useDashboardSubscriptionsQuery() {
  return useQuery({
    queryKey: queryKeys.dashboard.subscriptions,
    queryFn: () => unwrapGenerated(listSubscriptions(), 200, 'Failed to load subscriptions'),
    placeholderData: (previous) => previous,
  });
}

export function useDashboardPeriodQueries(periodId: number | null) {
  const enabled = periodId != null;
  const periodKey = periodId ?? 0;
  const facts = useQuery({
    queryKey: [...queryKeys.dashboard.period(periodKey), 'facts'] as const,
    queryFn: ({ signal }) => api.agent.financialFacts({ periodId: periodId! }, { signal }),
    enabled,
    placeholderData: (previous) => previous,
  });
  const budget = useQuery({
    queryKey: [...queryKeys.dashboard.period(periodKey), 'budget'] as const,
    queryFn: () => unwrapGenerated(listBudgets({ periodId: String(periodId!) }), 200, 'Failed to load period budget'),
    enabled,
    placeholderData: (previous) => previous,
  });
  const recent = useQuery({
    queryKey: [...queryKeys.dashboard.period(periodKey), 'recent'] as const,
    queryFn: async () => {
      const payload = await unwrapGenerated(listTransactions({ periodId: String(periodId!), limit: '12' }), 200, 'Failed to load recent activity');
      return { ...payload, data: payload.data.map((transaction) => ({
        ...transaction,
        date: normalizeTimestamp(transaction.date),
        ...(transaction.dueDate == null ? {} : { dueDate: normalizeTimestamp(transaction.dueDate) }),
        ...(transaction.createdAt == null ? {} : { createdAt: normalizeTimestamp(transaction.createdAt) }),
      })) };
    },
    enabled,
    placeholderData: (previous) => previous,
  });
  const outlook = useQuery({
    queryKey: [...queryKeys.dashboard.period(periodKey), 'outlook'] as const,
    queryFn: () => unwrapGenerated(getBudgetOutlook(periodId!), 200, 'Failed to load budget outlook'),
    enabled,
    placeholderData: (previous) => previous,
  });
  return { facts, budget, recent, outlook };
}
