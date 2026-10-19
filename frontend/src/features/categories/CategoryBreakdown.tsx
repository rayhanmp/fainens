import { useMemo, useState } from 'react';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn } from '../../lib/utils';
import { CategoryIcon } from './CategoryIcon';
import { useCategoryBreakdownQuery } from './page-queries';

type Metric = 'amount' | 'count' | 'average';
type Range = '30d' | 'year' | 'all';

const METRICS: { id: Metric; label: string }[] = [
  { id: 'amount', label: 'Amount' },
  { id: 'count', label: 'Entries' },
  { id: 'average', label: 'Average' },
];
const RANGES: { id: Range; label: string }[] = [
  { id: '30d', label: '30 days' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
];

function rangeBounds(range: Range, now: number): { from?: number; to?: number } {
  if (range === '30d') return { from: now - 30 * 86_400_000, to: now };
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

/**
 * Where the money goes, category by category: a ranked bar per category in one accent hue (the
 * category's icon carries its identity), switchable between total spent, number of entries and the
 * average entry, over a chosen range.
 */
export function CategoryBreakdown({ categories }: { categories: Array<{ id: number; name: string; color: string | null }> }) {
  const { formatAmount } = useBalanceVisibility();
  const [metric, setMetric] = useState<Metric>('amount');
  const [range, setRange] = useState<Range>('year');
  const [now] = useState(() => Date.now());
  const bounds = useMemo(() => rangeBounds(range, now), [range, now]);
  const query = useCategoryBreakdownQuery(bounds);

  const rows = useMemo(() => {
    const byId = new Map(categories.map((category) => [category.id, category]));
    return (query.data ?? [])
      .map((row) => {
        const category = byId.get(row.categoryId);
        const amount = Math.max(0, row.amount);
        return { id: row.categoryId, name: category?.name ?? 'Archived category', color: category?.color ?? null, amount, count: row.transactionCount, average: row.transactionCount > 0 ? Math.round(amount / row.transactionCount) : 0 };
      })
      .filter((row) => row.amount > 0 || row.count > 0);
  }, [query.data, categories]);

  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const totalCount = rows.reduce((sum, row) => sum + row.count, 0);
  const value = (row: (typeof rows)[number]) => row[metric];
  const ordered = [...rows].sort((a, b) => value(b) - value(a));
  const max = Math.max(1, ...ordered.map(value));
  const shareOf = (row: (typeof rows)[number]) => {
    const total = metric === 'count' ? totalCount : totalAmount;
    const part = metric === 'count' ? row.count : row.amount;
    return total > 0 ? Math.round((part / total) * 100) : 0;
  };
  const display = (row: (typeof rows)[number]) => (metric === 'count' ? `${row.count}` : formatAmount(value(row)));

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--ref-on-surface)]">Spending breakdown</h2>
          <p className="text-xs text-[var(--ref-on-surface-variant)]">Posted spending, net of refunds and reimbursements.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Measure" options={METRICS} value={metric} onChange={setMetric} />
          <Segmented label="Range" options={RANGES} value={range} onChange={setRange} />
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-px border-b border-[var(--color-border)] bg-[var(--color-border)]">
        {[
          { label: 'Spent', value: formatAmount(totalAmount) },
          { label: 'Entries', value: totalCount.toLocaleString('id-ID') },
          { label: 'Average entry', value: formatAmount(totalCount > 0 ? Math.round(totalAmount / totalCount) : 0) },
        ].map((item) => (
          <div key={item.label} className="bg-[var(--ref-surface-container-lowest)] px-5 py-3">
            <dt className="text-[11px] font-medium uppercase tracking-wider text-[var(--ref-on-surface-variant)]">{item.label}</dt>
            <dd className="mt-0.5 truncate font-headline text-lg font-semibold tabular-nums text-[var(--ref-on-surface)]">{item.value}</dd>
          </div>
        ))}
      </dl>

      {query.isPending && !query.data ? (
        <p className="px-5 py-8 text-sm text-[var(--ref-on-surface-variant)]">Loading…</p>
      ) : ordered.length === 0 ? (
        <p className="px-5 py-8 text-sm text-[var(--ref-on-surface-variant)]">No categorized spending in this range.</p>
      ) : (
        <ol className={cn('px-5 py-3 transition-opacity', query.isFetching && 'opacity-60')} aria-label={`Categories by ${METRICS.find((item) => item.id === metric)?.label.toLowerCase()}`}>
          {ordered.map((row) => (
            <li
              key={row.id}
              className="group grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_8.5rem] items-center gap-x-4 rounded-lg py-1.5 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_10rem]"
              title={`${row.name}: ${formatAmount(row.amount)} over ${row.count} ${row.count === 1 ? 'entry' : 'entries'}, ${formatAmount(row.average)} on average`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <CategoryIcon name={row.name} color={row.color} className="h-3.5 w-3.5" />
                <span className="truncate text-sm text-[var(--ref-on-surface)]">{row.name}</span>
              </span>
              <span className="h-2 overflow-hidden rounded-full bg-[var(--ref-surface-container-high)]" aria-hidden>
                <span
                  className="block h-full rounded-full bg-[var(--ref-primary)] opacity-80 transition-[width,opacity] duration-300 group-hover:opacity-100"
                  style={{ width: `${Math.max(1.5, (value(row) / max) * 100)}%` }}
                />
              </span>
              <span className="flex items-baseline justify-end gap-2 text-right">
                <span className="text-sm font-semibold tabular-nums text-[var(--ref-on-surface)]">{display(row)}</span>
                {metric !== 'average' && <span className="w-9 text-xs tabular-nums text-[var(--ref-on-surface-variant)]">{shareOf(row)}%</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
