import { Check, Edit2, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn } from '../../lib/utils';
import { useSequence } from './motion';
import { exampleAccounts, useHelpPersonal } from './personal';
import { VisualFrame } from './visuals';

/**
 * Review pending, copied from its dialog (which approves and rejects for real, so it can’t run
 * here): a bank email turned into a card, then approved. Sample email.
 */
export function ImportFlowDemo() {
  const { ref, step, replay } = useSequence(2, 1400);
  const { formatAmount } = useBalanceVisibility();
  const { first } = exampleAccounts(useHelpPersonal());
  const approved = step >= 2;

  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="A bank email waiting in Review pending. Nothing reaches your ledger until you approve it.">
      <div className="mx-auto max-w-xl overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] p-5">
          <div>
            <h2 className="font-headline text-2xl font-extrabold tracking-tight text-[var(--color-text-primary)]">Pending Transactions</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Review and approve AI-parsed transactions</p>
          </div>
          <X className="h-5 w-5 shrink-0 text-[var(--color-muted)]" aria-hidden />
        </div>
        <div className="p-5">
          {approved ? (
            <div className="animate-[finance-page-header-in_300ms_ease-out] py-8 text-center text-[var(--color-muted)]">No pending transactions</div>
          ) : (
            <div className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="mb-1 text-xs text-[var(--color-muted)]">Original message</p>
                  <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">wondr by BNI · Transaction successful · QRIS payment to KOPI KENANGAN</p>
                </div>
                <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-600 dark:text-yellow-400">92% confidence</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Type</span><span className="font-medium capitalize">expense</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Amount</span><span className="font-medium">{formatAmount(45_000)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Category</span><span className="font-medium">Food &amp; Dining</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Account</span><span className="font-medium">{first}</span></div>
              </div>
              <div className="flex gap-2 border-t border-[var(--color-border)] pt-2">
                <Button variant="secondary" size="sm" tabIndex={-1} className="pointer-events-none flex-1 rounded-full"><Edit2 className="mr-1 h-4 w-4" />Edit</Button>
                <Button variant="secondary" size="sm" tabIndex={-1} className="pointer-events-none flex-1 rounded-full text-red-500"><X className="mr-1 h-4 w-4" />Reject</Button>
                <Button size="sm" tabIndex={-1} className={cn('pointer-events-none flex-1 rounded-full transition-shadow', step >= 1 && 'ring-4 ring-[var(--color-accent)]/25')}><Check className="mr-1 h-4 w-4" />Approve</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </VisualFrame>
  );
}
