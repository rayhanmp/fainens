import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../core/query-keys';

export type SubscriptionsPageData = {
  subscriptions: Awaited<ReturnType<typeof api.subscriptions.list>>['subscriptions'];
  renewalPreview: Awaited<ReturnType<typeof api.subscriptions.list>>['renewalPreview'];
  accounts: Array<{ id: number; name: string }>;
  categories: Array<{ id: number; name: string }>;
};

/** Loads subscription records and the lookup lists used by its editor. */
export function useSubscriptionsQuery() {
  return useQuery<SubscriptionsPageData>({
    queryKey: queryKeys.subscriptions.all,
    queryFn: async () => {
      const [subscriptionData, accounts, categories] = await Promise.all([
        api.subscriptions.list(),
        api.accounts.list(),
        api.categories.list(),
      ]);
      return {
        subscriptions: subscriptionData.subscriptions,
        renewalPreview: subscriptionData.renewalPreview,
        accounts: accounts.map((account) => ({ id: account.id, name: account.name })),
        categories: categories.map((category) => ({ id: category.id, name: category.name })),
      };
    },
    placeholderData: (previous) => previous,
  });
}
