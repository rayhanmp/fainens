import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  applyBudgetTemplate,
  createBudget,
  createBudgetTemplate,
  deleteBudget,
  deleteBudgetTemplate,
  getBudgetOutlook,
  compareBudgets,
  listCategories,
  listBudgetTemplates,
  listBudgets,
  listPeriods,
  updateBudget,
  type ListBudgetsParams,
} from '../../generated/client';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';
import { unwrapGenerated } from '../core/generated-response';

export const useBudgetQuery = (periodId?: number) => useQuery({
  queryKey: periodId == null ? queryKeys.budgets.all : queryKeys.budgets.period(periodId),
  queryFn: () => unwrapGenerated(listBudgets(periodId == null ? undefined : { periodId: String(periodId) } satisfies ListBudgetsParams), 200, 'Failed to load budgets'),
  placeholderData: (previous) => previous,
});

export const useBudgetOutlookQuery = (periodId?: number) => useQuery({
  queryKey: periodId == null ? [...queryKeys.budgets.all, 'outlook'] : queryKeys.budgets.outlook(periodId),
  queryFn: () => periodId == null ? Promise.resolve(null) : unwrapGenerated(getBudgetOutlook(periodId), 200, 'Failed to load budget outlook'),
  enabled: periodId != null,
  placeholderData: (previous) => previous,
});

export function useBudgetPeriodsQuery() {
  return useQuery({
    queryKey: queryKeys.periods.all,
    queryFn: () => unwrapGenerated(listPeriods(), 200, 'Failed to load periods'),
    placeholderData: (previous) => previous,
  });
}

export function useBudgetCategoriesQuery() {
  return useQuery({
    queryKey: queryKeys.categories.all,
    queryFn: () => unwrapGenerated(listCategories(), 200, 'Failed to load categories'),
    placeholderData: (previous) => previous,
  });
}

export function useBudgetComparisonQuery(periodId: number | null, comparePeriodId: number | null) {
  const enabled = periodId != null && comparePeriodId != null && periodId !== comparePeriodId;
  return useQuery({
    queryKey: queryKeys.budgets.comparison(periodId ?? 0, comparePeriodId ?? 0),
    queryFn: () => unwrapGenerated(compareBudgets({ currentPeriodId: String(periodId), comparePeriodId: String(comparePeriodId) }), 200, 'Failed to compare budgets'),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useBudgetTemplatesQuery() {
  return useQuery({
    queryKey: queryKeys.budgets.templates,
    queryFn: () => unwrapGenerated(listBudgetTemplates(), 200, 'Failed to load budget templates'),
    placeholderData: (previous) => previous,
  });
}

export function useCreateBudgetMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof createBudget>[0]) => unwrapGenerated(createBudget(input), 201, 'Failed to create budget'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useUpdateBudgetMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateBudget>[1] }) => unwrapGenerated(updateBudget(id, data), 200, 'Failed to update budget'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useDeleteBudgetMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrapGenerated(deleteBudget(id), 204, 'Failed to delete budget'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useCreateBudgetTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof createBudgetTemplate>[0]) => unwrapGenerated(createBudgetTemplate(input), 201, 'Failed to create budget template'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.budgets.templates }),
  });
}

export function useApplyBudgetTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, data }: { templateId: number; data: Parameters<typeof applyBudgetTemplate>[1] }) => unwrapGenerated(applyBudgetTemplate(templateId, data), 200, 'Failed to apply budget template'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useDeleteBudgetTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrapGenerated(deleteBudgetTemplate(id), 204, 'Failed to delete budget template'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.budgets.templates }),
  });
}
