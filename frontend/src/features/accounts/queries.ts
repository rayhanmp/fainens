import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listAccounts } from '../../generated/client';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';
import { api } from '../../lib/api';

export const useAccountsQuery = () => useQuery({
  queryKey: queryKeys.accounts.all,
  queryFn: async ({ signal }) => {
    const response = await listAccounts(undefined, { signal });
    if (response.status !== 200) throw new Error('Failed to load accounts');
    return response.data;
  },
});

export type AccountListParams = Parameters<typeof api.accounts.list>[0];

/** Rich account ledger rows used by the Accounts screen until that endpoint joins the generated contract. */
export function useAccountsLedgerQuery(params?: AccountListParams) {
  const normalizedParams = params ?? {};
  return useQuery({
    queryKey: queryKeys.accounts.list(normalizedParams),
    queryFn: () => api.accounts.list(params),
    placeholderData: (previous) => previous,
  });
}

export function useReconciliationHistoryQuery(limit = 25) {
  return useQuery({
    queryKey: queryKeys.accounts.reconciliation(limit),
    queryFn: () => api.accounts.reconciliationHistory(limit),
    placeholderData: (previous) => previous,
  });
}

export function useAccountDashboardQuery() {
  return useQuery({
    queryKey: queryKeys.dashboard.analytics,
    queryFn: () => api.analytics.dashboard(),
    placeholderData: (previous) => previous,
  });
}

export function useCreateAccountMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.accounts.create>[0]) => api.accounts.create(input),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useUpdateAccountMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof api.accounts.update>[1] }) => api.accounts.update(id, data),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useDeleteAccountMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.accounts.delete(id),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useRestoreAccountMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.accounts.restore(id),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}
