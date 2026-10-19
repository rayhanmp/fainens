import { useEffect, useMemo, useState } from 'react';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn } from '../../lib/utils';
import { CategoryIcon } from './CategoryIcon';
import { HabitMap } from './HabitMap';
import { useCategoryBreakdownQuery } from './page-queries';
import { squarify } from './treemap';
import { shortRupiah } from './short-rupiah';

type Metric = 'amount' | 'count';
type Range = '30d' | 'year' | 'all';

const METRICS: { id: Metric; label: string }[] = [
  { id: 'amount', label: 'Amount' },
  { id: 'count', label: 'Entries' },
];
const RANGES: { id: Range; label: string }[] = [
  { id: '30d', label: '30 days' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
];
/** Tiles past this many fold into one "Other" tile, so every tile stays big enough to read. */
const MAX_TILES = 9;
/** Layout size (px) until the treemap's real box has been measured. */
const FALLBACK_BOX = { w: 640, h: 256 };
const DAY = 86_400_000;


function bounds(range: Range, now: number): { from?: number; to?: number } {
  if (range === '30d') return { from: now - 30 * DAY, to: now };
  if (range === 'year') return { from: new Date(new Date(now).getFullYear(), 0, 1).getTime(), to: now };
  return {};
}

function Segmented<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string }[]; value: T; onChange: (value: T) => void; label: string }) {
  return (
    <div
      className={cn('ui-segmented inline-grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-[var(--ref-surface-container)] p-1', `ui-segmented--${options.length}`)}
      role="radiogroup"
      aria-label={label}
      data-segment-index={options.findIndex((option) => option.id === value)}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          onClick={() => onChange(option.id)}
          className={cn('rounded-lg px-2.5 py-1 text-xs font-semibold', option.id === value ? 'text-[var(--ref-on-surface)]' : 'text-[var(--ref-on-surface-variant)]')}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

type Row = { id: number; name: string; color: string | null; amount: number; count: number; average: number };

/**
 * Where the money goes: a treemap where each category's tile is its share of spending (or of
 * entries), drawn in the category's own colour and labelled on the tile, above a habit map of how
 * often and how much each time.
 */
export function CategoryBreakdown({ categories }: { categories: Array<{ id: number; name: string; color: string | null }> }) {
  const { formatAmount, balancesHidden } = useBalanceVisibility();
  const [metric, setMetric] = useState<Metric>('amount');
  const [range, setRange] = useState<Range>('year');
  const [hovered, setHovered] = useState<number | null>(null);
  // The treemap is laid out in its real pixel box, so tiles keep sensible shapes at any height.
  const [boxEl, boxRef] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState(FALLBACK_BOX);
  useEffect(() => {
    if (!boxEl) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setBox({ w: width, h: height });
    });
    observer.observe(boxEl);
    return () => observer.disconnect();
  }, [boxEl]);
  const [now] = useState(() => Date.now());
  const current = useCategoryBreakdownQuery(useMemo(() => bounds(range, now), [range, now]));

  const rows = useMemo<Row[]>(() => {
    const byId = new Map(categories.map((category) => [category.id, category]));
    return (current.data ?? [])
      .map((row) => {
        const category = byId.get(row.categoryId);
        const amount = Math.max(0, row.amount);
        return { id: row.categoryId, name: category?.name ?? 'Archived category', color: category?.color ?? null, amount, count: row.transactionCount, average: row.transactionCount > 0 ? Math.round(amount / row.transactionCount) : 0 };
      })
      .filter((row) => row.amount > 0 || row.count > 0);
  }, [current.data, categories]);

  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const totalCount = rows.reduce((sum, row) => sum + row.count, 0);
  const total = metric === 'amount' ? totalAmount : totalCount;
  const ordered = [...rows].filter((row) => row[metric] > 0).sort((a, b) => b[metric] - a[metric]);
  const shown = ordered.length > MAX_TILES ? ordered.slice(0, MAX_TILES - 1) : ordered;
  const folded = ordered.slice(shown.length);
  const tiles = [
    ...shown.map((row) => ({ key: row.id, row, value: row[metric] })),
    ...(folded.length > 0 ? [{ key: -1, row: null as Row | null, value: folded.reduce((sum, row) => sum + row[metric], 0) }] : []),
  ];
  const rects = squarify(tiles.map((tile) => tile.value), box.w, box.h);
  const share = (value: number) => (total > 0 ? Math.round((value / total) * 100) : 0);
  const show = (value: number) => (metric === 'amount' ? formatAmount(value) : `${value.toLocaleString('id-ID')} ${value === 1 ? 'entry' : 'entries'}`);

  const hoveredTile = tiles.find((tile) => tile.key === hovered) ?? null;

  return (
    <section className="flex h-full flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]">
      {/* Title and toggles share the top row; the summary runs underneath so the toggles stay top-right. */}
      <div className="border-b border-[var(--color-border)] px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h2 className="text-sm font-semibold text-[var(--ref-on-surface)]">Where the money goes</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Size tiles by" options={METRICS} value={metric} onChange={setMetric} />
            <Segmented label="Range" options={RANGES} value={range} onChange={setRange} />
          </div>
        </div>
        <p className="mt-0.5 text-xs text-[var(--ref-on-surface-variant)]">
          {formatAmount(totalAmount)} over {totalCount.toLocaleString('id-ID')} entries
        </p>
      </div>

      {current.isPending && !current.data ? (
        <p className="px-5 py-10 text-sm text-[var(--ref-on-surface-variant)]">Loading…</p>
      ) : tiles.length === 0 ? (
        <p className="px-5 py-10 text-sm text-[var(--ref-on-surface-variant)]">No categorized spending in this range.</p>
      ) : (
        <div className="flex flex-1 flex-col gap-4 p-4">
          {/* The treemap takes whatever height the card has left, so the card never ends in a gap. */}
          <div className="relative flex flex-1 flex-col">
            <div
              ref={boxRef}
              className={cn('relative min-h-60 w-full flex-1 transition-opacity', current.isFetching && 'opacity-60')}
              role="list"
              aria-label={`Categories by ${metric === 'amount' ? 'amount spent' : 'number of entries'}`}
              onMouseLeave={() => setHovered(null)}
            >
              {tiles.map((tile, index) => {
                const rect = rects[index];
                const width = (rect.w / box.w) * 100;
                const height = (rect.h / box.h) * 100;
                const tint = tile.row?.color ?? 'var(--ref-outline)';
                // Labels depend on the tile's real size in pixels.
                const roomy = rect.w > 78 && rect.h > 76;
                const compact = !roomy && rect.w > 40 && rect.h > 44;
                const name = tile.row?.name ?? `Other (${folded.length})`;
                return (
                  <div
                    key={tile.key}
                    role="listitem"
                    aria-label={`${name}: ${show(tile.value)}, ${share(tile.value)}%`}
                    className="absolute p-[2px]"
                    style={{ left: `${(rect.x / box.w) * 100}%`, top: `${(rect.y / box.h) * 100}%`, width: `${width}%`, height: `${height}%` }}
                    onMouseEnter={() => setHovered(tile.key)}
                  >
                    <div
                      className={cn('flex h-full w-full flex-col justify-between overflow-hidden rounded-xl p-2.5 transition-[filter,box-shadow] duration-150', hovered === tile.key && 'brightness-110 ring-2 ring-[var(--ref-on-surface)]/20')}
                      style={{ backgroundColor: `color-mix(in srgb, ${tint} ${hovered == null || hovered === tile.key ? 26 : 16}%, var(--ref-surface-container-lowest))` }}
                    >
                      {(roomy || compact) && (
                        <div className="flex min-w-0 items-center gap-1.5">
                          {tile.row && <CategoryIcon name={tile.row.name} color={tint} className={roomy ? 'h-4 w-4' : 'h-3.5 w-3.5'} />}
                          {roomy && <span className="truncate text-xs font-semibold text-[var(--ref-on-surface)]">{name}</span>}
                        </div>
                      )}
                      {roomy && (
                        <div className="min-w-0">
                          <p className={cn('truncate font-headline font-bold tabular-nums text-[var(--ref-on-surface)]', rect.w > 156 ? 'text-lg' : rect.w > 104 ? 'text-base' : 'text-xs')}>{metric === 'amount' ? (balancesHidden ? formatAmount(tile.value) : shortRupiah(tile.value)) : tile.value.toLocaleString('id-ID')}</p>
                          <p className="text-[11px] tabular-nums text-[var(--ref-on-surface-variant)]">{share(tile.value)}%</p>
                        </div>
                      )}
                      {compact && <p className="text-[10px] font-semibold tabular-nums text-[var(--ref-on-surface)]">{share(tile.value)}%</p>}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 min-h-[1.25rem] text-xs text-[var(--ref-on-surface-variant)]" aria-live="polite">
              {hoveredTile
                ? hoveredTile.row
                  ? <><span className="font-semibold text-[var(--ref-on-surface)]">{hoveredTile.row.name}</span> · {formatAmount(hoveredTile.row.amount)} over {hoveredTile.row.count} {hoveredTile.row.count === 1 ? 'entry' : 'entries'} · {formatAmount(hoveredTile.row.average)} each · {share(hoveredTile.value)}% of {metric === 'amount' ? 'spending' : 'entries'}</>
                  : <><span className="font-semibold text-[var(--ref-on-surface)]">Other</span> · {folded.map((row) => row.name).join(', ')}</>
                : 'Hover a tile for its numbers. Tile size follows the measure you pick.'}
            </p>
          </div>

          <div className="border-t border-[var(--color-border)] pt-3">
            <h3 className="text-xs font-semibold text-[var(--ref-on-surface)]">Spending habits</h3>
            <p className="mb-1 text-[11px] text-[var(--ref-on-surface-variant)]">How often against how much each time; bubble size is the total.</p>
            <HabitMap points={rows} format={formatAmount} short={(value) => (balancesHidden ? formatAmount(value) : shortRupiah(value))} />
          </div>
        </div>
      )}
    </section>
  );
}
