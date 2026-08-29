import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createAccount,
  deleteAccount,
  getDashboardAnalytics,
  listAccounts,
  listReconciliation,
  restoreAccount,
  updateAccount,
  type ListAccountsParams,
} from '../../generated/client';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';
import { unwrapGenerated } from '../core/generated-response';

export const useAccountsQuery = () => useQuery({
  queryKey: queryKeys.accounts.all,
  queryFn: async ({ signal }) => {
    const response = await listAccounts(undefined, { signal });
    if (response.status !== 200) throw new Error('Failed to load accounts');
    return response.data;
  },
});

export type AccountListParams = {
  type?: ListAccountsParams['type'] | string;
  search?: string;
  includeInactive?: boolean;
};

/** Rich account ledger rows used by the Accounts screen until that endpoint joins the generated contract. */
export function useAccountsLedgerQuery(params?: AccountListParams) {
  const normalizedParams = params ?? {};
  return useQuery({
    queryKey: queryKeys.accounts.list(normalizedParams),
    queryFn: () => unwrapGenerated(
      listAccounts({
        ...(params?.type ? { type: params.type as ListAccountsParams['type'] } : {}),
        ...(params?.search ? { search: params.search } : {}),
        ...(params?.includeInactive !== undefined ? { includeInactive: params.includeInactive ? 'true' : 'false' } : {}),
      }),
      200,
      'Failed to load accounts',
    ),
    placeholderData: (previous) => previous,
  });
}

export function useReconciliationHistoryQuery(limit = 25) {
  return useQuery({
    queryKey: queryKeys.accounts.reconciliation(limit),
    queryFn: () => unwrapGenerated(listReconciliation({ limit: String(limit) }), 200, 'Failed to load reconciliation history'),
    placeholderData: (previous) => previous,
  });
}

export function useAccountDashboardQuery() {
  return useQuery({
    queryKey: queryKeys.dashboard.analytics,
    queryFn: () => unwrapGenerated(getDashboardAnalytics(), 200, 'Failed to load dashboard analytics'),
    placeholderData: (previous) => previous,
  });
}

export function useCreateAccountMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof createAccount>[0]) => unwrapGenerated(createAccount(input), 201, 'Failed to create account'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useUpdateAccountMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateAccount>[1] }) => unwrapGenerated(updateAccount(id, data), 200, 'Failed to update account'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useDeleteAccountMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrapGenerated(deleteAccount(id), 204, 'Failed to archive account'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useRestoreAccountMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrapGenerated(restoreAccount(id), 200, 'Failed to restore account'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}
