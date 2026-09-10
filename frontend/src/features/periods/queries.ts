import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  archivePeriod,
  autoCreatePeriod,
  closePeriod,
  createPeriod,
  createPeriodReturnBackfill,
  getPeriod,
  listPeriods,
  previewPeriodReturn,
  reopenPeriod,
  restorePeriod,
  setPeriodCoverage,
  suggestNextPeriod,
  updatePeriod,
  type CreatePeriod200,
  type CreatePeriod201,
} from '../../generated/client';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';
import { unwrapGenerated } from '../core/generated-response';

export const usePeriodsQuery = () => useQuery({
  queryKey: queryKeys.periods.all,
  queryFn: async ({ signal }) => {
    const response = await listPeriods(undefined, { signal });
    if (response.status !== 200) throw new Error('Failed to load periods');
    return response.data;
  },
});

/** Non-hook adapter for router loaders that run before React mounts. */
export async function fetchPeriods(includeInactive = false) {
  return unwrapGenerated(
    listPeriods(includeInactive ? { includeInactive: 'true' } : undefined),
    200,
    'Failed to load periods',
  );
}

export function usePeriodsLedgerQuery(includeInactive = false, enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.periods.all, { includeInactive }] as const,
    queryFn: ({ signal }) => unwrapGenerated(listPeriods(includeInactive ? { includeInactive: 'true' } : undefined, { signal }), 200, 'Failed to load periods'),
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function usePeriodDetailQuery(periodId: number | null) {
  return useQuery({
    queryKey: queryKeys.periods.detail(periodId ?? 0),
    queryFn: ({ signal }) => unwrapGenerated(getPeriod(periodId!, { signal }), 200, 'Failed to load period'),
    enabled: periodId != null,
    placeholderData: (previous) => previous,
  });
}

export function useSuggestedPeriodQuery() {
  return useQuery({
    queryKey: [...queryKeys.periods.all, 'suggested'] as const,
    queryFn: ({ signal }) => unwrapGenerated(suggestNextPeriod({ signal }), 200, 'Failed to suggest next period'),
    placeholderData: (previous) => previous,
  });
}

export function useReturnPreviewQuery(asOfDate: number | null) {
  return useQuery({
    queryKey: [...queryKeys.periods.all, 'return-preview', asOfDate ?? 0] as const,
    queryFn: ({ signal }) => unwrapGenerated(previewPeriodReturn({ asOfDate: asOfDate! }, { signal }), 200, 'Failed to preview return'),
    enabled: asOfDate != null,
  });
}

export function useCreatePeriodMutation() {
  const queryClient = useQueryClient();
  return useMutation<CreatePeriod200 | CreatePeriod201, Error, Parameters<typeof createPeriod>[0]>({
    mutationFn: async (input) => unwrapGenerated(createPeriod(input), [200, 201], 'Failed to create period') as Promise<CreatePeriod200 | CreatePeriod201>,
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useUpdatePeriodMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updatePeriod>[1] }) => unwrapGenerated(updatePeriod(id, data), [200, 201], 'Failed to update period'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useAutoCreatePeriodMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrapGenerated(autoCreatePeriod(), 201, 'Failed to create current period'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useClosePeriodMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrapGenerated(closePeriod(id), 200, 'Failed to close period'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useReopenPeriodMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrapGenerated(reopenPeriod(id), 200, 'Failed to reopen period'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useArchivePeriodMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrapGenerated(archivePeriod(id), 200, 'Failed to archive period'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useRestorePeriodMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrapGenerated(restorePeriod(id), 200, 'Failed to restore period'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useReturnBackfillMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ asOfDate, currentPeriodCoverage }: { asOfDate: number; currentPeriodCoverage: 'partial' | 'complete' }) => unwrapGenerated(createPeriodReturnBackfill({ asOfDate, confirmed: true, currentPeriodCoverage, reviewedCurrentPeriod: currentPeriodCoverage === 'complete' }), [200, 201], 'Failed to create return periods'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useSetPeriodCoverageMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof setPeriodCoverage>[1] }) => unwrapGenerated(setPeriodCoverage(id, data), 200, 'Failed to update period coverage'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}
