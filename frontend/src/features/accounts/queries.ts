import { useQuery } from '@tanstack/react-query';
import { listAccounts } from '../../generated/client';
import { queryKeys } from '../core/query-keys';
import { api } from '../../lib/api';

export const useAccountsQuery = () => useQuery({
  queryKey: queryKeys.accounts.all,
  queryFn: async ({ signal }) => (await listAccounts({ signal })).data,
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
