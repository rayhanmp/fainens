import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';

export function useWishlistQuery() {
  return useQuery({
    queryKey: queryKeys.wishlist.all,
    queryFn: async () => {
      const [items, categories] = await Promise.all([
        api.wishlist.list(),
        api.categories.list(),
      ]);
      return { items, categories };
    },
    placeholderData: (previous) => previous,
  });
}

function useWishlistMutation<TInput>(mutationFn: (input: TInput) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useCreateWishlistMutation() {
  return useWishlistMutation((input: Parameters<typeof api.wishlist.create>[0]) => api.wishlist.create(input));
}

export function useUpdateWishlistMutation() {
  return useWishlistMutation(({ id, data }: { id: number; data: Parameters<typeof api.wishlist.update>[1] }) => api.wishlist.update(id, data));
}

export function useDeleteWishlistMutation() {
  return useWishlistMutation((id: number) => api.wishlist.delete(id));
}

export function useFulfillWishlistMutation() {
  return useWishlistMutation(({ id, data }: { id: number; data: Parameters<typeof api.wishlist.fulfill>[1] }) => api.wishlist.fulfill(id, data));
}

export function useLinkWishlistMutation() {
  return useWishlistMutation(({ id, transactionId }: { id: number; transactionId: number }) => api.wishlist.link(id, transactionId));
}
