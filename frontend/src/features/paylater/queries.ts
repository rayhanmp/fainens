import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getPaylaterObligations, listAccounts, settlePaylaterPayment, type SettlePaylaterPaymentBody } from '../../generated/client';
import { unwrapGenerated } from '../core/generated-response';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';

export type PaylaterPageData = {
  obligations: Awaited<ReturnType<typeof getPaylaterObligations>>['data'];
  accounts: Array<{ id: number; name: string; type: string; systemKey: string | null }>;
};

/** Loads PayLater obligations and the wallet lookup used by its settlement form. */
export function usePaylaterQuery() {
  return useQuery<PaylaterPageData>({
    queryKey: queryKeys.paylater.all,
    queryFn: async () => {
      const [obligations, accounts] = await Promise.all([
        unwrapGenerated(getPaylaterObligations(), 200, 'Failed to load PayLater obligations'),
        unwrapGenerated(listAccounts(), 200, 'Failed to load accounts'),
      ]);
      return {
        obligations,
        accounts: accounts.map((account) => ({
          id: account.id,
          name: account.name,
          type: account.type,
          systemKey: account.systemKey,
        })),
      };
    },
    placeholderData: (previous) => previous,
  });
}

export function useSettlePaylaterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SettlePaylaterPaymentBody) => unwrapGenerated(settlePaylaterPayment(input), 201, 'Failed to settle PayLater payment'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}
