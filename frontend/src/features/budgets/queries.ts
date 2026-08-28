import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../core/query-keys';

export const useBudgetQuery = (periodId?: number) => useQuery({
  queryKey: periodId == null ? queryKeys.budgets.all : queryKeys.budgets.period(periodId),
  queryFn: () => api.budgets.list(periodId == null ? undefined : String(periodId)),
});

export const useBudgetOutlookQuery = (periodId?: number) => useQuery({
  queryKey: periodId == null ? [...queryKeys.budgets.all, 'outlook'] : queryKeys.budgets.outlook(periodId),
  queryFn: () => periodId == null ? Promise.resolve(null) : api.budgets.outlook(periodId),
  enabled: periodId != null,
});
