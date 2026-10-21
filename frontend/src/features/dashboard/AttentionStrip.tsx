import { Link } from '@tanstack/react-router';
import { ArrowRight, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { attentionStripItems, type Attention } from './attention';
import { microLabel } from './panel-styles';
import type { AttentionReadState } from './use-attention-read-state';
import { markReadWithUndo } from './attention-undo';

const toneDot = { danger: 'bg-rose-500', warning: 'bg-amber-500', info: 'bg-sky-500' } as const;
const toneRing = { danger: 'ring-rose-500/30', warning: 'ring-amber-500/30', info: 'ring-sky-500/30' } as const;

/** The most urgent unread notifications as one slim row of chips under the hero. Renders nothing when there is nothing to show. */
export function AttentionStrip({ items, readState, maskAmounts }: {
  items: readonly Attention[];
  readState: AttentionReadState;
  maskAmounts: (text: string) => string;
}) {
  const shown = attentionStripItems(items, readState.isRead);
  if (shown.length === 0) return null;
  return (
    <section aria-label="Needs attention" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className={cn(microLabel, 'text-[var(--ref-on-surface-variant)]')}>Needs attention</p>
      <ul className="flex min-w-0 flex-wrap items-center gap-2">
        {shown.map((item) => (
          // On phones the chip is a card whose title can wrap; a one-line pill would cut it in half.
          <li key={item.id} title={maskAmounts(item.detail)} className="flex min-w-0 max-w-full items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] py-1 pl-3 pr-1 text-xs shadow-sm sm:rounded-full">
            <span className={cn('h-2 w-2 shrink-0 rounded-full ring-[3px]', toneDot[item.tone], toneRing[item.tone])} aria-hidden />
            <span className="min-w-0 font-bold leading-snug text-[var(--ref-on-surface)] sm:truncate">{item.title}</span>
            <Link to={item.to} search={item.search} className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap font-bold text-[var(--ref-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ref-primary)]">{item.action} <ArrowRight className="h-3 w-3" aria-hidden /></Link>
            <button type="button" onClick={() => markReadWithUndo(readState, [item])} aria-label={`Mark "${item.title}" read`} title="Mark read" className="grid h-6 w-6 shrink-0 place-items-center pointer-coarse:h-8 pointer-coarse:w-8 rounded-full text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-high)] hover:text-[var(--ref-on-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)]"><X className="h-3.5 w-3.5" /></button>
          </li>
        ))}
      </ul>
    </section>
  );
}
