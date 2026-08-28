import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';

export type LoansPageData = {
  loans: Awaited<ReturnType<typeof api.loans.list>>;
  contacts: Awaited<ReturnType<typeof api.contacts.list>>;
  summary: Awaited<ReturnType<typeof api.loans.summary>>;
};

/** Aggregates the records needed by the loans screen into one server-state query. */
export function useLoansQuery() {
  return useQuery<LoansPageData>({
    queryKey: queryKeys.loans.all,
    queryFn: async () => {
      const [activeLoans, repaidLoans, contacts, summary] = await Promise.all([
        api.loans.list({ status: 'active' }),
        api.loans.list({ status: 'repaid' }),
        api.contacts.list(),
        api.loans.summary(),
      ]);
      return { loans: [...activeLoans, ...repaidLoans], contacts, summary };
    },
    placeholderData: (previous) => previous,
  });
}

export function useDeleteLoanMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.loans.delete(id),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}
