import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createTransactionBatch,
  discardTransactionBatch,
  getTransactionBatch,
  listTransactionBatches,
  postTransactionBatch,
  replaceDraftTransaction,
  type CreateTransactionBatchBody,
  type GetTransactionBatch200,
  type ListTransactionBatches200Item,
  type PostTransactionBatch200,
  type PostTransactionBatchBody,
} from '../../generated/client';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';
import { unwrapGenerated } from '../core/generated-response';

export type BatchSummary = ListTransactionBatches200Item;
export type BatchDetail = GetTransactionBatch200;
export type PostBatchResult = PostTransactionBatch200;

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
