import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Crown, Gem, Repeat2 } from 'lucide-react';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn } from '../../lib/utils';
import { CategoryIcon } from './CategoryIcon';
import { useCategoryBreakdownQuery } from './page-queries';
import { squarify } from './treemap';

type Metric = 'amount' | 'count';
type Range = '30d' | 'year' | 'all';

const METRICS: { id: Metric; label: string }[] = [
  { id: 'amount', label: 'Amount' },
  { id: 'count', label: 'Entries' },
];
const RANGES: { id: Range; label: string; previous: string | null }[] = [
  { id: '30d', label: '30 days', previous: 'the 30 days before' },
  { id: 'year', label: 'This year', previous: 'the same stretch last year' },
  { id: 'all', label: 'All time', previous: null },
];
/** Tiles past this many fold into one "Other" tile, so every tile stays big enough to read. */
const MAX_TILES = 9;
const BOX = { w: 160, h: 100 };
const DAY = 86_400_000;

/** Short rupiah for tight tiles: Rp6,7 jt, Rp850 rb. */
function shortRupiah(value: number): string {
  const units: [number, string][] = [[1e9, 'M'], [1e6, 'jt'], [1e3, 'rb']];
  for (const [size, unit] of units) {
    if (value >= size) return `Rp${(value / size).toLocaleString('id-ID', { maximumFractionDigits: value / size >= 100 ? 0 : 1 })} ${unit}`;
  }
  return `Rp${value.toLocaleString('id-ID')}`;
}

function bounds(range: Range, now: number, previous: boolean): { from?: number; to?: number } {
  if (range === '30d') return previous ? { from: now - 60 * DAY, to: now - 30 * DAY - 1 } : { from: now - 30 * DAY, to: now };
  if (range === 'year') {
    const year = new Date(now).getFullYear() - (previous ? 1 : 0);
    const to = previous ? new Date(now).setFullYear(year) : now;
    return { from: new Date(year, 0, 1).getTime(), to };
  }
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

function Insight({ icon, label, row, value, detail }: { icon: ReactNode; label: string; row: Row | null; value: string; detail: string }) {
  if (!row) return null;
  const tint = row.color ?? 'var(--ref-primary)';
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] px-3.5 py-3">
      <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: `color-mix(in srgb, ${tint} 14%, transparent)` }}>
        <CategoryIcon name={row.name} color={tint} className="h-5 w-5" />
        <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] text-[var(--ref-on-surface-variant)]">{icon}</span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ref-on-surface-variant)]">{label}</p>
        <p className="truncate text-sm font-semibold text-[var(--ref-on-surface)]">{row.name} · <span className="tabular-nums">{value}</span></p>
        <p className="truncate text-xs text-[var(--ref-on-surface-variant)]">{detail}</p>
      </div>
    </div>
  );
}

/**
 * Where the money goes: a treemap where each category's tile is its share of spending (or of
 * entries), drawn in the category's own colour and labelled on the tile, beside a few callouts
 * (the biggest, the most frequent, the priciest per entry, the biggest change).
 */
export function CategoryBreakdown({ categories }: { categories: Array<{ id: number; name: string; color: string | null }> }) {
  const { formatAmount, balancesHidden } = useBalanceVisibility();
  const [metric, setMetric] = useState<Metric>('amount');
  const [range, setRange] = useState<Range>('year');
  const [hovered, setHovered] = useState<number | null>(null);
  const [now] = useState(() => Date.now());
  const current = useCategoryBreakdownQuery(useMemo(() => bounds(range, now, false), [range, now]));
  const previous = useCategoryBreakdownQuery(useMemo(() => bounds(range, now, true), [range, now]), range !== 'all');

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
  const rects = squarify(tiles.map((tile) => tile.value), BOX.w, BOX.h);
  const share = (value: number) => (total > 0 ? Math.round((value / total) * 100) : 0);
  const show = (value: number) => (metric === 'amount' ? formatAmount(value) : `${value.toLocaleString('id-ID')} ${value === 1 ? 'entry' : 'entries'}`);

  // Callouts.
  const biggest = [...rows].sort((a, b) => b.amount - a.amount)[0] ?? null;
  const frequent = [...rows].sort((a, b) => b.count - a.count)[0] ?? null;
  const priciest = [...rows].filter((row) => row.count >= 3).sort((a, b) => b.average - a.average)[0] ?? null;
  const before = new Map((previous.data ?? []).map((row) => [row.categoryId, Math.max(0, row.amount)]));
  // Only meaningful when the earlier stretch had spending too (the ledger may not go back that far).
  const changes = range === 'all' || !previous.data || before.size === 0 ? [] : rows.map((row) => ({ row, delta: row.amount - (before.get(row.id) ?? 0) }));
  const mover = changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0] ?? null;
  const moverBase = mover ? before.get(mover.row.id) ?? 0 : 0;

  const hoveredTile = tiles.find((tile) => tile.key === hovered) ?? null;
  const rangeInfo = RANGES.find((item) => item.id === range)!;

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--ref-on-surface)]">Where the money goes</h2>
          <p className="text-xs text-[var(--ref-on-surface-variant)]">
            {formatAmount(totalAmount)} over {totalCount.toLocaleString('id-ID')} entries · {formatAmount(totalCount > 0 ? Math.round(totalAmount / totalCount) : 0)} each on average
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Size tiles by" options={METRICS} value={metric} onChange={setMetric} />
          <Segmented label="Range" options={RANGES} value={range} onChange={setRange} />
        </div>
      </div>

      {current.isPending && !current.data ? (
        <p className="px-5 py-10 text-sm text-[var(--ref-on-surface-variant)]">Loading…</p>
      ) : tiles.length === 0 ? (
        <p className="px-5 py-10 text-sm text-[var(--ref-on-surface-variant)]">No categorized spending in this range.</p>
      ) : (
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="relative">
            <div
              className={cn('relative aspect-[16/10] w-full transition-opacity', current.isFetching && 'opacity-60')}
              role="list"
              aria-label={`Categories by ${metric === 'amount' ? 'amount spent' : 'number of entries'}`}
              onMouseLeave={() => setHovered(null)}
            >
              {tiles.map((tile, index) => {
                const rect = rects[index];
                const width = (rect.w / BOX.w) * 100;
                const height = (rect.h / BOX.h) * 100;
                const tint = tile.row?.color ?? 'var(--ref-outline)';
                const roomy = width > 17 && height > 20;
                const compact = !roomy && width > 9 && height > 11;
                const name = tile.row?.name ?? `Other (${folded.length})`;
                return (
                  <div
                    key={tile.key}
                    role="listitem"
                    aria-label={`${name}: ${show(tile.value)}, ${share(tile.value)}%`}
                    className="absolute p-[2px]"
                    style={{ left: `${(rect.x / BOX.w) * 100}%`, top: `${(rect.y / BOX.h) * 100}%`, width: `${width}%`, height: `${height}%` }}
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
                          <p className={cn('truncate font-headline font-bold tabular-nums text-[var(--ref-on-surface)]', width > 30 ? 'text-lg' : width > 21 ? 'text-base' : 'text-xs')}>{metric === 'amount' ? (balancesHidden ? formatAmount(tile.value) : shortRupiah(tile.value)) : tile.value.toLocaleString('id-ID')}</p>
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

          <div className="grid content-start gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
            <Insight icon={<Crown className="h-3 w-3" />} label="Biggest" row={biggest} value={biggest ? formatAmount(biggest.amount) : ''} detail={biggest ? `${Math.round((biggest.amount / Math.max(1, totalAmount)) * 100)}% of all spending` : ''} />
            <Insight icon={<Repeat2 className="h-3 w-3" />} label="Most frequent" row={frequent} value={frequent ? `${frequent.count}×` : ''} detail={frequent ? `${formatAmount(frequent.average)} each on average` : ''} />
            <Insight icon={<Gem className="h-3 w-3" />} label="Priciest per entry" row={priciest} value={priciest ? formatAmount(priciest.average) : ''} detail={priciest ? `across ${priciest.count} entries` : ''} />
            {mover && mover.delta !== 0 && (
              <Insight
                icon={mover.delta > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                label={mover.delta > 0 ? 'Biggest rise' : 'Biggest drop'}
                row={mover.row}
                value={`${mover.delta > 0 ? '+' : '−'}${formatAmount(Math.abs(mover.delta))}`}
                detail={moverBase > 0 ? `${mover.delta > 0 ? '+' : '−'}${Math.round((Math.abs(mover.delta) / moverBase) * 100)}% vs ${rangeInfo.previous}` : `nothing in ${rangeInfo.previous}`}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
