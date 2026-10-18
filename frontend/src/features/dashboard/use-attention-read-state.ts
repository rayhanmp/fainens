import { useEffect, useMemo, useState } from 'react';
import { attentionReadKey, parseAttentionReadKeys, serializeAttentionReadKeys, type Attention } from './attention';

const readStoragePrefix = 'fainens.dashboard.notifications.read';

export type AttentionReadState = {
  /** Items not yet marked read, in their original order. */
  unread: Attention[];
  isRead: (item: Attention) => boolean;
  markRead: (item: Attention) => void;
  markAllRead: () => void;
  /** Reverses a mark-read, for Undo. */
  markUnread: (items: readonly Attention[]) => void;
};

/**
 * Which notifications the user has marked read, kept in browser storage per user.
 * Call it once per page and share the result, so the bell and the attention strip agree.
 */
export function useAttentionReadState(items: readonly Attention[], userEmail: string | undefined): AttentionReadState {
  const storageKey = `${readStoragePrefix}:${userEmail ?? 'default'}`;
  const [readKeys, setReadKeys] = useState<Set<string>>(() => new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      setReadKeys(new Set(parseAttentionReadKeys(localStorage.getItem(storageKey))));
    } catch {
      setReadKeys(new Set());
    } finally {
      setLoaded(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(storageKey, serializeAttentionReadKeys(readKeys));
    } catch {
      // Browser storage can be unavailable in private or restricted contexts.
    }
  }, [loaded, readKeys, storageKey]);

  const unread = useMemo(() => items.filter((item) => !readKeys.has(attentionReadKey(item))), [items, readKeys]);
  return {
    unread,
    isRead: (item: Attention) => readKeys.has(attentionReadKey(item)),
    markRead: (item: Attention) => setReadKeys((current) => new Set(current).add(attentionReadKey(item))),
    markAllRead: () => setReadKeys((current) => {
      const next = new Set(current);
      items.forEach((item) => next.add(attentionReadKey(item)));
      return next;
    }),
    markUnread: (restored: readonly Attention[]) => setReadKeys((current) => {
      const next = new Set(current);
      restored.forEach((item) => next.delete(attentionReadKey(item)));
      return next;
    }),
  };
}
