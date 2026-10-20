import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { formatDate } from '../../lib/utils';
import { useAttachPastPaymentMutation, usePastPaymentsQuery, type Subscription } from './queries';

const REASON: Record<'name' | 'amount' | 'both', string> = {
  both: 'Name and price match',
  name: 'Name matches',
  amount: 'Same price',
};

/**
 * Expenses entered by hand that look like this subscription's payments. Each is attached on its
 * own, after a confirmation: it fills the skipped renewal it sits next to, or else is tagged to
 * the subscription. Its amount and date stay as they are.
 */
export function FindPaymentsDialog({ subscription, onClose, onMessage }: {
  subscription: Subscription;
  onClose: () => void;
  onMessage: (message: string, tone?: 'success' | 'error') => void;
}) {
  const { formatAmount } = useBalanceVisibility();
  const { confirm } = useConfirm();
  const candidates = usePastPaymentsQuery(subscription.id);
  const attach = useAttachPastPaymentMutation();

  const attachOne = async (candidate: NonNullable<typeof candidates.data>['candidates'][number]) => {
    const ok = await confirm({
      title: `Attach to ${subscription.name}?`,
      message: candidate.skippedDueAt != null
        ? `“${candidate.description}” (${formatDate(candidate.date)}, ${formatAmount(candidate.amount)}) becomes the payment for the ${formatDate(candidate.skippedDueAt)} renewal, which was marked skipped. The transaction itself doesn't change.`
        : `“${candidate.description}” (${formatDate(candidate.date)}, ${formatAmount(candidate.amount)}) is counted as one of its payments. The transaction itself doesn't change.`,
      confirmLabel: 'Attach',
    });
    if (!ok) return;
    try {
      await attach.mutateAsync({ subscriptionId: subscription.id, transactionId: candidate.transactionId, dueAt: candidate.skippedDueAt });
      onMessage('Payment attached.');
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Could not attach the payment', 'error');
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Find missing payments"
      overlayClassName="!z-[60]"
      footer={<div className="flex justify-end"><Button type="button" size="sm" variant="secondary" onClick={onClose}>Done</Button></div>}
    >
      <p className="text-sm text-[var(--ref-on-surface-variant)]">
        Expenses from the last year that look like {subscription.name} but aren’t counted as its payments. Attach the ones that are.
      </p>
      <div className="mt-4">
        {candidates.isPending ? (
          <div className="space-y-2" aria-busy>{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-[var(--color-muted)]/15" />)}</div>
        ) : candidates.error ? (
          <p className="text-sm text-[var(--color-danger)]">{candidates.error instanceof Error ? candidates.error.message : 'Could not look for payments'}</p>
        ) : candidates.data!.candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--ref-on-surface-variant)]">Nothing found. Every payment that looks like this one is already counted.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)]">
            {candidates.data!.candidates.map((candidate) => (
              <li key={candidate.transactionId} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--ref-on-surface)]">{candidate.description}</p>
                  <p className="truncate text-xs text-[var(--ref-on-surface-variant)]">
                    {formatDate(candidate.date)} · {candidate.accountName} · {REASON[candidate.reason]}
                    {candidate.skippedDueAt != null ? ` · fills the ${formatDate(candidate.skippedDueAt)} renewal` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(candidate.amount)}</span>
                <Button type="button" size="sm" variant="secondary" disabled={attach.isPending} onClick={() => void attachOne(candidate)}>Attach</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
