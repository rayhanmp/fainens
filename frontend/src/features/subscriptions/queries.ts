import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';

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

export function useCreateSubscriptionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.subscriptions.create>[0]) => api.subscriptions.create(input),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useUpdateSubscriptionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof api.subscriptions.update>[1] }) => api.subscriptions.update(id, data),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useDeleteSubscriptionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.subscriptions.delete(id),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useRunRenewalsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ mode, occurrences }: { mode: 'post' | 'skip'; occurrences: Array<{ subscriptionId: number; dueAt: number }> }) => api.subscriptions.runRenewals(mode, occurrences),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}
