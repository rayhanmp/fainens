import { useQuery } from '@tanstack/react-query';
import { listPeriods } from '../../generated/client';
import { queryKeys } from '../core/query-keys';
import { api } from '../../lib/api';

export const usePeriodsQuery = () => useQuery({
  queryKey: queryKeys.periods.all,
  queryFn: async ({ signal }) => (await listPeriods({ signal })).data,
});

export function usePeriodsLedgerQuery(includeInactive = false) {
  return useQuery({
    queryKey: [...queryKeys.periods.all, { includeInactive }] as const,
    queryFn: () => api.periods.list(includeInactive ? { includeInactive: true } : undefined),
    placeholderData: (previous) => previous,
  });
}

export function usePeriodDetailQuery(periodId: number | null) {
  return useQuery({
    queryKey: queryKeys.periods.detail(periodId ?? 0),
    queryFn: () => api.periods.get(periodId!),
    enabled: periodId != null,
    placeholderData: (previous) => previous,
  });
}

export function useSuggestedPeriodQuery() {
  return useQuery({
    queryKey: [...queryKeys.periods.all, 'suggested'] as const,
    queryFn: () => api.periods.suggestNext(),
    placeholderData: (previous) => previous,
  });
}
