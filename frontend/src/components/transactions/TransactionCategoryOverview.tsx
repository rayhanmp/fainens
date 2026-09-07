import { useState } from 'react';
import { cn, formatCurrency } from '../../lib/utils';

export interface CategoryOverviewItem {
  name: string;
  amountCents: number;
  share: number;
  color?: string | null;
}

interface Props {
  items?: CategoryOverviewItem[];
  loading: boolean;
  updating: boolean;
  onSelect: (name: string) => void;
}

/** A compact ranked breakdown that supports the transaction list without taking it over. */
export function TransactionCategoryOverview({ items, loading, updating, onSelect }: Props) {
  const visibleItems = items?.slice(0, 4) ?? [];
  const fallbackColorClasses = ['bg-emerald-500', 'bg-amber-500', 'bg-sky-500', 'bg-slate-400'] as const;
  const [hoveredItem, setHoveredItem] = useState<CategoryOverviewItem | null>(null);
  return <div aria-label="Top spending categories" aria-busy={loading || updating} className="w-full border-t border-[var(--color-border)] pt-2 sm:w-64 sm:shrink-0 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
    <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--ref-on-surface-variant)]">
      <span>Top categories</span>
      {updating && <span>Updating…</span>}
    </div>
    {loading ? <div role="status" className="text-xs text-[var(--ref-on-surface-variant)]">Loading…</div>
      : !items?.length ? <p className="text-xs text-[var(--ref-on-surface-variant)]">No category breakdown</p>
      : <>
        <div className="relative mt-2">
          <div className="flex h-2 overflow-hidden rounded-full bg-[var(--ref-surface-container-low)]" aria-label="Share of spending by category">
            {visibleItems.map((item, index) => <span key={item.name} role="img" aria-label={`${item.name}: ${formatCurrency(item.amountCents)}, ${Math.round(item.share * 100)}%`} title={`${item.name}: ${formatCurrency(item.amountCents)} (${Math.round(item.share * 100)}%)`} onMouseEnter={() => setHoveredItem(item)} onMouseLeave={() => setHoveredItem(null)} className={cn('h-full transition-opacity', !item.color && fallbackColorClasses[index], updating && 'opacity-50')} style={{ width: `${Math.max(2, item.share * 100)}%`, ...(item.color ? { backgroundColor: item.color } : {}) }} />)}
          </div>
          {hoveredItem && <div role="status" className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[var(--ref-on-surface)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--ref-surface-container-lowest)] shadow-lg"><strong>{hoveredItem.name}</strong><span className="ml-1.5">{formatCurrency(hoveredItem.amountCents)} · {Math.round(hoveredItem.share * 100)}%</span></div>}
        </div>
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 overflow-x-auto text-[10px] text-[var(--ref-on-surface-variant)] [scrollbar-width:none]">
          {visibleItems.map((item, index) => item.name === 'Other categories' ? <span key={item.name} title={`${item.name}: ${formatCurrency(item.amountCents)} (${Math.round(item.share * 100)}%)`} className="inline-flex shrink-0 items-center gap-1 px-1 py-0.5"><span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', !item.color && fallbackColorClasses[index])} style={item.color ? { backgroundColor: item.color } : undefined} /><span className="whitespace-nowrap">{item.name}</span><span className="tabular-nums">{Math.round(item.share * 100)}%</span></span> : <button key={item.name} type="button" disabled={updating} onClick={() => onSelect(item.name)} title={`${item.name}: ${formatCurrency(item.amountCents)} (${Math.round(item.share * 100)}%)`} className="inline-flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 hover:bg-[var(--ref-surface-container-low)] disabled:opacity-50"><span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', !item.color && fallbackColorClasses[index])} style={item.color ? { backgroundColor: item.color } : undefined} /><span className="whitespace-nowrap">{item.name}</span><span className="tabular-nums">{Math.round(item.share * 100)}%</span></button>)}
        </div>
      </>}
  </div>;
}
