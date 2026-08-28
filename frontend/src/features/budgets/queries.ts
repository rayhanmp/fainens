import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';

export const useBudgetQuery = (periodId?: number) => useQuery({
  queryKey: periodId == null ? queryKeys.budgets.all : queryKeys.budgets.period(periodId),
  queryFn: () => api.budgets.list(periodId == null ? undefined : String(periodId)),
  placeholderData: (previous) => previous,
});

export const useBudgetOutlookQuery = (periodId?: number) => useQuery({
  queryKey: periodId == null ? [...queryKeys.budgets.all, 'outlook'] : queryKeys.budgets.outlook(periodId),
  queryFn: () => periodId == null ? Promise.resolve(null) : api.budgets.outlook(periodId),
  enabled: periodId != null,
  placeholderData: (previous) => previous,
});

export function useBudgetPeriodsQuery() {
  return useQuery({
    queryKey: queryKeys.periods.all,
    queryFn: () => api.periods.list(),
    placeholderData: (previous) => previous,
  });
}

export function useBudgetCategoriesQuery() {
  return useQuery({
    queryKey: queryKeys.categories.all,
    queryFn: () => api.categories.list(),
    placeholderData: (previous) => previous,
  });
}

export function useBudgetComparisonQuery(periodId: number | null, comparePeriodId: number | null) {
  const enabled = periodId != null && comparePeriodId != null && periodId !== comparePeriodId;
  return useQuery({
    queryKey: queryKeys.budgets.comparison(periodId ?? 0, comparePeriodId ?? 0),
    queryFn: () => api.budgets.compare(String(periodId), String(comparePeriodId)),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useBudgetTemplatesQuery() {
  return useQuery({
    queryKey: queryKeys.budgets.templates,
    queryFn: () => api.budgets.templates.list(),
    placeholderData: (previous) => previous,
  });
}

export function useCreateBudgetMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.budgets.create>[0]) => api.budgets.create(input),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useUpdateBudgetMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof api.budgets.update>[1] }) => api.budgets.update(id, data),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useDeleteBudgetMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.budgets.delete(id),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useCreateBudgetTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.budgets.templates.create>[0]) => api.budgets.templates.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.budgets.templates }),
  });
}

export function useApplyBudgetTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, data }: { templateId: number; data: Parameters<typeof api.budgets.templates.apply>[1] }) => api.budgets.templates.apply(templateId, data),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useDeleteBudgetTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.budgets.templates.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.budgets.templates }),
  });
}
