import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listPeriods } from '../../generated/client';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';
import { api } from '../../lib/api';

export const usePeriodsQuery = () => useQuery({
  queryKey: queryKeys.periods.all,
  queryFn: async ({ signal }) => {
    const response = await listPeriods(undefined, { signal });
    if (response.status !== 200) throw new Error('Failed to load periods');
    return response.data;
  },
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

export function useReturnPreviewQuery(asOfDate: number | null) {
  return useQuery({
    queryKey: [...queryKeys.periods.all, 'return-preview', asOfDate ?? 0] as const,
    queryFn: () => api.periods.returnPreview(asOfDate!),
    enabled: asOfDate != null,
  });
}

export function useCreatePeriodMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.periods.create>[0]) => api.periods.create(input),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useUpdatePeriodMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof api.periods.update>[1] }) => api.periods.update(id, data),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useAutoCreatePeriodMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.periods.autoCreate(),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useClosePeriodMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.periods.close(id),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useReopenPeriodMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.periods.reopen(id),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useArchivePeriodMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.periods.archive(id),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useRestorePeriodMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.periods.restore(id),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useReturnBackfillMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ asOfDate, currentPeriodCoverage }: { asOfDate: number; currentPeriodCoverage: 'partial' | 'complete' }) => api.periods.createReturnBackfill(asOfDate, currentPeriodCoverage),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useSetPeriodCoverageMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof api.periods.setCoverage>[1] }) => api.periods.setCoverage(id, data),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}
