import { useQuery } from '@tanstack/react-query';
import { getDashboardAnalytics } from '../../generated/client';
import { queryKeys } from '../core/query-keys';
import { api } from '../../lib/api';

export const useDashboardQuery = () => useQuery({
  queryKey: queryKeys.dashboard.analytics,
  queryFn: async ({ signal }) => (await getDashboardAnalytics({ signal })).data,
});

export function useDashboardOverviewQuery() {
  return useQuery({
    queryKey: queryKeys.dashboard.analytics,
    queryFn: () => api.analytics.dashboard(),
    placeholderData: (previous) => previous,
  });
}

export function useDashboardReconciliationQuery(limit = 1) {
  return useQuery({
    queryKey: [...queryKeys.dashboard.reconciliation, limit] as const,
    queryFn: () => api.accounts.reconciliationHistory(limit),
    placeholderData: (previous) => previous,
  });
}

export function useDashboardLoansQuery() {
  return useQuery({
    queryKey: queryKeys.dashboard.loans,
    queryFn: () => api.loans.list(),
    placeholderData: (previous) => previous,
  });
}

export function useDashboardPayLaterQuery() {
  return useQuery({
    queryKey: queryKeys.dashboard.paylater,
    queryFn: () => api.paylater.obligations(),
    placeholderData: (previous) => previous,
  });
}

export function useDashboardSubscriptionsQuery() {
  return useQuery({
    queryKey: queryKeys.dashboard.subscriptions,
    queryFn: () => api.subscriptions.list(),
    placeholderData: (previous) => previous,
  });
}

export function useDashboardPeriodQueries(periodId: number | null) {
  const enabled = periodId != null;
  const periodKey = periodId ?? 0;
  const facts = useQuery({
    queryKey: [...queryKeys.dashboard.period(periodKey), 'facts'] as const,
    queryFn: () => api.agent.financialFacts({ periodId: periodId! }),
    enabled,
    placeholderData: (previous) => previous,
  });
  const budget = useQuery({
    queryKey: [...queryKeys.dashboard.period(periodKey), 'budget'] as const,
    queryFn: () => api.budgets.list(String(periodId!)),
    enabled,
    placeholderData: (previous) => previous,
  });
  const recent = useQuery({
    queryKey: [...queryKeys.dashboard.period(periodKey), 'recent'] as const,
    queryFn: () => api.transactions.list({ periodId: String(periodId!), limit: '12' }),
    enabled,
    placeholderData: (previous) => previous,
  });
  const outlook = useQuery({
    queryKey: [...queryKeys.dashboard.period(periodKey), 'outlook'] as const,
    queryFn: () => api.budgets.outlook(periodId!),
    enabled,
    placeholderData: (previous) => previous,
  });
  return { facts, budget, recent, outlook };
}
