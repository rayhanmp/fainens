import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { History } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { cn } from '../../../lib/utils';
import { usePageVersionQuery, usePageVersionsQuery } from './queries';
import { readableMarkdown } from './notes-utils';

const when = (time: number) => {
  const date = new Date(time);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? `Today, ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
    : date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric', hour: '2-digit', minute: '2-digit' });
};

/**
 * Earlier copies of a page, kept as it changes: pick one to read it, and restore it if you want
 * it back. What's there now is kept as a copy too, so a restore can be undone.
 */
export function HistoryDialog({ pageId, pageTitle, restoring, onRestore, onClose }: { pageId: number; pageTitle: string; restoring: boolean; onRestore: (versionId: number) => void; onClose: () => void }) {
  const versions = usePageVersionsQuery(pageId);
  const [picked, setPicked] = useState<number | null>(null);
  const shown = picked ?? versions.data?.[0]?.id ?? null;
  const version = usePageVersionQuery(shown);
  const list = versions.data ?? [];

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`History of ${pageTitle}`}
      subtitle="A copy is kept as you write, at most one every ten minutes, the last fifty."
      size="xl"
      footer={(
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>Close</Button>
          <Button type="button" size="sm" disabled={shown === null} isLoading={restoring} onClick={() => shown !== null && onRestore(shown)}>Restore this copy</Button>
        </div>
      )}
    >
      {versions.isPending ? (
        <p className="text-sm text-[var(--ref-on-surface-variant)]">Loading…</p>
      ) : list.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl bg-[var(--ref-surface-container-low)] px-4 py-6 text-sm text-[var(--ref-on-surface-variant)]">
          <History className="h-5 w-5 shrink-0" aria-hidden />No earlier copies yet. They’re kept as you change the page.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
          <ul className="max-h-[50vh] overflow-y-auto rounded-xl border border-[var(--color-border)]" role="listbox" aria-label="Copies">
            {list.map((item) => (
              <li key={item.id} role="option" aria-selected={item.id === shown}>
                <button type="button" onClick={() => setPicked(item.id)} className={cn('block w-full border-b border-[var(--color-border)] px-3 py-2 text-left last:border-0', item.id === shown ? 'bg-[var(--ref-primary)]/10' : 'hover:bg-[var(--ref-surface-container-low)]')}>
                  <span className="block text-sm font-medium text-[var(--ref-on-surface)]">{when(item.createdAt)}</span>
                  <span className="block truncate text-xs text-[var(--ref-on-surface-variant)]">{readableMarkdown(item.preview) || 'Empty'}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="goal-notes-editor max-h-[50vh] min-h-[200px] overflow-y-auto rounded-xl border border-[var(--color-border)] px-4 py-3">
            {version.isPending ? <p className="text-sm text-[var(--ref-on-surface-variant)]">Loading…</p> : <ReactMarkdown remarkPlugins={[remarkGfm]}>{readableMarkdown(version.data?.content ?? '')}</ReactMarkdown>}
          </div>
        </div>
      )}
    </Modal>
  );
}
