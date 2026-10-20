import { useState } from 'react';
import { AlertCircle, ArrowDownRight, ArrowUpRight, CheckCircle2, CircleHelp, Search } from 'lucide-react';
import { AccountIcon } from '../../components/reconciliation/ReconciliationModal';
import { CurrencyInput } from '../../components/ui/CurrencyInput';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn } from '../../lib/utils';
import { useSequence } from './motion';
import { exampleAccounts, useHelpPersonal } from './personal';
import { VisualFrame } from './visuals';

/**
 * The Reconcile dialog’s two steps, copied from its markup (the dialog itself reads and posts, so
 * it can’t run here): checking each account, then the snapshot of differences. Sample balances.
 */

type Row = { name: string; ledger: number; actual: number | null };

const chipFor = (row: Row) => {
  if (row.actual == null) return { className: 'bg-[#E2E8F0] text-[#334155]', icon: CircleHelp, label: 'Not checked' };
  const difference = row.actual - row.ledger;
  if (difference === 0) return { className: 'bg-[#DCFCE7] text-[#166534]', icon: CheckCircle2, label: 'Matches' };
  return { className: 'bg-[#FEF3C7] text-[#78350F]', icon: difference > 0 ? ArrowUpRight : ArrowDownRight, label: null, difference };
};

function CheckRows({ rows, formatAmount }: { rows: Row[]; formatAmount: (value: number) => string }) {
  return (
    <div className="divide-y divide-[var(--color-border)]">
      {rows.map((row) => {
        const chip = chipFor(row);
        const hasChanges = row.actual != null && row.actual !== row.ledger;
        return (
          <div key={row.name} className={cn('grid grid-cols-1 gap-3 px-4 py-4 transition-colors sm:grid-cols-[minmax(0,1fr)_minmax(150px,200px)_150px] sm:items-center sm:px-5', hasChanges && 'bg-amber-50/50 dark:bg-amber-950/10')}>
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ref-primary-container)] text-[var(--ref-on-primary-container)]"><AccountIcon name={row.name} /></div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[var(--ref-on-surface)]">{row.name}</p>
                <p className="mt-0.5 text-xs text-[var(--ref-on-surface-variant)]">In Fainens <span className="font-mono font-semibold text-[var(--ref-on-surface)]">{formatAmount(row.ledger)}</span></p>
              </div>
            </div>
            <div>
              <CurrencyInput label={`Actual balance for ${row.name}`} labelClassName="sr-only" value={row.actual == null ? '' : row.actual.toLocaleString('id-ID')} onChange={() => undefined} placeholder="0" size="sm" className="space-y-0" showDivider={false} />
              <span className="mt-1.5 block text-[11px] font-semibold text-[var(--ref-primary)]">{row.actual == null ? 'Mark as matching' : 'Clear this check'}</span>
            </div>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold', chip.className)}>
                <chip.icon className="h-3.5 w-3.5" />{chip.label ?? `${formatAmount(Math.abs(chip.difference ?? 0))} difference`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Step 1 then Step 2 of Reconcile: two accounts match, one is Rp20.000 short. */
export function ReconcileDemo() {
  const { ref, step, replay } = useSequence(3, 1100);
  const { formatAmount } = useBalanceVisibility();
  const { first, second } = exampleAccounts(useHelpPersonal());
  const rows: Row[] = [
    { name: first, ledger: 1_200_000, actual: step >= 1 ? 1_180_000 : null },
    { name: second, ledger: 350_000, actual: step >= 2 ? 350_000 : null },
    { name: 'Cash', ledger: 150_000, actual: step >= 2 ? 150_000 : null },
  ];
  const checked = rows.filter((row) => row.actual != null);
  const differences = checked.filter((row) => row.actual !== row.ledger);
  const total = differences.reduce((sum, row) => sum + Math.abs((row.actual ?? 0) - row.ledger), 0);

  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="The Reconcile dialog with sample balances: enter what each account really shows; differences are recorded as Balance adjustments.">
      <div className="mx-auto max-w-3xl space-y-4">
        <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]">
          <div className="border-b border-[var(--color-border)] bg-[var(--ref-surface-container-low)]/60 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--ref-primary)]">Step 1 · Verify balances</p>
            <h3 className="mt-1 text-lg font-bold text-[var(--ref-on-surface)]">What do your accounts show?</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--ref-on-surface-variant)]">Enter balances for checked accounts. Blank accounts are skipped.</p>
          </div>
          <div className="flex flex-wrap gap-2 border-b border-[var(--color-border)] p-4">
            {[`All · ${rows.length}`, `Not checked · ${rows.length - checked.length}`, `Differences · ${differences.length}`].map((label, index) => (
              <span key={label} className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold', index === 0 ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)] text-white' : 'border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] text-[var(--ref-on-surface-variant)]')}>{label}</span>
            ))}
          </div>
          <CheckRows rows={rows} formatAmount={formatAmount} />
        </section>
        <section className={cn('rounded-2xl border p-4 sm:p-5 transition-colors', differences.length ? 'border-amber-300/80 bg-amber-50/60 dark:border-amber-800/60 dark:bg-amber-950/15' : 'border-[var(--color-border)] bg-[var(--ref-surface-container-low)]/60')}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--ref-outline)]">Step 2 · Review snapshot</p>
              <h3 className="mt-1 text-base font-bold text-[var(--ref-on-surface)]">{differences.length ? 'Differences will be recorded separately' : checked.length ? 'Verified balances are ready' : 'Check an account to get started'}</h3>
            </div>
            {differences.length > 0 && <span className="rounded-full bg-amber-200/70 px-3 py-1.5 text-xs font-bold text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">{differences.length} adjustment{differences.length === 1 ? '' : 's'}</span>}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-[var(--ref-surface-container-lowest)]/85 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--ref-outline)]">Verified</p><p className="mt-1 text-lg font-extrabold text-[var(--ref-on-surface)]">{checked.length}<span className="ml-1 text-xs font-medium text-[var(--ref-outline)]">/ {rows.length}</span></p></div>
            <div className="rounded-xl bg-[var(--ref-surface-container-lowest)]/85 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--ref-outline)]">Matches</p><p className="mt-1 text-lg font-extrabold text-[var(--ref-on-surface)]">{checked.length - differences.length}</p></div>
            <div className="rounded-xl bg-[var(--ref-surface-container-lowest)]/85 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--ref-outline)]">Total difference</p><p className="mt-1 truncate font-mono text-lg font-extrabold text-[var(--ref-on-surface)]">{formatAmount(total)}</p></div>
          </div>
          {differences.length > 0 && (
            <div className="mt-4 space-y-2 border-t border-amber-300/60 pt-3 dark:border-amber-800/50">
              <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-amber-900 dark:text-amber-100">Adjustments to review</p>
              {differences.map((row) => (
                <div key={row.name} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
                  <span className="min-w-0 font-semibold text-[var(--ref-on-surface)]">{row.name}<span className="ml-2 font-normal text-[var(--ref-on-surface-variant)]">{formatAmount(row.ledger)} → {formatAmount(row.actual ?? 0)}</span></span>
                  <span className="shrink-0 font-mono font-bold text-amber-900 dark:text-amber-100">{(row.actual ?? 0) > row.ledger ? '+' : '−'}{formatAmount(Math.abs((row.actual ?? 0) - row.ledger))}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </VisualFrame>
  );
}

/** Tracking down a difference: the account is Rp50.000 short until the missing coffee is recorded. */
export function MismatchDemo() {
  const { ref, step, replay } = useSequence(3, 1200);
  const { formatAmount } = useBalanceVisibility();
  const { second } = exampleAccounts(useHelpPersonal());
  const [found] = useState('Kopi Kenangan');
  const fixed = step >= 3;
  const rows: Row[] = [{ name: second, ledger: fixed ? 950_000 : 1_000_000, actual: step >= 1 ? 950_000 : null }];

  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="A Reconcile check shows the gap. Look for a missing or doubled transaction first; reconcile only what’s left.">
      <div className="mx-auto max-w-3xl space-y-3">
        <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]"><CheckRows rows={rows} formatAmount={formatAmount} /></section>
        <div className={cn('flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm transition-opacity duration-500', step >= 2 ? 'opacity-100' : 'opacity-0')}>
          <Search className="h-4 w-4 shrink-0 text-[var(--ref-primary)]" aria-hidden />
          <span className="min-w-0 flex-1 text-[var(--ref-on-surface)]">In the {second} app: <strong>{found}, {formatAmount(50_000)}</strong> on Thursday, not in Fainens.</span>
          <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold', fixed ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#FEF3C7] text-[#78350F]')}>{fixed ? <><CheckCircle2 className="h-3.5 w-3.5" />Recorded</> : <><AlertCircle className="h-3.5 w-3.5" />Missing</>}</span>
        </div>
      </div>
    </VisualFrame>
  );
}
