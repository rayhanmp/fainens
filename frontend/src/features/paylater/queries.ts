import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { calculatePaylaterSchedule, getPaylaterObligations, listAccounts, recognizePaylaterPurchase, settlePaylaterPayment, type CalculatePaylaterScheduleBody, type RecognizePaylaterPurchaseBody, type SettlePaylaterPaymentBody } from '../../generated/client';
import { unwrapGenerated } from '../core/generated-response';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';

export type PaylaterPageData = {
  obligations: Awaited<ReturnType<typeof getPaylaterObligations>>['data'];
  accounts: Array<{ id: number; name: string; type: string; systemKey: string | null }>;
};

/** Loads PayLater obligations and the wallet lookup used by its settlement form. */
export function usePaylaterQuery(enabled = true) {
  return useQuery<PaylaterPageData>({
    queryKey: queryKeys.paylater.all,
    queryFn: async () => {
      const [obligations, accounts] = await Promise.all([
        unwrapGenerated(getPaylaterObligations(), 200, 'Failed to load PayLater obligations'),
        unwrapGenerated(listAccounts(), 200, 'Failed to load accounts'),
      ]);
      return {
        obligations: {
          ...obligations,
          scheduleItems: obligations.scheduleItems.map((item) => ({ ...item, kind: item.kind === 'interest' ? 'interest' as const : 'recognition' as const })),
        },
        accounts: accounts.map((account) => ({
          id: account.id,
          name: account.name,
          type: String(account.type),
          systemKey: typeof account.systemKey === 'string' ? account.systemKey : null,
        })),
      };
    },
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function useSettlePaylaterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SettlePaylaterPaymentBody) => unwrapGenerated(settlePaylaterPayment(input), 201, 'Failed to settle PayLater payment'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useCalculatePaylaterScheduleMutation() {
  return useMutation({
    mutationFn: (input: CalculatePaylaterScheduleBody) => unwrapGenerated(calculatePaylaterSchedule(input), 200, 'Failed to calculate PayLater schedule'),
  });
}

export function useRecognizePaylaterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RecognizePaylaterPurchaseBody) => unwrapGenerated(recognizePaylaterPurchase(input), 201, 'Failed to recognize PayLater purchase'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}
