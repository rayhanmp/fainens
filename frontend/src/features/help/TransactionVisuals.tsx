import { MoreHorizontal, RotateCcw } from 'lucide-react';
import { CategoryIcon } from '../categories/CategoryIcon';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn, formatTime } from '../../lib/utils';
import { useSequence } from './motion';
import { exampleAccounts, useHelpPersonal } from './personal';
import { VisualFrame } from './visuals';

/**
 * Transactions-list rows copied from the Transactions page (each live row opens, edits and corrects
 * real entries, so it can’t run here), used to show a correction. Sample entries.
 */

type Row = { id: string; description: string; amount: number; category: string; color: string; correction?: boolean; faded?: boolean };

function TransactionRows({ rows, account, at }: { rows: Row[]; account: string; at: number }) {
  const { formatAmount } = useBalanceVisibility();
  return (
    <section className="rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] shadow-sm">
      <h2 className="rounded-t-3xl bg-[var(--ref-surface-container-low)] px-5 py-2 text-xs font-semibold text-[var(--ref-on-surface-variant)]">Today</h2>
      {rows.map((row) => (
        <div key={row.id} className={cn('flex items-center gap-x-3 px-4 py-4 transition-all duration-500 sm:px-6', row.correction && 'bg-[var(--ref-surface-container-low)]/60', row.faded && 'opacity-55')}>
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl', row.correction && 'bg-amber-500/10 text-amber-800')} style={row.correction ? undefined : { backgroundColor: `color-mix(in srgb, ${row.color} 12%, transparent)` }}>
            {row.correction ? <RotateCcw className="h-5 w-5" /> : <CategoryIcon name={row.category} color={row.color} className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-headline font-bold text-[var(--ref-on-surface)]">{row.description}</span>
              {row.correction && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">Accounting correction</span>}
            </div>
            <p className="mt-1 truncate text-xs text-[var(--ref-on-surface-variant)]">{formatTime(at)} · {account}</p>
          </div>
          <div className="hidden w-32 shrink-0 text-right sm:block"><p className="truncate text-xs font-semibold text-[var(--ref-on-surface-variant)]">{row.category}</p></div>
          <div className="text-right sm:min-w-32">
            <p className={cn('font-headline text-sm font-extrabold tabular-nums', row.amount > 0 ? 'text-[var(--color-success)]' : 'text-[var(--ref-on-surface)]')}>{row.amount < 0 ? '−' : '+'}{formatAmount(Math.abs(row.amount))}</p>
          </div>
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[var(--ref-on-surface-variant)]"><MoreHorizontal className="h-5 w-5" /></span>
        </div>
      ))}
    </section>
  );
}

/** A Rp50.000 typo corrected: the original stays, a correction cancels it, the right amount is added. */
export function CorrectionDemo() {
  const { ref, step, replay } = useSequence(3, 1200);
  const { first } = exampleAccounts(useHelpPersonal());
  const at = new Date().setHours(12, 30, 0, 0);
  const rows: Row[] = [
    { id: 'replacement', description: 'Lunch at warteg', amount: -45_000, category: 'Food & Dining', color: '#f97316' },
    { id: 'correction', description: 'Reversal: Lunch at warteg', amount: 50_000, category: 'Food & Dining', color: '#f97316', correction: true },
    { id: 'original', description: 'Lunch at warteg', amount: -50_000, category: 'Food & Dining', color: '#f97316', faded: step >= 2 },
  ].filter((row) => (row.id === 'original') || (row.id === 'correction' && step >= 2) || (row.id === 'replacement' && step >= 3));

  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="Transactions after correcting a Rp50.000 typo: nothing is deleted; a correction cancels it, then the right amount is recorded.">
      <div className="mx-auto max-w-3xl space-y-3">
        <TransactionRows rows={rows} account={first} at={at} />
        <div className={cn('rounded-2xl border border-amber-300/70 bg-amber-50/70 px-4 py-3 text-sm text-amber-950 transition-opacity duration-500 dark:border-amber-800/60 dark:bg-amber-950/20 dark:text-amber-100', step === 1 ? 'opacity-100' : 'opacity-0')}>
          <p className="font-semibold">Correct transaction</p>
          <p className="mt-0.5 text-xs leading-relaxed">This keeps the original for audit history and posts an equal opposite correction. You can then add the replacement transaction.</p>
        </div>
      </div>
    </VisualFrame>
  );
}
