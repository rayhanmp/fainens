import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  archiveCategory,
  createCategory,
  createTag,
  deleteTag,
  listCategories,
  restoreCategory,
  updateCategory,
  updateTag,
} from '../../generated/client';
import { invalidateFinancialSummaries, queryKeys } from '../core/query-keys';
import { unwrapGenerated } from '../core/generated-response';

export const useCategoriesQuery = () => useQuery({
  queryKey: queryKeys.categories.all,
  queryFn: async ({ signal }) => {
    const response = await listCategories(undefined, { signal });
    if (response.status !== 200) throw new Error('Failed to load categories');
    return response.data;
  },
});

export function useCreateCategoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof createCategory>[0]) => unwrapGenerated(createCategory(input), 201, 'Failed to create category'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useUpdateCategoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateCategory>[1] }) => unwrapGenerated(updateCategory(id, data), 200, 'Failed to update category'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useDeleteCategoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrapGenerated(archiveCategory(id), 204, 'Failed to archive category'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useRestoreCategoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrapGenerated(restoreCategory(id), 200, 'Failed to restore category'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useCreateTagMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof createTag>[0]) => unwrapGenerated(createTag(input), 201, 'Failed to create tag'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useUpdateTagMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateTag>[1] }) => unwrapGenerated(updateTag(id, data), 200, 'Failed to update tag'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}

export function useDeleteTagMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrapGenerated(deleteTag(id), 204, 'Failed to delete tag'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}
