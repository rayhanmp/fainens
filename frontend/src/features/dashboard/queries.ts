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
import { useFinancialFactsQuery } from '../agent/queries';
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
    queryFn: ({ signal }) => unwrapGenerated(getDashboardAnalytics({ signal }), 200, 'Failed to load dashboard analytics'),
    placeholderData: (previous) => previous,
  });
}

export function useDashboardReconciliationQuery(limit = 1) {
  return useQuery({
    queryKey: [...queryKeys.dashboard.reconciliation, limit] as const,
    queryFn: ({ signal }) => unwrapGenerated(listReconciliation({ limit: String(limit) }, { signal }), 200, 'Failed to load reconciliation history'),
    placeholderData: (previous) => previous,
  });
}

export function useDashboardLoansQuery() {
  return useQuery({
    queryKey: queryKeys.dashboard.loans,
    queryFn: ({ signal }) => unwrapGenerated(listLoans(undefined, { signal }), 200, 'Failed to load loans'),
    placeholderData: (previous) => previous,
  });
}

export function useDashboardPayLaterQuery() {
  return useQuery({
    queryKey: queryKeys.dashboard.paylater,
    queryFn: ({ signal }) => unwrapGenerated(getPaylaterObligations({ signal }), 200, 'Failed to load PayLater obligations'),
    placeholderData: (previous) => previous,
  });
}

export function useDashboardSubscriptionsQuery() {
  return useQuery({
    queryKey: queryKeys.dashboard.subscriptions,
    queryFn: ({ signal }) => unwrapGenerated(listSubscriptions({ signal }), 200, 'Failed to load subscriptions'),
    placeholderData: (previous) => previous,
  });
}

export function useDashboardPeriodQueries(periodId: number | null) {
  const enabled = periodId != null;
  const periodKey = periodId ?? 0;
  const facts = useFinancialFactsQuery({ periodId: periodId ?? undefined }, enabled);
  const budget = useQuery({
    queryKey: [...queryKeys.dashboard.period(periodKey), 'budget'] as const,
    queryFn: ({ signal }) => unwrapGenerated(listBudgets({ periodId: String(periodId!) }, { signal }), 200, 'Failed to load period budget'),
    enabled,
    placeholderData: (previous) => previous,
  });
  const recent = useQuery({
    queryKey: [...queryKeys.dashboard.period(periodKey), 'recent'] as const,
    queryFn: async ({ signal }) => {
      const payload = await unwrapGenerated(listTransactions({ periodId: String(periodId!), limit: '12' }, { signal }), 200, 'Failed to load recent activity');
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
    queryFn: ({ signal }) => unwrapGenerated(getBudgetOutlook(periodId!, { signal }), 200, 'Failed to load budget outlook'),
    enabled,
    placeholderData: (previous) => previous,
  });
  return { facts, budget, recent, outlook };
}
