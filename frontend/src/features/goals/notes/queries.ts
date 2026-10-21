import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addGoalPage,
  deleteGoalPage,
  getGoalPageVersion,
  listGoalDueTasks,
  listGoalPages,
  listGoalPageVersions,
  reorderGoalPages,
  restoreGoalPageVersion,
  searchGoalNotes,
  updateGoalPage,
  type ListGoalPages200Item,
} from '../../../generated/client';
import { unwrapGenerated } from '../../core/generated-response';
import { queryKeys } from '../../core/query-keys';

export type NotePage = ListGoalPages200Item;

export function useGoalPagesQuery(goalId: number) {
  return useQuery({
    queryKey: queryKeys.goals.pages(goalId),
    queryFn: ({ signal }) => unwrapGenerated(listGoalPages(goalId, { signal }), 200, 'We couldn’t load the notes'),
  });
}

/** Page changes refresh the pages, and the due items the Dashboard reminds you of. */
function usePageMutation<TInput, TResult>(goalId: number, run: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.goals.pages(goalId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.goals.tasks });
    },
  });
}

export const useAddPageMutation = (goalId: number) => usePageMutation(goalId, (body: { title: string; content?: string }) => unwrapGenerated(addGoalPage(goalId, body), 201, 'Could not add the page'));
export const useDeletePageMutation = (goalId: number) => usePageMutation(goalId, (id: number) => unwrapGenerated(deleteGoalPage(id), 204, 'Could not delete the page'));
export const useReorderPagesMutation = (goalId: number) => usePageMutation(goalId, (ids: number[]) => unwrapGenerated(reorderGoalPages(goalId, { ids }), 200, 'Could not move the page'));
export const useRenamePageMutation = (goalId: number) => usePageMutation(goalId, ({ id, title }: { id: number; title: string }) => unwrapGenerated(updateGoalPage(id, { title }), 200, 'Could not rename the page'));
export const useRestoreVersionMutation = (goalId: number) => usePageMutation(goalId, (versionId: number) => unwrapGenerated(restoreGoalPageVersion(versionId), 200, 'Could not restore it'));

/**
 * Saves a page's text. The cached pages aren't refetched while you type (the editor holds the
 * latest), only the due items are, as a checklist date may have changed.
 */
export function useSavePageMutation(goalId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id: number; content: string }) => unwrapGenerated(updateGoalPage(id, { content }), 200, 'Could not save the notes'),
    onSuccess: (page) => {
      queryClient.setQueryData<NotePage[]>(queryKeys.goals.pages(goalId), (pages) => pages?.map((item) => (item.id === page.id ? page : item)));
      void queryClient.invalidateQueries({ queryKey: queryKeys.goals.tasks });
      void queryClient.invalidateQueries({ queryKey: queryKeys.goals.versions(page.id) });
    },
  });
}

export function usePageVersionsQuery(pageId: number | null) {
  return useQuery({
    queryKey: queryKeys.goals.versions(pageId ?? 0),
    queryFn: ({ signal }) => unwrapGenerated(listGoalPageVersions(pageId!, { signal }), 200, 'We couldn’t load the history'),
    enabled: pageId !== null,
  });
}

export function usePageVersionQuery(versionId: number | null) {
  return useQuery({
    queryKey: ['goals', 'version', versionId ?? 0],
    queryFn: ({ signal }) => unwrapGenerated(getGoalPageVersion(versionId!, { signal }), 200, 'We couldn’t load that copy'),
    enabled: versionId !== null,
  });
}

/** Note pages across every goal that hold the words. */
export function useNotesSearchQuery(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: queryKeys.goals.search(q),
    queryFn: ({ signal }) => unwrapGenerated(searchGoalNotes({ q }, { signal }), 200, 'Search failed'),
    enabled: q.length >= 2,
    staleTime: 30_000,
  });
}

/** Unticked, dated checklist items in goals' notes, soonest first. */
export function useGoalDueTasksQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.goals.tasks,
    queryFn: ({ signal }) => unwrapGenerated(listGoalDueTasks({ signal }), 200, 'Failed to load goal tasks'),
    enabled,
  });
}
