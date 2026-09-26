import { Link } from '@tanstack/react-router';
import { Button } from '../ui/Button';
import { useUnlinkReallocation } from '../../features/transactions/queries';
import type { ReallocationInfo } from '../../features/transactions/reallocation';
import { formatCurrency } from '../../lib/utils';

export function ReallocationDetails({ transactionId, reallocation, onUnlinked }: {
  transactionId: number; reallocation: ReallocationInfo; onUnlinked: () => void;
}) {
  const mutation = useUnlinkReallocation();
  return <section aria-label="Reallocation details" className="mb-6 space-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] p-4">
    <p className="text-sm font-bold">Reallocation · {formatCurrency(reallocation.amount)}</p>
    <p className="text-sm">Linked to <Link to="/transactions" search={{ periodId: 'all', transactionId: String(reallocation.counterpartTransactionId) }} className="font-semibold underline">{reallocation.counterpartDescription}</Link></p>
    <p className="text-sm">{reallocation.reason}</p>
    <p className="text-xs text-[var(--ref-on-surface-variant)]">This amount is excluded from personal income and spending views. Accounting reports and bank balances retain the original entries.</p>
    <Button variant="secondary" isLoading={mutation.isPending} disabled={mutation.isPending} onClick={async () => { try { await mutation.mutateAsync(transactionId); onUnlinked(); } catch { /* Displayed below. */ } }}>Unlink</Button>
    {mutation.isError && <p role="alert" className="text-sm text-[var(--ref-error)]">{mutation.error.message}</p>}
  </section>;
}
