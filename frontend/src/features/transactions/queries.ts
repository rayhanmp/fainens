import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import {
  getTransaction,
  listPendingTransactions,
  listTransactions,
  listTransportRouteTemplates,
  type ListTransactionsParams,
} from "../../generated/client";
import { invalidateFinancialSummaries, queryKeys } from "../core/query-keys";

export function useTransactionList(filters: ListTransactionsParams = {}) {
  return useQuery({
    queryKey: queryKeys.transactions.list(filters ?? {}),
    queryFn: async ({ signal }) => {
      const response = await listTransactions(filters, { signal });
      if (response.status !== 200) throw new Error('Failed to load transactions');
      return response.data;
    },
    placeholderData: (previous) => previous,
  });
}

export function usePendingTransactionsQuery() {
  return useQuery({
    queryKey: queryKeys.transactions.pending,
    queryFn: async ({ signal }) => {
      const response = await listPendingTransactions({ signal });
      if (response.status !== 200) throw new Error('Failed to load pending transactions');
      return response.data;
    },
    placeholderData: (previous) => previous,
  });
}

export function useTransactionDetailQuery(id: number | null) {
  return useQuery({
    queryKey: queryKeys.transactions.detail(id ?? 0),
    queryFn: async ({ signal }) => {
      const response = await getTransaction(id!, { signal });
      if (response.status !== 200) throw new Error('Failed to load transaction');
      return response.data;
    },
    enabled: id != null,
    placeholderData: (previous) => previous,
  });
}

export function useTransportRouteTemplatesQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.transactions.routeTemplates,
    queryFn: async ({ signal }) => {
      const response = await listTransportRouteTemplates({ signal });
      if (response.status !== 200) throw new Error('Failed to load route templates');
      return response.data;
    },
    enabled,
    placeholderData: (previous) => previous,
  });
}

function useRouteTemplateMutation<TInput>(mutationFn: (input: TInput) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.transactions.routeTemplates }),
  });
}

export function useCreateTransportRouteTemplateMutation() {
  return useRouteTemplateMutation((input: Parameters<typeof api.transportRouteTemplates.create>[0]) => api.transportRouteTemplates.create(input));
}

export function useUpdateTransportRouteTemplateMutation() {
  return useRouteTemplateMutation(({ id, data }: { id: number; data: Parameters<typeof api.transportRouteTemplates.update>[1] }) => api.transportRouteTemplates.update(id, data));
}

export function useDeleteTransportRouteTemplateMutation() {
  return useRouteTemplateMutation((id: number) => api.transportRouteTemplates.delete(id));
}

export function useCreateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (input: Parameters<typeof api.transactions.create>[0]) => api.transactions.create(input), onSuccess: () => invalidateFinancialSummaries(queryClient) });
}

export function useReverseTransaction() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (id: number) => api.transactions.reverse(id), onSuccess: () => invalidateFinancialSummaries(queryClient) });
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof api.transactions.update>[1] }) => api.transactions.update(id, data),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.transactions.delete(id),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useBulkDeleteTransactions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => api.transactions.bulkDelete(ids),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useImportTransactions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.transactions.importConfirm>[0]) => api.transactions.importConfirm(input),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

type PendingTransactionParsed = Parameters<typeof api.pendingTransactions.create>[1];

export function usePreviewPendingTransactionMutation() {
  return useMutation({
    mutationFn: (message: string) => api.pendingTransactions.preview(message),
  });
}

export function useCreatePendingTransactionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ message, parsed }: { message: string; parsed: PendingTransactionParsed }) => api.pendingTransactions.create(message, parsed),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.transactions.pending }),
  });
}

export function useUpdatePendingTransactionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, parsed }: { id: number; parsed: PendingTransactionParsed }) => api.pendingTransactions.update(id, parsed),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.transactions.pending }),
  });
}

export function useApprovePendingTransactionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.pendingTransactions.approve(id),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useRejectPendingTransactionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.pendingTransactions.reject(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.transactions.pending }),
  });
}
