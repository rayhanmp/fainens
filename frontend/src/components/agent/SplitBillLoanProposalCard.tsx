import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Button } from '../ui/Button';
import type { AgentSplitBillActionProposal } from '../../lib/api';
import { formatCurrency, formatDateTime } from '../../lib/utils';
import { agentCommands } from '../../features/agent/commands';
import { invalidateFinancialSummaries } from '../../features/core/query-keys';
import { isSplitBillLoanProposal } from '../../features/agent/proposal-utils';

export function SplitBillLoanProposalCard({ proposal }: { proposal: AgentSplitBillActionProposal }) {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState(proposal);
  const [status, setStatus] = useState(proposal.status);
  const [error, setError] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<number | null>(null);
  const restoring = useRef(false);
  useEffect(() => {
    if (restoring.current || current.approvalToken || !['pending', 'expired'].includes(current.status)) return;
    restoring.current = true;
    setStatus('restoring');
    void agentCommands.approvals.reissue(current.approvalId).then((restored) => {
      if (!isSplitBillLoanProposal(restored)) throw new Error('Could not restore this split bill.');
      setCurrent(restored);
      setStatus(restored.status);
    }).catch((cause) => {
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Could not restore this approval.');
    });
  }, [current]);

  async function act(execute: boolean) {
    if (!current.approvalToken || status !== 'pending') return;
    setStatus('saving');
    setError(null);
    try {
      if (execute) {
        const result = await agentCommands.approvals.execute(current.approvalId, current.approvalToken);
        setSourceId(result.receipt.transactionId ?? null);
        setStatus('executed');
        await invalidateFinancialSummaries(queryClient).catch(() => setError('Saved. Refresh the page to reload the updated balances.'));
      } else {
        await agentCommands.approvals.reject(current.approvalId, current.approvalToken);
        setStatus('rejected');
      }
    } catch (cause) {
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Could not save this split bill.');
    }
  }
  const details = current.details;
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-5 space-y-4">
      <div className="flex justify-between gap-3">
        <div><p className="text-xs font-semibold text-[var(--ref-primary)]">SPLIT BILL · LINKED LOANS</p><h3 className="mt-1 font-semibold">{details.title}</h3></div>
        <span className="text-xs text-[var(--color-muted)]">{status === 'pending' ? 'Needs your review' : status === 'executed' ? 'Saved' : status}</span>
      </div>
      <p className="text-sm">{formatDateTime(details.dateMs)} · Paid from {details.walletName}</p>
      <div className="rounded-xl bg-[var(--ref-primary)]/5 p-3 space-y-2 text-sm">
        <div className="flex justify-between gap-3"><span>Receipt payment</span><strong>{formatCurrency(details.receiptTotalCents)}</strong></div>
        <div className="flex justify-between gap-3"><span>Your share (expense)</span><span>{formatCurrency(details.personalShareCents)}</span></div>
        <div className="flex justify-between gap-3"><span>Friends owe you (receivables)</span><strong>{formatCurrency(details.totalReceivableCents)}</strong></div>
      </div>
      <div className="divide-y divide-[var(--color-border)]">
        {details.receivables.map((row, index) => <div key={`${row.contactId}-${index}`} className="flex justify-between gap-3 py-2 text-sm"><span>{row.name}{row.createsContact && <span className="ml-2 text-xs text-[var(--color-muted)]">new contact</span>}</span><strong>{formatCurrency(row.amountCents)}</strong></div>)}
      </div>
      <div className="flex flex-wrap gap-2">{details.tagNames.map((name) => <span key={name} className="rounded-full bg-[var(--ref-primary)]/8 px-2 py-1 text-xs text-[var(--ref-primary)]">{name}</span>)}</div>
      <p className="text-xs text-[var(--color-muted)]">One bill, one receipt payment, {details.receivables.length} linked loans. A unique bill-reference tag is added when saved. Repayments reduce the loans, not ordinary income. Confirm only if this receipt payment has not already been recorded.</p>
      {current.assumptions.length > 0 && <ul className="list-disc pl-4 text-xs text-[var(--color-muted)]">{current.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul>}
      {error && <p className="text-sm text-[var(--ref-error)]">{error}</p>}
      {status === 'pending' && <div className="flex gap-2"><Button size="sm" onClick={() => void act(true)} disabled={!current.approvalToken}>Create linked loans</Button><Button size="sm" variant="secondary" onClick={() => void act(false)} disabled={!current.approvalToken}>Dismiss</Button></div>}
      {status === 'saving' && <p className="text-sm">Saving split bill…</p>}
      {status === 'executed' && <div className="flex gap-4 text-sm text-[var(--ref-primary)]"><Link to="/loans">View linked loans</Link>{sourceId && <Link to="/transactions" search={{ periodId: 'all', transactionId: String(sourceId) }}>View source payment</Link>}</div>}
    </section>
  );
}
