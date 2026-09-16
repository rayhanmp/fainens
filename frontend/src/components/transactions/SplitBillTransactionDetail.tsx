import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Users } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { queryKeys } from '../../features/core/query-keys';
import { useAgentProfileQuery } from '../../features/agent/queries';
import { parseSavedSplitShares, parseSavedSplitItems, splitBillOutstandingAmount, splitLoanStatusLabel } from '../../features/transactions/split-bill-detail';

export function SplitBillTransactionDetail({ transactionId, personalShare, totalPaid, isBorrower, paymentLookup = false }: {
  transactionId: number; personalShare: number; totalPaid: number; isBorrower: boolean; paymentLookup?: boolean;
}) {
  const detail = useQuery({
    queryKey: [...queryKeys.split.all, 'transaction', transactionId],
    queryFn: ({ signal }) => api.splitbill.transaction(transactionId, signal),
  });
  const profile = useAgentProfileQuery();
  const session = detail.data?.session;
  const shares = parseSavedSplitShares(session?.splitResultJson ?? null);
  const items = parseSavedSplitItems(session?.parsedItemsJson ?? null);
  const linkedLoans = detail.data?.loans ?? [];
  const ownShare = shares.find((share) => share.personId === 0);
  const remaining = splitBillOutstandingAmount(linkedLoans);
  const payment = detail.data?.payment;
  const sourceTransactionId = detail.data?.sourceTransactionId ?? transactionId;
  const ownExpense = detail.data?.personalShareCents ?? personalShare;
  const paidTotal = detail.data?.totalPaidCents ?? totalPaid;
  const borrowed = detail.data?.isBorrower ?? isBorrower;
  if (detail.data === null) return null;
  if (paymentLookup && detail.isPending) return <p className="mb-6 text-sm text-[var(--color-muted)]">Loading related bill…</p>;
  if (paymentLookup && detail.isError) return <div role="alert" className="mb-6 text-sm"><p>Could not load the related bill.</p><button type="button" onClick={() => void detail.refetch()} className="mt-2 font-semibold text-[var(--color-primary)]">Retry</button></div>;

  return <section aria-label="Split bill details" className="mb-6 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-low)]">
    <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
      <Users className="h-5 w-5 text-[var(--color-primary)]" />
      <div className="min-w-0 flex-1"><h2 className="font-headline font-bold">Split bill</h2>
        {session?.merchantName && <p className="truncate text-sm text-[var(--color-muted)]">{session.merchantName}</p>}
      </div>
      <span className="text-xs text-[var(--color-muted)]">#{sourceTransactionId}</span>
    </div>
    <div className="p-4">
      {!payment && <div className="text-sm"><p className="text-[var(--color-muted)]">Your expense</p><p className="mt-1 font-bold">{formatCurrency(ownExpense)}</p></div>}
      {detail.isPending ? <p className="mt-4 text-sm text-[var(--color-muted)]">Loading split details…</p>
        : detail.isError ? <div role="alert" className="mt-4 text-sm"><p>Could not load split details.</p><button type="button" onClick={() => void detail.refetch()} className="mt-2 font-semibold text-[var(--color-primary)]">Retry</button></div>
        : <>
          {payment && <div className="mt-4 rounded-xl bg-[var(--ref-surface-container-lowest)] p-3 text-sm">
            <p className="font-semibold">{payment.direction === 'lent' ? `Payment from ${payment.contactName}` : `Payment to ${payment.contactName}`}</p>
            <p className="mt-1">{formatCurrency(payment.amountCents)} · Loan #{payment.loanId}{payment.status === 'reversed' ? ' · Reversed' : ''}</p>
            <p className="mt-1 text-xs text-[var(--color-muted)]">Loan principal repayment—not new income or expense.</p>
            <Link to="/transactions" search={{ periodId: 'all', transactionId: String(sourceTransactionId) }} className="mt-2 inline-block font-semibold text-[var(--color-primary)]">View original bill →</Link>
          </div>}
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer font-semibold">{payment ? 'Who owes what' : borrowed ? 'Show repayment details' : 'Show split details'}</summary>
            <div className="pt-2">
          {items.length > 0 && <details className="text-sm"><summary className="cursor-pointer font-semibold">Bill items ({items.length})</summary><div className="mt-2 space-y-2">{items.map((item, index) => <div key={index} className="flex justify-between gap-3"><span>{item.quantity} × {item.name}</span><span className="shrink-0 tabular-nums">{formatCurrency(item.totalPrice)}</span></div>)}</div></details>}
          {session && [session.taxCents, session.serviceFeeCents, session.discountCents].some((value) => value != null && value > 0) && <p className="mt-3 text-xs text-[var(--color-muted)]">Tax {formatCurrency(session.taxCents ?? 0)} · Service {formatCurrency(session.serviceFeeCents ?? 0)} · Discount {formatCurrency(session.discountCents ?? 0)}</p>}
          <h3 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">{borrowed ? 'Your share & repayment' : 'Who owes what'}</h3>
          <div className="divide-y divide-[var(--color-border)]">
            <div className="flex justify-between gap-3 py-3 text-sm">
              <div><p className="font-semibold">{profile.data?.nickname?.trim() || (ownShare?.personName !== 'Personal share' ? ownShare?.personName : null) || 'Your share'}</p><p className="mt-1 text-xs text-[var(--color-muted)]">{borrowed ? 'Your expense' : 'Payer · personal share'}</p></div>
              <p className="font-bold tabular-nums">{formatCurrency(ownExpense)}</p>
            </div>
            {linkedLoans.map((loan) => {
              const share = shares.find((row) => row.personId === loan.contactId);
              const hasCharges = !borrowed && share && [share.subtotal, share.taxShare, share.serviceShare].some((value) => typeof value === 'number');
              return <div key={loan.id} className="flex justify-between gap-3 py-3 text-sm">
                <div className="min-w-0"><p className="font-semibold">{loan.contactName}</p>
                  <p className="mt-1 text-xs text-[var(--color-muted)]">{borrowed ? 'Payer · ' : ''}{splitLoanStatusLabel(loan.status)} · Loan #{loan.id}</p>
                  {hasCharges && <p className="mt-1 text-xs text-[var(--color-muted)]">Items {formatCurrency(share.subtotal ?? 0)} · Tax {formatCurrency(share.taxShare ?? 0)} · Service {formatCurrency(share.serviceShare ?? 0)}{share.discountShare ? ` · Discount ${formatCurrency(share.discountShare)}` : ''}</p>}
                  {!borrowed && !!share?.assignedItems?.length && <details className="mt-2 text-xs"><summary className="cursor-pointer">Assigned items</summary>{share.assignedItems.map((item, index) => <p key={index} className="mt-1 text-[var(--color-muted)]">{item.quantity} × {item.name} · {formatCurrency(item.totalPrice)}</p>)}</details>}
                </div>
                <div className="shrink-0 text-right"><p className="font-bold tabular-nums">{formatCurrency(loan.amountCents)}</p><p className="mt-1 text-xs text-[var(--color-muted)]">Remaining {formatCurrency(loan.remainingCents)}</p></div>
              </div>;
            })}
          </div>
          {!linkedLoans.length && <p className="mt-2 text-sm text-[var(--color-muted)]">No linked loans found for this transaction.</p>}
          {linkedLoans.length > 0 && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3 text-sm">
            <p>{borrowed ? 'Outstanding debt' : 'Outstanding receivables'} <span className="font-bold">{formatCurrency(remaining)}</span></p>
            <Link to="/loans" className="font-semibold text-[var(--color-primary)]">Manage repayments →</Link>
          </div>}
          {!session && <p className="mt-3 text-xs text-[var(--color-muted)]">Showing linked loans. The original itemized split was not saved.</p>}
            </div>
          </details>
        </>}
    </div>
  </section>;
}
