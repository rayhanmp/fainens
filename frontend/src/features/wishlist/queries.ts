import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createWishlistItem,
  deleteWishlistItem,
  fulfillWishlistItem,
  linkWishlistTransaction,
  listCategories,
  listWishlist,
  scrapeWishlistProduct,
  scrapeWishlistProductAdvanced,
  updateWishlistItem,
  type CreateWishlistItemBody,
  type FulfillWishlistItemBody,
  type LinkWishlistTransactionBody,
  type UpdateWishlistItemBody,
  type ScrapeWishlistProductBody,
  type ScrapeWishlistProductAdvancedBody,
} from '../../generated/client';
import { unwrapGenerated } from '../core/generated-response';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';

export function useWishlistQuery() {
  return useQuery({
    queryKey: queryKeys.wishlist.all,
    queryFn: async () => {
      const [items, categories] = await Promise.all([
        unwrapGenerated(listWishlist(), 200, 'Failed to load wishlist'),
        unwrapGenerated(listCategories(), 200, 'Failed to load categories'),
      ]);
      return { items, categories: categories.map((category) => ({ ...category, icon: category.icon ?? null, color: category.color ?? null })) };
    },
    placeholderData: (previous) => previous,
  });
}

export type WishlistScrapeResult = {
  success: boolean;
  data?: {
    name: string;
    price: number;
    description: string;
    imageUrl: string;
    source: string;
    currency: string;
    url: string;
    originalPrice?: number;
    discountPercentage?: number;
    rating?: number;
    reviewCount?: number;
    sellerName?: string;
    brand?: string;
  };
  attempts: Array<{ method: string; success: boolean; timestamp: number; duration: number; error?: string; dataFound?: unknown }>;
  requiresAdvancedScraping: boolean;
  error?: { code: string; message: string; suggestions: string[] };
};

export function useScrapeWishlistMutation() {
  return useMutation<WishlistScrapeResult, Error, ScrapeWishlistProductBody>({
    mutationFn: (input) => unwrapGenerated(scrapeWishlistProduct(input), 200, 'Failed to scrape product') as Promise<WishlistScrapeResult>,
  });
}

export function useAdvancedScrapeWishlistMutation() {
  return useMutation<WishlistScrapeResult, Error, ScrapeWishlistProductAdvancedBody>({
    mutationFn: (input) => unwrapGenerated(scrapeWishlistProductAdvanced(input), 200, 'Failed to scrape product') as Promise<WishlistScrapeResult>,
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
  return useWishlistMutation((input: CreateWishlistItemBody) => unwrapGenerated(createWishlistItem(input), 201, 'Failed to create wishlist item'));
}

export function useUpdateWishlistMutation() {
  return useWishlistMutation(({ id, data }: { id: number; data: UpdateWishlistItemBody }) => unwrapGenerated(updateWishlistItem(id, data), 200, 'Failed to update wishlist item'));
}

export function useDeleteWishlistMutation() {
  return useWishlistMutation((id: number) => unwrapGenerated(deleteWishlistItem(id), 204, 'Failed to delete wishlist item'));
}

export function useFulfillWishlistMutation() {
  return useWishlistMutation(({ id, data }: { id: number; data: FulfillWishlistItemBody }) => unwrapGenerated(fulfillWishlistItem(id, data), 200, 'Failed to fulfill wishlist item'));
}

export function useLinkWishlistMutation() {
  return useWishlistMutation(({ id, transactionId }: { id: number; transactionId: number }) => {
    const body: LinkWishlistTransactionBody = { transactionId };
    return unwrapGenerated(linkWishlistTransaction(id, body), 200, 'Failed to link wishlist transaction');
  });
}
