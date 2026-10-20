import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Dropdown } from '../settings/controls';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn, formatDate, parseIdNominalToInt } from '../../lib/utils';
import { daysFromToday, formatForeign, fromDateInput, nextRenewal, relativeDue, startOfDay, toDateInput } from './schedule';
import { useOccurrenceCandidatesQuery, useResolveOccurrencesMutation, type Subscription } from './queries';
import type { PaymentAccount } from './accounts';

const groupDigits = (value: string) => {
  const digits = value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits ? new Intl.NumberFormat('id-ID').format(Number(digits)) : '';
};

/** The next payment when the schedule restarts from `paidAt`: one interval later, on that day. */
function reanchoredNext(paidAt: number, subscription: Subscription): number {
  const anchor = new Date(startOfDay(paidAt));
  anchor.setHours(12, 0, 0, 0);
  return nextRenewal(anchor.getTime(), { ...subscription, billingDay: anchor.getDate() });
}

/** Restarting from the payment only means something when it gives a different, later date. */
function canReanchor(subscription: Subscription, dueAt: number, paidAt: number): boolean {
  const fromPayment = reanchoredNext(paidAt, subscription);
  return startOfDay(nextRenewal(dueAt, subscription)) !== startOfDay(fromPayment) && fromPayment > dueAt;
}

function ScheduleChoice({ subscription, dueAt, paidAt, reanchor, onChange }: { subscription: Subscription; dueAt: number; paidAt: number; reanchor: boolean; onChange: (next: boolean) => void }) {
  if (!canReanchor(subscription, dueAt, paidAt)) return null;
  const onSchedule = nextRenewal(dueAt, subscription);
  const fromPayment = reanchoredNext(paidAt, subscription);
  const late = startOfDay(paidAt) > startOfDay(dueAt);
  const options = [
    { value: false, title: 'Keep the schedule', detail: `Next payment ${formatDate(onSchedule)}` },
    { value: true, title: late ? 'Move it to count from this payment' : 'Count from this payment', detail: `Next payment ${formatDate(fromPayment)}` },
  ];
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1 text-sm font-medium text-[var(--color-text-secondary)]">Next payment</legend>
      {options.map((option) => (
        <label key={String(option.value)} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2', reanchor === option.value ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)]/5' : 'border-[var(--color-border)]')}>
          <input type="radio" name="reanchor" className="mt-1 accent-[var(--ref-primary)]" checked={reanchor === option.value} onChange={() => onChange(option.value)} />
          <span>
            <span className="block text-sm font-medium text-[var(--ref-on-surface)]">{option.title}</span>
            <span className="block text-xs text-[var(--ref-on-surface-variant)]">{option.detail}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Record one renewal: the payment as it actually happened (date, Rupiah amount, account), or a
 * transaction already in the ledger that paid it. Late and early payments both work.
 */
export function PaymentDialog({ subscription, dueAt, accounts, onClose, onDone }: {
  subscription: Subscription;
  dueAt: number;
  accounts: PaymentAccount[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { formatAmount } = useBalanceVisibility();
  const resolve = useResolveOccurrencesMutation();
  const [mode, setMode] = useState<'record' | 'link'>('record');
  const [now] = useState(() => Date.now());
  const today = toDateInput(now);
  const dueDay = toDateInput(dueAt);
  // Overdue or early, the likeliest payment day is today; the due date is one tap away.
  const [paidDate, setPaidDate] = useState(daysFromToday(dueAt) < 0 ? today : (dueDay <= today ? dueDay : today));
  const [amount, setAmount] = useState(new Intl.NumberFormat('id-ID').format(subscription.amount));
  const [accountId, setAccountId] = useState(String(accounts.some((account) => account.id === subscription.linkedAccountId) ? subscription.linkedAccountId : accounts[0]?.id ?? ''));
  const [reanchor, setReanchor] = useState(false);
  const [transactionId, setTransactionId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const candidates = useOccurrenceCandidatesQuery(mode === 'link' ? { subscriptionId: subscription.id, dueAt } : null);
  const chosen = candidates.data?.candidates.find((candidate) => candidate.transactionId === transactionId) ?? null;

  const paidAt = paidDate ? fromDateInput(paidDate) : now;
  const days = daysFromToday(dueAt);
  const subtitle = `${subscription.name} · due ${formatDate(dueAt)}, ${relativeDue(dueAt)}`;
  const parsedAmount = parseIdNominalToInt(amount);
  const anchorDate = mode === 'link' ? chosen?.date ?? null : paidAt;

  const moveSchedule = reanchor && anchorDate != null && canReanchor(subscription, dueAt, anchorDate);

  const submit = async () => {
    setError(null);
    try {
      if (mode === 'record') {
        if (!paidDate || paidDate > today) return setError("The payment date can't be in the future.");
        if (!Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) return setError('Enter the amount paid.');
        const result = await resolve.mutateAsync([{ subscriptionId: subscription.id, dueAt, action: 'post', amount: parsedAmount, paidAt, accountId: Number(accountId), reanchor: moveSchedule }]);
        onDone(`Payment recorded. Next payment ${formatDate(result.nextRenewals[0]?.nextRenewalAt ?? nextRenewal(dueAt, subscription))}.`);
      } else {
        if (!chosen) return setError('Pick the transaction that paid this renewal.');
        const result = await resolve.mutateAsync([{ subscriptionId: subscription.id, dueAt, action: 'link', transactionId: chosen.transactionId, reanchor: moveSchedule }]);
        onDone(`Linked to “${chosen.description}”. Next payment ${formatDate(result.nextRenewals[0]?.nextRenewalAt ?? nextRenewal(dueAt, subscription))}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the payment');
    }
  };

  return (
    <Modal
      isOpen
      onClose={() => { if (!resolve.isPending) onClose(); }}
      title="Record payment"
      overlayClassName="!z-[60]"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={resolve.isPending} onClick={onClose}>Cancel</Button>
          <Button type="button" size="sm" isLoading={resolve.isPending} onClick={() => void submit()} disabled={mode === 'link' && !chosen}>
            {mode === 'record' ? 'Record payment' : 'Link transaction'}
          </Button>
        </div>
      }
    >
      <div className="settings-compact space-y-4">
        <p className={cn('text-sm', days < 0 ? 'text-[var(--color-danger)]' : 'text-[var(--ref-on-surface-variant)]')}>{subtitle}</p>
        {error && <p role="alert" className="rounded-lg bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{error}</p>}

        <div role="radiogroup" aria-label="How it was paid" className="ui-segmented ui-segmented--2 grid grid-cols-2 gap-1 rounded-lg bg-[var(--ref-surface-container)] p-1" data-segment-index={mode === 'record' ? 0 : 1}>
          {(['record', 'link'] as const).map((option) => (
            <button key={option} type="button" role="radio" aria-checked={mode === option} onClick={() => { setMode(option); setError(null); }} className={cn('h-[26px] rounded-md text-xs font-semibold', mode === option ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]')}>
              {option === 'record' ? 'New expense' : 'Already in transactions'}
            </button>
          ))}
        </div>

        {mode === 'record' ? (
          <>
            <div className="space-y-1">
              <label htmlFor="paid-date" className="block text-sm font-medium text-[var(--color-text-secondary)]">Paid on</label>
              <input id="paid-date" type="date" max={today} className="brutalist-input" value={paidDate} onChange={(event) => setPaidDate(event.target.value)} />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[{ label: 'Today', value: today }, ...(dueDay <= today && dueDay !== today ? [{ label: 'On the due date', value: dueDay }] : [])].map((chip) => (
                  <button key={chip.label} type="button" onClick={() => setPaidDate(chip.value)} className={cn('rounded-full border px-2.5 py-0.5 text-xs font-medium', paidDate === chip.value ? 'border-[var(--ref-primary)] text-[var(--ref-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]')}>
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="paid-amount" className="block text-sm font-medium text-[var(--color-text-secondary)]">Amount paid</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-muted)]">Rp</span>
                <input id="paid-amount" className="brutalist-input brutalist-input--currency !pl-9" inputMode="numeric" value={amount} onChange={(event) => setAmount(groupDigits(event.target.value))} data-autofocus />
              </div>
              {subscription.currency && subscription.foreignAmount != null && (
                <p className="text-xs text-[var(--ref-on-surface-variant)]">
                  Billed {formatForeign(subscription.foreignAmount, subscription.currency)}; enter the Rupiah amount on your statement. The estimate is {formatAmount(subscription.amount)}.
                </p>
              )}
            </div>

            <Dropdown label="Paid from" value={accountId} options={accounts.map((account) => ({ value: String(account.id), label: account.name }))} onChange={setAccountId} />
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-[var(--ref-on-surface-variant)]">Expenses from a week before the due date to five weeks after, close to the price, that no other renewal has claimed.</p>
            {candidates.isPending ? (
              <p className="py-4 text-center text-sm text-[var(--ref-on-surface-variant)]">Looking for matching transactions…</p>
            ) : candidates.error ? (
              <p className="py-4 text-center text-sm text-[var(--color-danger)]">{candidates.error instanceof Error ? candidates.error.message : 'Could not load transactions'}</p>
            ) : (candidates.data?.candidates.length ?? 0) === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--ref-on-surface-variant)]">No matching expense found. Record it as a new expense instead.</p>
            ) : (
              <div role="radiogroup" aria-label="Matching transactions" className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
                {candidates.data!.candidates.map((candidate) => (
                  <label key={candidate.transactionId} className={cn('flex cursor-pointer items-center gap-3 px-3 py-2', transactionId === candidate.transactionId && 'bg-[var(--ref-primary)]/5')}>
                    <input type="radio" name="candidate" className="accent-[var(--ref-primary)]" checked={transactionId === candidate.transactionId} onChange={() => setTransactionId(candidate.transactionId)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--ref-on-surface)]">{candidate.description}</span>
                      <span className="block text-xs text-[var(--ref-on-surface-variant)]">{formatDate(candidate.date)}{candidate.accountName ? ` · ${candidate.accountName}` : ''}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(candidate.amount)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {anchorDate != null && <ScheduleChoice subscription={subscription} dueAt={dueAt} paidAt={anchorDate} reanchor={reanchor} onChange={setReanchor} />}
      </div>
    </Modal>
  );
}
