import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  approvePendingTransaction,
  bulkDeleteTransactions,
  confirmTransactionImport,
  createTransaction,
  createTransportRouteTemplate,
  deleteTransaction,
  deleteTransportRouteTemplate,
  getTransaction,
  listPendingTransactions,
  listTransactions,
  listTransportRouteTemplates,
  parsePendingTransaction,
  previewTransactionImport,
  rejectPendingTransaction,
  reverseTransaction,
  retryPendingTransaction,
  updateTransaction,
  updateTransportRouteTemplate,
  type ListTransactionsParams,
  type PreviewTransactionImport200AnyOfFour,
} from "../../generated/client";
import { api } from "../../lib/api";
import { invalidateFinancialSummaries, queryKeys } from "../core/query-keys";
import { unwrapGenerated } from "../core/generated-response";

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
  return useRouteTemplateMutation(async (input: Parameters<typeof createTransportRouteTemplate>[0]) => {
    const result = await unwrapGenerated(createTransportRouteTemplate(input), 201, 'Failed to save route template');
    return result.template;
  });
}

export function useUpdateTransportRouteTemplateMutation() {
  return useRouteTemplateMutation(async ({ id, data }: { id: number; data: Parameters<typeof updateTransportRouteTemplate>[1] }) => {
    const result = await unwrapGenerated(updateTransportRouteTemplate(id, data), 200, 'Failed to update route template');
    return result.template;
  });
}

export function useDeleteTransportRouteTemplateMutation() {
  return useRouteTemplateMutation((id: number) => unwrapGenerated(deleteTransportRouteTemplate(id), 204, 'Failed to delete route template'));
}

export function useCreateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (input: Parameters<typeof createTransaction>[0]) => unwrapGenerated(createTransaction(input), 201, 'Failed to create transaction'), onSuccess: () => invalidateFinancialSummaries(queryClient) });
}

export function useReverseTransaction() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (id: number) => unwrapGenerated(reverseTransaction(id), 201, 'Failed to reverse transaction'), onSuccess: () => invalidateFinancialSummaries(queryClient) });
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateTransaction>[1] }) => unwrapGenerated(updateTransaction(id, data), 200, 'Failed to update transaction'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrapGenerated(deleteTransaction(id), 204, 'Failed to delete transaction'),
    onSuccess: async (_data, id) => {
      // An inactive detail query must not resurrect a deleted record when a
      // user opens it again from browser history or a stale view.
      queryClient.removeQueries({ queryKey: queryKeys.transactions.detail(id) });
      await invalidateFinancialSummaries(queryClient);
    },
  });
}

export function useBulkDeleteTransactions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => unwrapGenerated(bulkDeleteTransactions({ ids }), 200, 'Failed to delete transactions'),
    onSuccess: async (_data, ids) => {
      for (const id of ids) queryClient.removeQueries({ queryKey: queryKeys.transactions.detail(id) });
      await invalidateFinancialSummaries(queryClient);
    },
  });
}

export function useImportTransactions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof confirmTransactionImport>[0]) => unwrapGenerated(confirmTransactionImport(input), 201, 'Failed to import transactions'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

/** Parses the richer CSV import format without keeping request state in the modal. */
export function usePreviewTransactionImportMutation() {
  return useMutation<PreviewTransactionImport200AnyOfFour, Error, string>({
    mutationFn: async (csvText: string) => unwrapGenerated(
      previewTransactionImport({ csvText }),
      200,
      'Failed to preview transaction import',
    ) as Promise<PreviewTransactionImport200AnyOfFour>,
  });
}

type PendingTransactionParsed = Parameters<typeof api.pendingTransactions.create>[1];
export type PendingTransactionPreview = { parsed: PendingTransactionParsed };

export function usePreviewPendingTransactionMutation() {
  return useMutation<PendingTransactionPreview, Error, string>({
    mutationFn: async (message: string) => unwrapGenerated(parsePendingTransaction({ message }), 200, 'Failed to parse transaction') as Promise<PendingTransactionPreview>,
  });
}

/** Legacy recommendation endpoint adapter kept inside the transactions feature until it is in OpenAPI. */
export function useRecommendCategoryMutation() {
  return useMutation({
    mutationFn: (description: string) => api.transactions.recommendCategory(description),
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
    mutationFn: (id: number) => unwrapGenerated(approvePendingTransaction(id), 200, 'Failed to approve transaction'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useRejectPendingTransactionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrapGenerated(rejectPendingTransaction(id), 200, 'Failed to reject transaction'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.transactions.pending }),
  });
}

export function useRetryPendingTransactionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrapGenerated(retryPendingTransaction(id), 200, 'Failed to retry transaction parsing'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.transactions.pending }),
  });
}
