import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createReconciliation,
  createRecoveryReconciliation,
  voidReconciliation,
} from '../../generated/client';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';
import { unwrapGenerated } from '../core/generated-response';

async function invalidateReconciliationQueries(queryClient: { invalidateQueries: (options: { queryKey: readonly unknown[] }) => Promise<unknown> }) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.accounts.reconciliation(25) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.reconciliation }),
  ]);
}

/** Reconciliation writes are control evidence, except recovery which also
 * posts a disclosed bridge journal. Keep both behind typed feature commands
 * so callers cannot forget the history/dashboard invalidation. */
export function useCreateReconciliationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof createReconciliation>[0]) =>
      unwrapGenerated(createReconciliation(input), 201, 'Failed to reconcile'),
    onSuccess: () => invalidateReconciliationQueries(queryClient),
  });
}

export function useCreateRecoveryReconciliationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof createRecoveryReconciliation>[0]) =>
      unwrapGenerated(createRecoveryReconciliation(input), 201, 'Failed to create recovery bridge'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useVoidReconciliationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      unwrapGenerated(voidReconciliation(id, { reason }), 200, 'Failed to void reconciliation'),
    onSuccess: () => invalidateReconciliationQueries(queryClient),
  });
}
