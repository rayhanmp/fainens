import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../core/query-keys';

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
