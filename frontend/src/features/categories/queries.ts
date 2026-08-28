import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listCategories } from '../../generated/client';
import { api } from '../../lib/api';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';

export const useCategoriesQuery = () => useQuery({
  queryKey: queryKeys.categories.all,
  queryFn: async ({ signal }) => (await listCategories({ signal })).data,
});

export function useCreateCategoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.categories.create>[0]) => api.categories.create(input),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useUpdateCategoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof api.categories.update>[1] }) => api.categories.update(id, data),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useDeleteCategoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.categories.delete(id),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useRestoreCategoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.categories.restore(id),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useCreateTagMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.tags.create>[0]) => api.tags.create(input),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useUpdateTagMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof api.tags.update>[1] }) => api.tags.update(id, data),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useDeleteTagMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.tags.delete(id),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}
