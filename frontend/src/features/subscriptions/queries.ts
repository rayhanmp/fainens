import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  archiveSubscription,
  attachSubscriptionPastPayment,
  correctSubscriptionOccurrence,
  detachSubscriptionPastPayment,
  listSubscriptionPastPayments,
  createSubscription,
  getSubscriptionHistory,
  listAccounts,
  listCategories,
  listSubscriptionOccurrenceCandidates,
  listSubscriptions,
  processSubscriptionRenewals,
  resolveSubscriptionOccurrences,
  unlinkSubscriptionOccurrence,
  updateSubscription,
  voidSubscriptionOccurrence,
  type CorrectSubscriptionOccurrenceBody,
  type CreateSubscriptionBody,
  type ListSubscriptions200SubscriptionsItem,
  type ListSubscriptions200RenewalPreviewOccurrencesItem,
  type ProcessSubscriptionRenewalsBody,
  type ResolveSubscriptionOccurrencesBody,
  type UpdateSubscriptionBody,
} from '../../generated/client';
import { unwrapGenerated } from '../core/generated-response';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';
import { isPaymentAccount, type PaymentAccount } from './accounts';

export type Subscription = ListSubscriptions200SubscriptionsItem;
export type RenewalOccurrence = ListSubscriptions200RenewalPreviewOccurrencesItem;

export type SubscriptionsPageData = {
  /** Every subscription, archived ones included; the page filters them. */
  subscriptions: Subscription[];
  renewalPreview: { occurrences: RenewalOccurrence[]; truncated: boolean };
  /** What subscriptions charged in each of the last twelve months, oldest first. */
  monthlyCharges: Array<{ month: string; total: number; items: Array<{ subscriptionId: number; amount: number }> }>;
  /** Renewals in the same twelve months that charged nothing: skipped, or posted and voided. */
  unpaidRenewals: Array<{ subscriptionId: number; dueAt: number; kind: 'skipped' | 'voided' }>;
  /** Accounts that can pay a subscription: active wallets, banks and cards, with their balances. */
  accounts: PaymentAccount[];
  /** Every account by id, for naming an account a subscription still points at. */
  accountNames: Map<number, string>;
  categories: Array<{ id: number; name: string }>;
};

/** Loads subscription records and the lookup lists used by its editor. */
export function useSubscriptionsQuery() {
  return useQuery<SubscriptionsPageData>({
    queryKey: queryKeys.subscriptions.all,
    queryFn: async () => {
      const [subscriptionData, accounts, categories] = await Promise.all([
        unwrapGenerated(listSubscriptions({ includeArchived: 'true' }), 200, 'Failed to load subscriptions'),
        unwrapGenerated(listAccounts(), 200, 'Failed to load accounts'),
        unwrapGenerated(listCategories(), 200, 'Failed to load categories'),
      ]);
      return {
        subscriptions: subscriptionData.subscriptions,
        renewalPreview: subscriptionData.renewalPreview,
        monthlyCharges: subscriptionData.monthlyCharges,
        unpaidRenewals: subscriptionData.unpaidRenewals,
        accounts: accounts.filter(isPaymentAccount).map((account) => ({
          id: account.id,
          name: account.name,
          type: account.type,
          balance: account.balance ?? 0,
        })),
        accountNames: new Map(accounts.map((account) => [account.id, account.name])),
        categories: categories
          .filter((category) => category.isActive !== false && category.id != null)
          .map((category) => ({ id: category.id as number, name: category.name })),
      };
    },
    placeholderData: (previous) => previous,
  });
}

export function useSubscriptionHistoryQuery(subscriptionId: number | null) {
  return useQuery({
    queryKey: [...queryKeys.subscriptions.all, 'history', subscriptionId],
    queryFn: () => unwrapGenerated(getSubscriptionHistory(subscriptionId!), 200, 'Failed to load the payment history'),
    enabled: subscriptionId != null,
  });
}

/** Expenses already entered that could be this renewal's charge. */
export function useOccurrenceCandidatesQuery(occurrence: { subscriptionId: number; dueAt: number } | null) {
  return useQuery({
    queryKey: [...queryKeys.subscriptions.all, 'candidates', occurrence?.subscriptionId, occurrence?.dueAt],
    queryFn: () => unwrapGenerated(listSubscriptionOccurrenceCandidates(occurrence!.subscriptionId, occurrence!.dueAt), 200, 'Failed to look for matching transactions'),
    enabled: occurrence != null,
  });
}

function useSubscriptionMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useCreateSubscriptionMutation() {
  return useSubscriptionMutation((input: CreateSubscriptionBody) => unwrapGenerated(createSubscription(input), 201, 'Failed to create subscription'));
}

export function useUpdateSubscriptionMutation() {
  return useSubscriptionMutation(({ id, data }: { id: number; data: UpdateSubscriptionBody }) => unwrapGenerated(updateSubscription(id, data), 200, 'Failed to update subscription'));
}

export function useDeleteSubscriptionMutation() {
  return useSubscriptionMutation((id: number) => unwrapGenerated(archiveSubscription(id), 204, 'Failed to archive subscription'));
}

export function useRunRenewalsMutation() {
  return useSubscriptionMutation((input: ProcessSubscriptionRenewalsBody) => unwrapGenerated(processSubscriptionRenewals(input), 200, 'Failed to process subscription renewals'));
}

export type OccurrenceResolution = ResolveSubscriptionOccurrencesBody['items'][number];

export function useResolveOccurrencesMutation() {
  return useSubscriptionMutation((items: OccurrenceResolution[]) => unwrapGenerated(resolveSubscriptionOccurrences({ items }), 200, 'Failed to record the renewal'));
}

export function useCorrectOccurrenceMutation() {
  return useSubscriptionMutation(({ subscriptionId, dueAt, data }: { subscriptionId: number; dueAt: number; data: CorrectSubscriptionOccurrenceBody }) =>
    unwrapGenerated(correctSubscriptionOccurrence(subscriptionId, dueAt, data), 201, 'Failed to correct the renewal'));
}

export function useVoidOccurrenceMutation() {
  return useSubscriptionMutation(({ subscriptionId, dueAt, reason }: { subscriptionId: number; dueAt: number; reason: string }) =>
    unwrapGenerated(voidSubscriptionOccurrence(subscriptionId, dueAt, { reason }), 201, 'Failed to void the renewal'));
}

/** Expenses already in the ledger that look like this subscription's payments. */
export function usePastPaymentsQuery(subscriptionId: number | null) {
  return useQuery({
    queryKey: [...queryKeys.subscriptions.all, 'past-payments', subscriptionId],
    queryFn: () => unwrapGenerated(listSubscriptionPastPayments(subscriptionId!), 200, 'Failed to look for past payments'),
    enabled: subscriptionId != null,
  });
}

export function useAttachPastPaymentMutation() {
  return useSubscriptionMutation(({ subscriptionId, transactionId, dueAt }: { subscriptionId: number; transactionId: number; dueAt: number | null }) =>
    unwrapGenerated(attachSubscriptionPastPayment(subscriptionId, { transactionId, dueAt }), 200, 'Failed to attach the payment'));
}

export function useDetachPastPaymentMutation() {
  return useSubscriptionMutation(({ subscriptionId, transactionId }: { subscriptionId: number; transactionId: number }) =>
    unwrapGenerated(detachSubscriptionPastPayment(subscriptionId, transactionId), 200, 'Failed to detach the payment'));
}

export function useUnlinkOccurrenceMutation() {
  return useSubscriptionMutation(({ subscriptionId, dueAt }: { subscriptionId: number; dueAt: number }) =>
    unwrapGenerated(unlinkSubscriptionOccurrence(subscriptionId, dueAt), 200, 'Failed to unlink the transaction'));
}
