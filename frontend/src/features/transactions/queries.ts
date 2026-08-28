import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { invalidateFinancialSummaries, queryKeys } from "../core/query-keys";

export function useTransactionList(filters: Parameters<typeof api.transactions.list>[0] = {}) {
  return useQuery({ queryKey: queryKeys.transactions.list(filters ?? {}), queryFn: () => api.transactions.list(filters), placeholderData: (previous) => previous });
}

export function usePendingTransactionsQuery() {
  return useQuery({
    queryKey: queryKeys.transactions.pending,
    queryFn: () => api.pendingTransactions.list(),
    placeholderData: (previous) => previous,
  });
}

export function useTransactionDetailQuery(id: number | null) {
  return useQuery({
    queryKey: queryKeys.transactions.detail(id ?? 0),
    queryFn: () => api.transactions.get(id!),
    enabled: id != null,
    placeholderData: (previous) => previous,
  });
}

export function useCreateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (input: Parameters<typeof api.transactions.create>[0]) => api.transactions.create(input), onSuccess: () => invalidateFinancialSummaries(queryClient) });
}

export function useReverseTransaction() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (id: number) => api.transactions.reverse(id), onSuccess: () => invalidateFinancialSummaries(queryClient) });
}
