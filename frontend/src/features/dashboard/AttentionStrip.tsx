import { Link } from '@tanstack/react-router';
import { ArrowRight, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { attentionStripItems, type Attention } from './attention';
import { microLabel } from './panel-styles';
import type { AttentionReadState } from './use-attention-read-state';

const toneDot = { danger: 'bg-rose-500', warning: 'bg-amber-500', info: 'bg-sky-500' } as const;
const toneRow = {
  danger: 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30',
  warning: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30',
  info: 'border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]',
} as const;

/** The most urgent unread notifications, inline under the hero. Renders nothing when there is nothing to show. */
export function AttentionStrip({ items, readState, maskAmounts }: {
  items: readonly Attention[];
  readState: AttentionReadState;
  maskAmounts: (text: string) => string;
}) {
  const shown = attentionStripItems(items, readState.isRead);
  if (shown.length === 0) return null;
  return (
    <section aria-label="Needs attention">
      <p className={cn(microLabel, 'mb-2 text-[var(--ref-on-surface-variant)]')}>Needs attention</p>
      <ul className="grid gap-2 md:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]">
        {shown.map((item) => (
          <li key={item.id} className={cn('flex min-w-0 items-start gap-2.5 rounded-2xl border px-3.5 py-2.5', toneRow[item.tone])}>
            <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', toneDot[item.tone])} aria-hidden />
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-sm text-[var(--ref-on-surface)]">{item.title}</strong>
              <span className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">{maskAmounts(item.detail)}</span>
              <Link to={item.to} className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-[var(--ref-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ref-primary)]">{item.action} <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
            </span>
            <button type="button" onClick={() => readState.markRead(item)} aria-label={`Mark "${item.title}" read`} title="Mark read" className="-mr-1 -mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--ref-on-surface-variant)] hover:bg-black/5 hover:text-[var(--ref-on-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)] dark:hover:bg-white/10"><X className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
    </section>
  );
}
