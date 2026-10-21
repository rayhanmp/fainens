import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { getPeriodRecap, getRecapHighlightState, getSavedRecapStory, listRecapPeriods, markRecapHighlightSeen, writeRecapStory, type GetPeriodRecap200, type WriteRecapStory200 } from '../../generated/client';
import { queryKeys } from '../core/query-keys';
import { unwrapGenerated } from '../core/generated-response';

export type PeriodRecap = GetPeriodRecap200;
export type SavedRecapStory = WriteRecapStory200;
const storyKey = (periodId: number) => [...queryKeys.reports.all, 'recap-story', periodId];
const previewKey = (periodId: number) => [...queryKeys.reports.all, 'recap-preview', periodId];
const highlightStateKey = (periodId: number) => [...queryKeys.reports.all, 'recap-highlight-state', periodId];

export function useRecapHighlightState(periodId: number | undefined) {
  return useQuery({
    queryKey: highlightStateKey(periodId ?? 0), enabled: Boolean(periodId), staleTime: 0, retry: false,
    queryFn: ({ signal }) => unwrapGenerated(getRecapHighlightState(periodId!, { signal }), 200, 'Unable to check whether this recap was seen.'),
  });
}

export function useMarkRecapHighlightSeen(periodId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await markRecapHighlightSeen(periodId);
      if (response.status !== 200) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: state => queryClient.setQueryData(highlightStateKey(periodId), state),
  });
}

export function useRecapPreview(periodId: number | undefined) {
  return useQuery({
    queryKey: previewKey(periodId ?? 0), enabled: Boolean(periodId),
    queryFn: ({ signal }) => unwrapGenerated(getSavedRecapStory(periodId!, { signal }), 200, 'Unable to load the saved edition.'),
  });
}

export function useRecapStory(periodId: number | undefined) {
  const queryClient = useQueryClient();
  return useQuery({
    // A running period's edition is refreshed by the server once a day, so an app left open is asked again after an hour.
    // The viewer is keyed by savedAt: a same-day answer changes nothing on screen.
    queryKey: storyKey(periodId ?? 0), enabled: Boolean(periodId), staleTime: 60 * 60_000, retry: false,
    queryFn: async ({ signal }) => {
      const story = await unwrapGenerated(writeRecapStory(periodId!, { regenerate: false }, { signal }), 200, 'Your recap could not be prepared. Please try again.');
      queryClient.setQueryData(previewKey(periodId!), { story });
      return story;
    },
  });
}

export function useRegenerateRecap(periodId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await writeRecapStory(periodId, { regenerate: true });
      if (response.status !== 200) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: story => {
      queryClient.setQueryData(storyKey(periodId), story);
      queryClient.setQueryData(previewKey(periodId), { story });
    },
  });
}

export function useRecapArchive() {
  return useQuery({
    queryKey: [...queryKeys.reports.all, 'recaps'],
    queryFn: ({ signal }) => unwrapGenerated(listRecapPeriods({ signal }), 200, 'Unable to load your recap archive.'),
  });
}

/** Every period's live recap for a year in review, ready once all of them have loaded. */
export function useYearRecaps(periodIds: number[]) {
  return useQueries({
    queries: periodIds.map(periodId => ({
      queryKey: [...queryKeys.reports.all, 'recap', periodId],
      queryFn: ({ signal }: { signal: AbortSignal }) => unwrapGenerated(getPeriodRecap(periodId, { signal }), 200, 'Unable to load this period’s recap.'),
    })),
    combine: results => ({
      data: results.length && results.every(result => result.data) ? results.map(result => result.data!) : undefined,
      isPending: results.some(result => result.isPending),
      error: results.find(result => result.error)?.error ?? null,
    }),
  });
}

export function usePeriodRecap(periodId: number | undefined) {
  return useQuery({
    queryKey: [...queryKeys.reports.all, 'recap', periodId],
    queryFn: ({ signal }) => unwrapGenerated(getPeriodRecap(periodId!, { signal }), 200, 'Unable to load this period’s recap.'),
    enabled: Boolean(periodId),
  });
}
