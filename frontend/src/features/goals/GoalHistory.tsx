import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn, formatDate } from '../../lib/utils';
import { useGoalAllocationsQuery } from './queries';

type Entry = { kind: string; amount: number; note: string | null; transactionDescription: string | null };

/** What an entry in a goal's history was, in a few words. */
function describe(entry: Entry): string {
  if (entry.kind === 'category') return `Spent: ${entry.note ?? entry.transactionDescription ?? 'an expense'}`;
  if (entry.kind === 'spend') {
    if (entry.note && entry.note !== 'Bought' && entry.note !== 'Done') return entry.transactionDescription ? `${entry.note} (${entry.transactionDescription})` : entry.note;
    return entry.transactionDescription ? `Bought: ${entry.transactionDescription}` : entry.note === 'Done' ? 'Finished' : 'Bought';
  }
  return entry.note ?? (entry.amount > 0 ? 'Put in' : 'Taken out');
}

/** Every move of a goal's money, newest first. */
export function GoalHistory({ goalId, limit }: { goalId: number; limit?: number }) {
  const { formatAmount } = useBalanceVisibility();
  const history = useGoalAllocationsQuery(goalId);
  const rows = history.data ?? [];
  const shown = limit ? rows.slice(0, limit) : rows;
  if (history.isPending) return <p className="text-xs text-[var(--ref-on-surface-variant)]">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-[var(--ref-on-surface-variant)]">No money in it yet.</p>;
  return (
    <ul className="divide-y divide-[var(--color-border)] text-sm">
      {shown.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 py-2">
          <span className="min-w-0">
            <span className="block truncate text-[var(--ref-on-surface)]">{describe(row)}</span>
            <span className="block text-xs tabular-nums text-[var(--ref-on-surface-variant)]">{formatDate(row.createdAt)}</span>
          </span>
          <span className={cn('shrink-0 font-semibold tabular-nums', row.amount > 0 ? 'text-[var(--color-success)]' : 'text-[var(--ref-on-surface)]')}>{row.amount > 0 ? '+' : row.amount < 0 ? '−' : ''}{formatAmount(Math.abs(row.amount))}</span>
        </li>
      ))}
    </ul>
  );
}
