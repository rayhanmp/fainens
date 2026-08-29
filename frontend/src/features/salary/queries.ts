import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchFinancialFacts } from '../agent/queries';
import {
  getSalarySettings,
  listAccounts,
  previewSalaryCatchUp,
  previewSalaryCalculation,
  processSalaryCatchUp,
  updateSalarySettings,
  type ProcessSalaryCatchUpBody,
  type UpdateSalarySettingsBody,
  type PreviewSalaryCalculationParams,
} from '../../generated/client';
import { unwrapGenerated } from '../core/generated-response';
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
    queryFn: async ({ signal }) => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 5, 1).getTime();
      const [factsResult, accounts] = await Promise.all([
        fetchFinancialFacts({ startDate: start, endDate: Date.now() }, { signal }),
        unwrapGenerated(listAccounts(undefined, { signal }), 200, 'Failed to load accounts'),
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
    queryFn: () => unwrapGenerated(getSalarySettings(), 200, 'Failed to load salary settings'),
    placeholderData: (previous) => previous,
  });
}

export function usePreviewSalaryCalculationMutation() {
  return useMutation({
    mutationFn: (params: PreviewSalaryCalculationParams) => unwrapGenerated(previewSalaryCalculation(params), 200, 'Failed to preview salary calculation'),
  });
}

export function useSalaryCatchUpPreviewQuery() {
  return useQuery({
    queryKey: queryKeys.salary.catchUpPreview,
    queryFn: () => unwrapGenerated(previewSalaryCatchUp(), 200, 'Failed to preview salary catch-up'),
    enabled: false,
  });
}

export function useUpdateSalarySettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSalarySettingsBody) => unwrapGenerated(updateSalarySettings(input), 200, 'Failed to update salary settings'),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.salary.settings, data);
      void invalidateFinancialSummaries(queryClient);
    },
  });
}

export function useSalaryCatchUpMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProcessSalaryCatchUpBody) => unwrapGenerated(processSalaryCatchUp(input), 200, 'Failed to process salary catch-up'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}
