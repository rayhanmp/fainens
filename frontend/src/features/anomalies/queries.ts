import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';

export function useMoneyAnomaliesQuery(status: 'open' | 'resolved' | 'dismissed') {
  return useQuery({
    queryKey: queryKeys.anomalies.list(status),
    queryFn: () => api.anomalies.money(status),
    placeholderData: (previous) => previous,
  });
}

export function useScanMoneyAnomaliesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.anomalies.scanMoney(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.anomalies.all }),
  });
}

export function useReviewMoneyAnomalyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, reviewNote }: { id: number; status: 'resolved' | 'dismissed'; reviewNote: string }) => api.anomalies.reviewMoney(id, status, reviewNote),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}
