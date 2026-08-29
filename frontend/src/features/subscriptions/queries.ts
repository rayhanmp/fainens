import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  archiveSubscription,
  createSubscription,
  listAccounts,
  listCategories,
  listSubscriptions,
  processSubscriptionRenewals,
  updateSubscription,
  type CreateSubscriptionBody,
  type ProcessSubscriptionRenewalsBody,
  type UpdateSubscriptionBody,
} from '../../generated/client';
import { unwrapGenerated } from '../core/generated-response';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';

export type SubscriptionsPageData = {
  subscriptions: Awaited<ReturnType<typeof listSubscriptions>>['data']['subscriptions'];
  renewalPreview: Awaited<ReturnType<typeof listSubscriptions>>['data']['renewalPreview'];
  accounts: Array<{ id: number; name: string }>;
  categories: Array<{ id: number; name: string }>;
};

type SubscriptionDraft = Omit<CreateSubscriptionBody, 'billingCycle' | 'status' | 'iconKey'> & {
  billingCycle?: string;
  status?: string;
  iconKey?: string;
};
type SubscriptionUpdateDraft = Omit<UpdateSubscriptionBody, 'billingCycle' | 'status' | 'iconKey'> & {
  billingCycle?: string;
  status?: string;
  iconKey?: string;
};

function normalizeSubscriptionDraft(input: SubscriptionDraft): CreateSubscriptionBody {
  return {
    ...input,
    billingCycle: input.billingCycle === 'annual' ? 'annual' : 'monthly',
    status: input.status === 'paused' ? 'paused' : 'active',
    iconKey: ['car', 'film', 'music', 'signal', 'sparkles', 'default'].includes(input.iconKey ?? '')
      ? input.iconKey as CreateSubscriptionBody['iconKey']
      : 'default',
  } as CreateSubscriptionBody;
}

function normalizeSubscriptionUpdate(input: SubscriptionUpdateDraft): UpdateSubscriptionBody {
  return {
    ...input,
    ...(input.billingCycle ? { billingCycle: input.billingCycle === 'annual' ? 'annual' : 'monthly' } : {}),
    ...(input.status ? { status: input.status === 'paused' ? 'paused' : 'active' } : {}),
    ...(input.iconKey ? { iconKey: ['car', 'film', 'music', 'signal', 'sparkles', 'default'].includes(input.iconKey) ? input.iconKey as UpdateSubscriptionBody['iconKey'] : 'default' } : {}),
  } as UpdateSubscriptionBody;
}

/** Loads subscription records and the lookup lists used by its editor. */
export function useSubscriptionsQuery() {
  return useQuery<SubscriptionsPageData>({
    queryKey: queryKeys.subscriptions.all,
    queryFn: async () => {
      const [subscriptionData, accounts, categories] = await Promise.all([
        unwrapGenerated(listSubscriptions(), 200, 'Failed to load subscriptions'),
        unwrapGenerated(listAccounts(), 200, 'Failed to load accounts'),
        unwrapGenerated(listCategories(), 200, 'Failed to load categories'),
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
    mutationFn: (input: SubscriptionDraft) => unwrapGenerated(createSubscription(normalizeSubscriptionDraft(input)), 201, 'Failed to create subscription'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useUpdateSubscriptionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: SubscriptionUpdateDraft }) => unwrapGenerated(updateSubscription(id, normalizeSubscriptionUpdate(data)), 200, 'Failed to update subscription'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useDeleteSubscriptionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrapGenerated(archiveSubscription(id), 204, 'Failed to archive subscription'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useRunRenewalsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProcessSubscriptionRenewalsBody) => unwrapGenerated(processSubscriptionRenewals(input), 200, 'Failed to process subscription renewals'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}
