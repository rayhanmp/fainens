import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useLinkReallocation, useTransactionList } from '../../features/transactions/queries';
import { reallocationPreview, type ReallocationTransaction } from '../../features/transactions/reallocation';

function EntrySummary({ entry }: { entry: ReallocationTransaction }) {
  const { formatAmount } = useBalanceVisibility();
  const wallet = entry.lines?.find(line => line.cashFlowClass != null);
  const amount = Math.abs(entry.expenseCents || entry.incomeCents || 0);
  return <div className="min-w-0">
    <p className="break-words font-semibold">{entry.description}</p>
    <p className="text-xs text-[var(--ref-on-surface-variant)]">{new Date(entry.date).toLocaleDateString('en-ID', { day: 'numeric', month: 'short', year: 'numeric' })} · {wallet?.accountName ?? 'Account'}</p>
    <p className="mt-1 font-bold tabular-nums">{entry.reallocationEligibleRole === 'incoming' ? '+' : '−'}{formatAmount(amount)}</p>
  </div>;
}

export function ReallocationModal({ transaction, onClose, onSaved }: {
  transaction: ReallocationTransaction; onClose: () => void; onSaved: () => void;
}) {
  const { formatAmount } = useBalanceVisibility();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [counterpart, setCounterpart] = useState<ReallocationTransaction | null>(null);
  const [reason, setReason] = useState('Original spending predates tracking');
  useEffect(() => {
    const timeout = window.setTimeout(() => { setQuery(search); setOffset(0); }, 250);
    return () => window.clearTimeout(timeout);
  }, [search]);
  const results = useTransactionList({ periodId: 'all', search: query || undefined, limit: '25', offset: String(offset) });
  const mutation = useLinkReallocation();
  const candidates = (results.data?.data ?? []).filter(entry => entry.id !== transaction.id && entry.reallocationEligibleRole != null && entry.reallocationEligibleRole !== transaction.reallocationEligibleRole && !entry.reallocation);
  const preview = counterpart ? reallocationPreview(transaction, counterpart) : null;
  const save = async () => {
    if (!counterpart || !reason.trim()) return;
    try {
      await mutation.mutateAsync({ id: transaction.id, counterpartTransactionId: counterpart.id, reason: reason.trim() });
      onSaved(); onClose();
    } catch { /* Mutation error is displayed below. */ }
  };
  return <Modal isOpen onClose={onClose} title="Link as reallocation" subtitle="Redirect money already spent before tracking." contentClassName="space-y-4" footer={<Button className="w-full" onClick={() => void save()} disabled={!preview?.matchedAmount || !reason.trim() || mutation.isPending} isLoading={mutation.isPending}>Link transactions</Button>}>
    <div className="rounded-xl bg-[var(--ref-surface-container-low)] p-3"><EntrySummary entry={transaction} /></div>
    <label className="block text-sm font-semibold">Find the {transaction.reallocationEligibleRole === 'incoming' ? 'outgoing payment' : 'returned money'}
      <input autoFocus value={search} onChange={event => setSearch(event.target.value)} maxLength={120} placeholder="Search transactions across all periods" className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3 font-normal" />
    </label>
    <div aria-busy={results.isFetching} className="max-h-56 space-y-2 overflow-y-auto">
      {results.isError ? <div role="alert"><p>Could not load transactions.</p><Button variant="secondary" onClick={() => void results.refetch()}>Retry</Button></div>
        : results.isLoading ? <p className="text-sm">Loading transactions…</p>
        : candidates.length === 0 ? <p className="text-sm text-[var(--ref-on-surface-variant)]">No eligible counterpart on this page. Search by name or check another page.</p>
        : candidates.map(entry => <button key={entry.id} type="button" aria-pressed={counterpart?.id === entry.id} onClick={() => { setCounterpart(entry); mutation.reset(); }} className={`w-full rounded-xl border p-3 text-left ${counterpart?.id === entry.id ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)]/10' : 'border-[var(--color-border)]'}`}><EntrySummary entry={entry} /></button>)}
    </div>
    <div className="flex justify-between gap-3"><Button variant="secondary" disabled={offset === 0 || results.isFetching} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</Button><Button variant="secondary" disabled={!results.data?.pagination.hasMore || results.isFetching} onClick={() => setOffset(offset + 25)}>Next</Button></div>
    {counterpart && preview && <div className="space-y-2 rounded-xl bg-[var(--ref-surface-container-low)] p-3" aria-live="polite">
      <EntrySummary entry={counterpart} />
      <p className="text-sm font-bold">{formatAmount(preview.matchedAmount)} reallocated; {formatAmount(preview.newSpending)} new spending.</p>
      {preview.incomingRemainder > 0 && <p className="text-xs">{formatAmount(preview.incomingRemainder)} of the incoming entry keeps its original reporting treatment.</p>}
    </div>}
    <label className="block text-sm font-semibold">Reason<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} rows={2} className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3 font-normal" /></label>
    <p className="text-xs text-[var(--ref-on-surface-variant)]">The matched amount is excluded from personal income, spending, and budgets. Both bank movements remain recorded.</p>
    {mutation.isError && <p role="alert" className="text-sm text-[var(--ref-error)]">{mutation.error.message}</p>}
  </Modal>;
}
