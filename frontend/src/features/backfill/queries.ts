import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createTransactionBatch,
  discardTransactionBatch,
  getTransactionBatch,
  getTransactionBatchSettlement,
  listTransactionBatches,
  listTransactions,
  postTransactionBatch,
  replaceDraftTransaction,
  type CreateTransactionBatchBody,
  type GetTransactionBatch200,
  type GetTransactionBatchSettlement200AccountsItem,
  type ListTransactions200DataItem,
  type PostTransactionBatchBodySettlementsItem,
  type ListTransactionBatches200Item,
  type PostTransactionBatch200,
  type PostTransactionBatchBody,
} from '../../generated/client';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';
import { unwrapGenerated } from '../core/generated-response';

export type BatchSummary = ListTransactionBatches200Item;
export type BatchDetail = GetTransactionBatch200;
export type PostBatchResult = PostTransactionBatch200;
export type SettlementAccount = GetTransactionBatchSettlement200AccountsItem;
export type SettlementInput = PostTransactionBatchBodySettlementsItem;

/** Every draft in a batch, oldest first. The API returns at most 100 rows per request, so this pages through. */
export function useBatchDraftsQuery(id: number | null) {
  return useQuery({
    queryKey: [...queryKeys.transactions.batch(id ?? 0), 'drafts'],
    queryFn: async ({ signal }) => {
      const drafts: ListTransactions200DataItem[] = [];
      for (let offset = 0; ; offset += 100) {
        const response = await listTransactions({ periodId: 'all', status: 'draft', batchId: String(id), sort: 'oldest', limit: '100', offset: String(offset) }, { signal });
        if (response.status !== 200) throw new Error('Failed to load drafts');
        drafts.push(...response.data.data);
        if (!response.data.pagination.hasMore) return drafts;
      }
    },
    enabled: id != null,
  });
}

/** Each account the batch's drafts touch, with today's balance and what posting adds. */
export function useBatchSettlementQuery(id: number | null, enabled: boolean) {
  return useQuery({
    queryKey: [...queryKeys.transactions.batch(id ?? 0), 'settlement'],
    queryFn: ({ signal }) => unwrapGenerated(getTransactionBatchSettlement(id!, { signal }), 200, 'Failed to load balances'),
    enabled: enabled && id != null,
  });
}

export function useBatchesQuery() {
  return useQuery({
    queryKey: queryKeys.transactions.batches,
    queryFn: ({ signal }) => unwrapGenerated(listTransactionBatches({ signal }), 200, 'Failed to load batches'),
    placeholderData: (previous) => previous,
  });
}

export function useBatchQuery(id: number | null) {
  return useQuery({
    queryKey: queryKeys.transactions.batch(id ?? 0),
    queryFn: ({ signal }) => unwrapGenerated(getTransactionBatch(id!, { signal }), 200, 'Failed to load batch'),
    enabled: id != null,
    placeholderData: (previous) => previous,
  });
}

export function useCreateBatchMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTransactionBatchBody) => unwrapGenerated(createTransactionBatch(input), 201, 'Failed to create batch'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.transactions.batches }),
  });
}

export function usePostBatchMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input?: PostTransactionBatchBody }) => unwrapGenerated(postTransactionBatch(id, input ?? {}), 200, 'Failed to post batch'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useDiscardBatchMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrapGenerated(discardTransactionBatch(id), 200, 'Failed to discard batch'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

/** Rebuilds a draft from the entry form's input, the same payload the create endpoint takes. */
export function useReplaceDraftMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: Parameters<typeof replaceDraftTransaction>[1] }) => unwrapGenerated(replaceDraftTransaction(id, input), 200, 'Failed to save draft'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}
