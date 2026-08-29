import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listMoneyAnomalyReviews, reviewMoneyAnomaly, scanMoneyAnomalies } from '../../generated/client';
import { unwrapGenerated } from '../core/generated-response';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';

export function useMoneyAnomaliesQuery(status: 'open' | 'resolved' | 'dismissed') {
  return useQuery({
    queryKey: queryKeys.anomalies.list(status),
    queryFn: () => unwrapGenerated(listMoneyAnomalyReviews({ status }), 200, 'Failed to load money anomaly reviews'),
    placeholderData: (previous) => previous,
  });
}

export function useScanMoneyAnomaliesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrapGenerated(scanMoneyAnomalies(), 200, 'Failed to scan money anomalies'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.anomalies.all }),
  });
}

export function useReviewMoneyAnomalyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, reviewNote }: { id: number; status: 'resolved' | 'dismissed'; reviewNote: string }) =>
      unwrapGenerated(reviewMoneyAnomaly(id, { status, reviewNote }), 200, 'Failed to review money anomaly'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}
