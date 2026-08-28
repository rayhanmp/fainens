import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';

export type SalaryIncomeRow = {
  id: number;
  date: number;
  description: string;
  txType: string;
  incomeCents: number;
};

export function useSalaryIncomeQuery() {
  return useQuery({
    queryKey: queryKeys.salary.income,
    queryFn: async () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 5, 1).getTime();
      const [factsResult, accounts] = await Promise.all([
        api.agent.financialFacts({ startDate: start, endDate: Date.now() }),
        api.accounts.list(),
      ]);
      return {
        transactions: factsResult.data.facts.rows
          .filter((row) => row.incomeCents > 0)
          .map((row): SalaryIncomeRow => ({
            id: row.id,
            date: row.date,
            description: row.description,
            txType: row.txType,
            incomeCents: row.incomeCents,
          })),
        accounts: accounts.map((account) => ({ id: account.id, name: account.name, type: account.type })),
      };
    },
    placeholderData: (previous) => previous,
  });
}

export function useSalarySettingsQuery() {
  return useQuery({
    queryKey: queryKeys.salary.settings,
    queryFn: () => api.salarySettings.get(),
    placeholderData: (previous) => previous,
  });
}

export function useSalaryCatchUpPreviewQuery() {
  return useQuery({
    queryKey: queryKeys.salary.catchUpPreview,
    queryFn: () => api.salarySettings.catchUpPreview(),
    enabled: false,
  });
}

export function useUpdateSalarySettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.salarySettings.update>[0]) => api.salarySettings.update(input),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.salary.settings, data);
      void invalidateFinancialSummaries(queryClient);
    },
  });
}

export function useSalaryCatchUpMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.salarySettings.catchUp>[0]) => api.salarySettings.catchUp(input),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}
