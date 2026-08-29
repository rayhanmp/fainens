import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createAccount,
  deleteAccount,
  getDashboardAnalytics,
  listAccounts,
  listReconciliation,
  restoreAccount,
  updateAccount,
  type ListAccounts200Item,
  type ListAccountsParams,
} from '../../generated/client';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';
import { normalizeTimestamp, unwrapGenerated } from '../core/generated-response';

export const useAccountsQuery = () => useQuery({
  queryKey: queryKeys.accounts.all,
  queryFn: async ({ signal }) => {
    const response = await listAccounts(undefined, { signal });
    if (response.status !== 200) throw new Error('Failed to load accounts');
    return response.data.map(normalizeAccount);
  },
});

export type AccountLedgerRow = {
  id: number;
  name: string;
  type: string;
  balance: number;
  isActive: boolean;
  systemKey: string | null;
  liquidityClass: 'cash_equivalent' | 'receivable' | 'investment' | 'non_cash';
  [key: string]: unknown;
};

function normalizeAccount(account: ListAccounts200Item): AccountLedgerRow {
  const raw = account as Record<string, unknown>;
  const liquidityClass = raw.liquidityClass === 'cash_equivalent' || raw.liquidityClass === 'receivable' || raw.liquidityClass === 'investment' || raw.liquidityClass === 'non_cash'
    ? raw.liquidityClass
    : 'non_cash';
  return {
    ...raw,
    id: account.id,
    name: account.name,
    type: account.type,
    balance: typeof account.balance === 'number' ? account.balance : 0,
    isActive: raw.isActive !== false,
    systemKey: typeof raw.systemKey === 'string' ? raw.systemKey : null,
    liquidityClass,
  };
}

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
    queryFn: async ({ signal }) => {
      const accounts = await unwrapGenerated(
        listAccounts({
        ...(params?.type ? { type: params.type as ListAccountsParams['type'] } : {}),
        ...(params?.search ? { search: params.search } : {}),
        ...(params?.includeInactive !== undefined ? { includeInactive: params.includeInactive ? 'true' : 'false' } : {}),
        }, { signal }),
        200,
        'Failed to load accounts',
      );
      return accounts.map(normalizeAccount);
    },
    placeholderData: (previous) => previous,
  });
}

export function useReconciliationHistoryQuery(limit = 25) {
  return useQuery({
    queryKey: queryKeys.accounts.reconciliation(limit),
    queryFn: async ({ signal }) => {
      const payload = await unwrapGenerated(listReconciliation({ limit: String(limit) }, { signal }), 200, 'Failed to load reconciliation history');
      return { ...payload, sessions: payload.sessions.map((session) => ({
        ...session,
        asOfDate: normalizeTimestamp(session.asOfDate),
        createdAt: normalizeTimestamp(session.createdAt),
        voidedAt: session.voidedAt == null ? null : normalizeTimestamp(session.voidedAt),
      })) };
    },
    placeholderData: (previous) => previous,
  });
}

export function useAccountDashboardQuery() {
  return useQuery({
    queryKey: queryKeys.dashboard.analytics,
    queryFn: ({ signal }) => unwrapGenerated(getDashboardAnalytics({ signal }), 200, 'Failed to load dashboard analytics'),
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
