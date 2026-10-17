import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Bell } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useUiStore } from '../../stores/ui-store';
import { attentionReadKey, parseAttentionReadKeys, serializeAttentionReadKeys, type Attention } from './attention';

const readStoragePrefix = 'fainens.dashboard.notifications.read';

function useAttentionReadState(items: readonly Attention[], userEmail: string | undefined) {
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
  };
}

export function DashboardNotifications({ items, userEmail, maskAmounts }: {
  items: readonly Attention[];
  userEmail: string | undefined;
  maskAmounts: (text: string) => string;
}) {
  const popoverRef = useRef<HTMLDetailsElement>(null);
  const { unread, isRead, markRead, markAllRead } = useAttentionReadState(items, userEmail);
  const setDashboardNotificationCount = useUiStore((state) => state.setDashboardNotificationCount);

  useEffect(() => {
    setDashboardNotificationCount(unread.length);
  }, [setDashboardNotificationCount, unread.length]);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const popover = popoverRef.current;
      if (popover?.open && event.target instanceof Node && !popover.contains(event.target)) popover.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && popoverRef.current?.open) popoverRef.current.open = false;
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  return (
    <details ref={popoverRef} className="group relative">
      <summary className="relative grid h-11 w-11 cursor-pointer list-none place-items-center rounded-full border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] text-[var(--ref-on-surface-variant)] shadow-sm transition-colors hover:bg-[var(--ref-surface-container-low)] [&::-webkit-details-marker]:hidden" aria-label="Dashboard notifications">
        <Bell className="h-5 w-5" />
        {unread.length > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-[var(--color-background)]">{Math.min(unread.length, 9)}</span>}
      </summary>
      <div className="absolute right-0 top-[calc(100%+0.65rem)] z-40 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3 shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-2 py-1">
          <h2 className="font-headline text-base font-extrabold">Notifications</h2>
          <div className="flex items-center gap-2"><span className="text-xs text-[var(--ref-on-surface-variant)]">{unread.length || 'All clear'}</span>{unread.length > 0 && <button type="button" onClick={markAllRead} className="text-[11px] font-bold text-[var(--ref-primary)] hover:underline">Mark all read</button>}</div>
        </div>
        {items.length === 0 ? <p className="px-2 py-5 text-sm text-[var(--ref-on-surface-variant)]">Nothing needs your attention right now.</p> : <div className="mt-2 divide-y divide-[var(--color-border)]">{items.map((item) => {
          const read = isRead(item);
          return <div key={item.id} className={cn('flex items-start gap-2', read && 'opacity-60')}>
            <Link to={item.to} className="flex min-w-0 flex-1 gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-[var(--ref-surface-container-low)]">
              <span className={cn('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', read ? 'bg-slate-400' : item.tone === 'danger' ? 'bg-rose-500' : item.tone === 'warning' ? 'bg-amber-500' : 'bg-sky-500')} />
              <span className="min-w-0"><strong className="block text-sm">{item.title}</strong><span className="mt-0.5 block text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">{maskAmounts(item.detail)}</span><span className="mt-1.5 block text-xs font-bold text-[var(--ref-primary)]">{item.action}</span></span>
            </Link>
            <button type="button" onClick={() => markRead(item)} className="mt-3 shrink-0 px-1 text-[10px] font-bold text-[var(--ref-on-surface-variant)] hover:text-[var(--ref-primary)] hover:underline">{read ? 'Read' : 'Mark read'}</button>
          </div>;
        })}</div>}
      </div>
    </details>
  );
}
