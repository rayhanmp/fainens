import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../core/query-keys';

export type GallerySource = 'all' | 'transaction' | 'agent' | 'wishlist';
export type GalleryImage = Awaited<ReturnType<typeof api.gallery.list>> extends Array<infer T> ? T : never;

export function useGalleryImagesQuery(source: GallerySource, search: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.gallery.images(source, search),
    enabled,
    queryFn: () => api.gallery.list({
      ...(source !== 'all' ? { source } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
      limit: 100,
    }),
    staleTime: 5 * 60 * 1000,
  });
}

export function useDeleteGalleryImageMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ source, id }: { source: Exclude<GallerySource, 'all'>; id: number }) => api.gallery.delete(source, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gallery.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.attachments.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.wishlist.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agent.all });
    },
  });
}
