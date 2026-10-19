import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  archiveCategory,
  createCategory,
  createTag,
  createTagGroup,
  deleteTag,
  deleteTagGroup,
  listCategories,
  listTags,
  restoreCategory,
  updateCategory,
  updateTag,
  updateTagGroup,
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

export const useTagsQuery = () => useQuery({
  queryKey: queryKeys.tags.all,
  queryFn: async ({ signal }) => {
    const response = await listTags({ signal });
    if (response.status !== 200) throw new Error('Failed to load tags');
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

/**
 * File a tag under a group (or none), applied to the categories page right away so dragging feels
 * instant, and rolled back if the server refuses. Groups are organisational only.
 */
export function useMoveTagMutation() {
  const queryClient = useQueryClient();
  const pageKey = queryKeys.categories.list(true);
  type PageData = { tags: Array<{ id: number; groupId?: number | null }> } | undefined;
  return useMutation({
    mutationFn: ({ id, groupId }: { id: number; groupId: number | null }) => unwrapGenerated(updateTag(id, { groupId }), 200, 'Failed to move tag'),
    onMutate: async ({ id, groupId }) => {
      await queryClient.cancelQueries({ queryKey: pageKey });
      const previous = queryClient.getQueryData<PageData>(pageKey);
      queryClient.setQueryData<PageData>(pageKey, (data) => data && { ...data, tags: data.tags.map((tag) => (tag.id === id ? { ...tag, groupId } : tag)) });
      return { previous };
    },
    onError: (_error, _input, context) => queryClient.setQueryData(pageKey, context?.previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.categories.all }),
  });
}

export function useCreateTagGroupMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => unwrapGenerated(createTagGroup({ name }), 201, 'Failed to create tag group'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.categories.all }),
  });
}

export function useUpdateTagGroupMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateTagGroup>[1] }) => unwrapGenerated(updateTagGroup(id, data), 200, 'Failed to update tag group'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.categories.all }),
  });
}

export function useDeleteTagGroupMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrapGenerated(deleteTagGroup(id), 204, 'Failed to delete tag group'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.categories.all }),
  });
}

export function useDeleteTagMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrapGenerated(deleteTag(id), 204, 'Failed to delete tag'),
    onSuccess: () => invalidateFinancialSummaries(queryClient),
  });
}
