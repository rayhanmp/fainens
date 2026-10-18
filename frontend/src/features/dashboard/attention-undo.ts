import { toast } from '../../components/ui/useToast';
import type { Attention } from './attention';
import type { AttentionReadState } from './use-attention-read-state';

/** Marks notifications read and offers a short Undo, since a dismissed item is otherwise gone from view. */
export function markReadWithUndo(readState: AttentionReadState, items: readonly Attention[]) {
  const unread = items.filter((item) => !readState.isRead(item));
  if (unread.length === 0) return;
  if (unread.length === 1) readState.markRead(unread[0]);
  else readState.markAllRead();
  toast.show({
    type: 'info',
    title: unread.length === 1 ? 'Marked as read' : `${unread.length} notifications marked as read`,
    message: unread.length === 1 ? unread[0].title : undefined,
    duration: 6000,
    action: { label: 'Undo', onClick: () => readState.markUnread(unread) },
  });
}
