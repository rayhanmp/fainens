import { Link } from '@tanstack/react-router';
import { ArrowRight, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { attentionStripItems, type Attention } from './attention';
import { microLabel } from './panel-styles';
import type { AttentionReadState } from './use-attention-read-state';

const toneDot = { danger: 'bg-rose-500', warning: 'bg-amber-500', info: 'bg-sky-500' } as const;
const toneRing = { danger: 'ring-rose-500/30', warning: 'ring-amber-500/30', info: 'ring-sky-500/30' } as const;

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
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((item) => (
          <li key={item.id} className="flex min-w-0 items-start gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] px-4 py-3 shadow-sm">
            <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4', toneDot[item.tone], toneRing[item.tone])} aria-hidden />
            <span className="min-w-0 flex-1">
              <strong className="block text-sm leading-snug text-[var(--ref-on-surface)]">{item.title}</strong>
              <span className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">{maskAmounts(item.detail)}</span>
              <Link to={item.to} className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-[var(--ref-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ref-primary)]">{item.action} <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
            </span>
            <button type="button" onClick={() => readState.markRead(item)} aria-label={`Mark "${item.title}" read`} title="Mark read" className="-mr-1 -mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-high)] hover:text-[var(--ref-on-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)]"><X className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
    </section>
  );
}
