import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../core/query-keys';

export const useBudgetQuery = (periodId?: number) => useQuery({
  queryKey: periodId == null ? queryKeys.budgets.all : queryKeys.budgets.period(periodId),
  queryFn: () => api.budgets.list(periodId == null ? undefined : String(periodId)),
  placeholderData: (previous) => previous,
});

export const useBudgetOutlookQuery = (periodId?: number) => useQuery({
  queryKey: periodId == null ? [...queryKeys.budgets.all, 'outlook'] : queryKeys.budgets.outlook(periodId),
  queryFn: () => periodId == null ? Promise.resolve(null) : api.budgets.outlook(periodId),
  enabled: periodId != null,
  placeholderData: (previous) => previous,
});

export function useBudgetPeriodsQuery() {
  return useQuery({
    queryKey: queryKeys.periods.all,
    queryFn: () => api.periods.list(),
    placeholderData: (previous) => previous,
  });
}

export function useBudgetCategoriesQuery() {
  return useQuery({
    queryKey: queryKeys.categories.all,
    queryFn: () => api.categories.list(),
    placeholderData: (previous) => previous,
  });
}

export function useBudgetComparisonQuery(periodId: number | null, comparePeriodId: number | null) {
  const enabled = periodId != null && comparePeriodId != null && periodId !== comparePeriodId;
  return useQuery({
    queryKey: queryKeys.budgets.comparison(periodId ?? 0, comparePeriodId ?? 0),
    queryFn: () => api.budgets.compare(String(periodId), String(comparePeriodId)),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useBudgetTemplatesQuery() {
  return useQuery({
    queryKey: queryKeys.budgets.templates,
    queryFn: () => api.budgets.templates.list(),
    placeholderData: (previous) => previous,
  });
}
