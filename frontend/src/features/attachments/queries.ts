import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteAttachment,
  getAttachmentDownloadUrl,
  listAttachments,
  uploadAttachment,
  type UploadAttachmentBody,
} from '../../generated/client';
import { unwrapGenerated } from '../core/generated-response';
import { queryKeys } from '../core/query-keys';

export function useAttachmentsQuery(transactionId: number | null) {
  return useQuery({
    queryKey: queryKeys.attachments.transaction(transactionId),
    queryFn: ({ signal }) => unwrapGenerated(
      listAttachments({ transactionId: String(transactionId!) }, { signal }),
      200,
      'Failed to load attachments',
    ),
    enabled: transactionId != null,
  });
}

/** Download URLs are short-lived, so keep them in a query and let the cache own their lifecycle. */
export function useAttachmentDownload() {
  const queryClient = useQueryClient();
  return useCallback((attachmentId: number) => queryClient.fetchQuery({
    queryKey: queryKeys.attachments.download(attachmentId),
    queryFn: ({ signal }) => unwrapGenerated(getAttachmentDownloadUrl(attachmentId, { expiresIn: '3600' }, { signal }), 200, 'Failed to get attachment URL'),
    staleTime: 5 * 60 * 1000,
  }), [queryClient]);
}

export function useDeleteAttachmentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: number) => unwrapGenerated(deleteAttachment(attachmentId), [202, 204], 'Failed to delete attachment'),
    onSuccess: (_data, attachmentId) => {
      queryClient.removeQueries({ queryKey: queryKeys.attachments.download(attachmentId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.attachments.all });
    },
  });
}

export type UploadAttachmentInput = Omit<UploadAttachmentBody, 'contentType'> & { contentType: string };

export async function uploadAttachmentRequest(input: UploadAttachmentInput) {
  return unwrapGenerated(uploadAttachment(input as UploadAttachmentBody), 201, 'Failed to upload attachment');
}
