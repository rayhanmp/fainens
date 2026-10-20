import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { Dropdown, SettingsRow } from '../settings/controls';
import { PaymentHistory, type DatedHistoryEntry } from './PaymentHistory';
import { FindPaymentsDialog } from './FindPaymentsDialog';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn, formatDate, parseIdNominalToInt } from '../../lib/utils';
import { cycleLabel, cycleSuffix, daysFromToday, displayStatus, formatForeign, fromDateInput, nextRenewal, relativeDue, renews, STATUS_LABELS, toDateInput, type DisplayStatus } from './schedule';
import {
  useCorrectOccurrenceMutation,
  useDeleteSubscriptionMutation,
  useDetachPastPaymentMutation,
  useSubscriptionHistoryQuery,
  useUnlinkOccurrenceMutation,
  useUpdateSubscriptionMutation,
  useVoidOccurrenceMutation,
  type RenewalOccurrence,
  type Subscription,
} from './queries';
import type { PaymentAccount } from './accounts';

/** A quiet text badge: status colours only where they mean something (late, ending). */
export function StatusBadge({ status }: { status: DisplayStatus }) {
  const tone = status === 'overdue' ? 'text-[var(--color-danger)] border-[var(--color-danger)]/40'
    : status === 'due-soon' || status === 'trial' || status === 'ending' ? 'text-[var(--ref-primary)] border-[var(--ref-primary)]/40'
    : 'text-[var(--ref-on-surface-variant)] border-[var(--color-border)]';
  return <span className={cn('inline-flex shrink-0 items-center rounded-full border px-2 py-px text-[11px] font-semibold', tone)}>{STATUS_LABELS[status]}</span>;
}

const groupDigits = (value: string) => {
  const digits = value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits ? new Intl.NumberFormat('id-ID').format(Number(digits)) : '';
};

/** The first renewal on the subscription's own schedule that isn't past yet. */
function nextUpcoming(subscription: Subscription): number {
  let dueAt = subscription.nextRenewalAt;
  for (let guard = 0; guard < 2000 && daysFromToday(dueAt) < 0; guard += 1) dueAt = nextRenewal(dueAt, subscription);
  return dueAt;
}

function DateDialog({ title, intro, label, initial, chips, confirmLabel, busy, onCancel, onConfirm, hint }: {
  title: string;
  intro: React.ReactNode;
  label: string;
  initial: string;
  chips: Array<{ label: string; value: string }>;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (value: string) => void;
  hint?: (value: string) => React.ReactNode;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Modal
      isOpen
      onClose={() => { if (!busy) onCancel(); }}
      title={title}
      overlayClassName="!z-[60]"
      footer={<div className="flex justify-end gap-2"><Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button><Button type="button" size="sm" isLoading={busy} disabled={!value} onClick={() => onConfirm(value)}>{confirmLabel}</Button></div>}
    >
      <div className="settings-compact space-y-3">
        <p className="text-sm text-[var(--ref-on-surface-variant)]">{intro}</p>
        <div className="space-y-1">
          <label htmlFor="lifecycle-date" className="block text-sm font-medium text-[var(--color-text-secondary)]">{label}</label>
          <input id="lifecycle-date" type="date" className="brutalist-input" value={value} onChange={(event) => setValue(event.target.value)} />
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <button key={chip.label} type="button" onClick={() => setValue(chip.value)} className={cn('rounded-full border px-2.5 py-0.5 text-xs font-medium', value === chip.value ? 'border-[var(--ref-primary)] text-[var(--ref-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]')}>{chip.label}</button>
            ))}
          </div>
        )}
        {hint && value && <p className="text-xs text-[var(--ref-on-surface-variant)]">{hint(value)}</p>}
      </div>
    </Modal>
  );
}


function FixDialog({ subscription, entry, kind, accounts, onClose, onDone }: {
  subscription: Subscription;
  entry: DatedHistoryEntry;
  kind: 'correct' | 'void';
  accounts: PaymentAccount[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const correct = useCorrectOccurrenceMutation();
  const voidIt = useVoidOccurrenceMutation();
  const busy = correct.isPending || voidIt.isPending;
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState(new Intl.NumberFormat('id-ID').format(entry.transaction?.amount ?? subscription.amount));
  const [accountId, setAccountId] = useState(String(subscription.linkedAccountId));
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    if (!reason.trim()) return setError('Say why, so the ledger keeps the reason.');
    try {
      if (kind === 'void') {
        await voidIt.mutateAsync({ subscriptionId: subscription.id, dueAt: entry.dueAt, reason: reason.trim() });
        onDone('Renewal voided; its charge was reversed on its own date.');
      } else {
        const parsed = parseIdNominalToInt(amount);
        if (!Number.isSafeInteger(parsed) || parsed <= 0) return setError('Enter the correct amount.');
        await correct.mutateAsync({ subscriptionId: subscription.id, dueAt: entry.dueAt, data: { reason: reason.trim(), amount: parsed, linkedAccountId: Number(accountId) } });
        onDone('Renewal corrected with a reversal and a replacement entry.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not fix the renewal');
    }
  };
  return (
    <Modal
      isOpen
      onClose={() => { if (!busy) onClose(); }}
      title={kind === 'void' ? 'Void this renewal' : 'Correct this renewal'}
      overlayClassName="!z-[60]"
      footer={<div className="flex justify-end gap-2"><Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><Button type="button" size="sm" variant={kind === 'void' ? 'danger' : 'primary'} isLoading={busy} onClick={() => void submit()}>{kind === 'void' ? 'Void renewal' : 'Correct renewal'}</Button></div>}
    >
      <div className="settings-compact space-y-3">
        <p className="text-sm text-[var(--ref-on-surface-variant)]">
          {kind === 'void'
            ? `Use this when the ${formatDate(entry.dueAt)} renewal never charged anything. Its entry is reversed on its own date and the renewal counts as skipped.`
            : `Use this when the ${formatDate(entry.dueAt)} renewal charged a different amount or account. The original is reversed and a replacement is posted today.`}
        </p>
        {error && <p role="alert" className="rounded-lg bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{error}</p>}
        {kind === 'correct' && (
          <>
            <div className="space-y-1">
              <label htmlFor="fix-amount" className="block text-sm font-medium text-[var(--color-text-secondary)]">Correct amount</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-muted)]">Rp</span>
                <input id="fix-amount" className="brutalist-input brutalist-input--currency !pl-9" inputMode="numeric" value={amount} onChange={(event) => setAmount(groupDigits(event.target.value))} />
              </div>
            </div>
            <Dropdown label="Paid from" value={accountId} options={accounts.map((account) => ({ value: String(account.id), label: account.name }))} onChange={setAccountId} />
          </>
        )}
        <div className="space-y-1">
          <label htmlFor="fix-reason" className="block text-sm font-medium text-[var(--color-text-secondary)]">Reason</label>
          <input id="fix-reason" className="brutalist-input" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder={kind === 'void' ? 'No charge on the statement' : 'Price went up'} data-autofocus />
        </div>
      </div>
    </Modal>
  );
}

/** One subscription: what it costs, how it renews, what it has actually charged, and its lifecycle. */
export function SubscriptionDetail({ subscription, overdue, accounts, accountNames, categories, onClose, onEdit, onRecord, onSkip, onMessage }: {
  subscription: Subscription;
  /** Every past-due renewal; this subscription's are picked out here. */
  overdue: RenewalOccurrence[];
  accounts: PaymentAccount[];
  accountNames: Map<number, string>;
  categories: Array<{ id: number; name: string }>;
  onClose: () => void;
  onEdit: () => void;
  onRecord: (dueAt: number) => void;
  onSkip: (occurrence: RenewalOccurrence) => void;
  onMessage: (message: string, tone?: 'success' | 'error') => void;
}) {
  const late = overdue.filter((item) => item.subscriptionId === subscription.id).sort((a, b) => a.dueAt - b.dueAt);
  const overdueIds = new Set(overdue.map((item) => item.subscriptionId));
  const { formatAmount } = useBalanceVisibility();
  const { confirm } = useConfirm();
  const history = useSubscriptionHistoryQuery(subscription.id);
  const update = useUpdateSubscriptionMutation();
  const archive = useDeleteSubscriptionMutation();
  const unlink = useUnlinkOccurrenceMutation();
  const [dialog, setDialog] = useState<null | 'resume' | 'cancel'>(null);
  const [openedAt] = useState(() => Date.now());
  const [fixing, setFixing] = useState<{ entry: DatedHistoryEntry; kind: 'correct' | 'void' } | null>(null);
  const [finding, setFinding] = useState(false);
  const detach = useDetachPastPaymentMutation();
  const detachIt = async (transactionId: number) => {
    const ok = await confirm({
      title: 'Detach this payment?',
      message: `It stays in your transactions but stops counting as a ${subscription.name} payment.`,
      confirmLabel: 'Detach',
    });
    if (!ok) return;
    try {
      await detach.mutateAsync({ subscriptionId: subscription.id, transactionId });
      onMessage('Payment detached.');
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Could not detach', 'error');
    }
  };
  const status = displayStatus(subscription, overdueIds);
  const category = categories.find((item) => item.id === subscription.categoryId);
  const canPay = renews(subscription) && !overdueIds.has(subscription.id);

  const patch = async (data: Parameters<typeof update.mutateAsync>[0]['data'], message: string) => {
    try {
      await update.mutateAsync({ id: subscription.id, data });
      setDialog(null);
      onMessage(message);
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Could not update the subscription', 'error');
    }
  };

  const archiveIt = async () => {
    const ok = await confirm({
      title: `Archive ${subscription.name}?`,
      message: 'It leaves your lists and totals. Its payment history stays in the ledger, and you can restore it from Archived.',
      confirmLabel: 'Archive',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await archive.mutateAsync(subscription.id);
      onMessage(`${subscription.name} archived.`);
      onClose();
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Could not archive', 'error');
    }
  };

  const unlinkIt = async (entry: DatedHistoryEntry) => {
    const ok = await confirm({
      title: 'Unlink this transaction?',
      message: `“${entry.transaction?.description}” stays in your transactions but stops paying the ${formatDate(entry.dueAt)} renewal, which then counts as skipped.`,
      confirmLabel: 'Unlink',
    });
    if (!ok) return;
    try {
      await unlink.mutateAsync({ subscriptionId: subscription.id, dueAt: entry.dueAt });
      onMessage('Transaction unlinked.');
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Could not unlink', 'error');
    }
  };

  const today = toDateInput(openedAt);
  const resumeDefault = toDateInput(nextUpcoming(subscription));
  const dayBeforeNext = (() => { const d = new Date(subscription.nextRenewalAt); d.setDate(d.getDate() - 1); return d.getTime(); })();
  const cancelDefault = daysFromToday(dayBeforeNext) >= 0 ? toDateInput(dayBeforeNext) : today;

  // What can be done to the subscription itself, each with what it means, as Settings lays out a row.
  const busy = update.isPending || archive.isPending;
  const manage: Array<{ key: string; label: string; detail: string; action: string; run: () => void; danger?: boolean }> = [];
  if (subscription.status === 'active') {
    manage.push({ key: 'pause', label: 'Pause', detail: 'No renewals are due until you resume it.', action: 'Pause', run: () => void patch({ status: 'paused' }, `${subscription.name} paused. No renewals are due while it's paused.`) });
    manage.push({ key: 'cancel', label: 'Cancel', detail: 'Pick its last day; nothing after it is due.', action: 'Cancel…', run: () => setDialog('cancel') });
  } else {
    manage.push({
      key: 'resume',
      label: subscription.status === 'paused' ? 'Resume' : subscription.status === 'archived' ? 'Restore' : 'Reactivate',
      detail: 'Pick the next payment date and it renews again.',
      action: subscription.status === 'paused' ? 'Resume…' : subscription.status === 'archived' ? 'Restore…' : 'Reactivate…',
      run: () => setDialog('resume'),
    });
  }
  if (subscription.status !== 'archived') {
    manage.push({ key: 'archive', label: 'Archive', detail: 'Hide it from lists and totals. Its payments stay in the ledger.', action: 'Archive', run: () => void archiveIt(), danger: true });
  }

  const accountName = accountNames.get(subscription.linkedAccountId) ?? subscription.linkedAccountName;
  const renewing = renews(subscription);
  const facts: Array<[string, string]> = [
    ['Paid from', accountName],
    ['How it’s paid', subscription.paymentMode === 'manual' ? 'By hand each time' : 'Charged automatically'],
    ['Category', category?.name ?? 'None'],
    ['Repeats', cycleLabel(subscription)],
    ...(subscription.currency && subscription.foreignAmount != null ? [['Billed in', `${formatForeign(subscription.foreignAmount, subscription.currency)} (estimate above)`] as [string, string]] : []),
    ...(subscription.trialEndsAt != null ? [['Free trial ends', formatDate(subscription.trialEndsAt)] as [string, string]] : []),
    ...(subscription.endsAt != null ? [[status === 'ended' ? 'Ended' : 'Last day', formatDate(subscription.endsAt)] as [string, string]] : []),
  ];
  const nextLabel = status === 'paused' ? 'Paused' : status === 'archived' ? 'Archived' : !renewing ? 'Ended' : formatDate(subscription.nextRenewalAt);
  const nextDetail = renewing && status !== 'paused' && status !== 'archived' ? relativeDue(subscription.nextRenewalAt) : status === 'paused' ? 'Resume it to renew' : '';

  return (
    <>
      <Modal
        isOpen
        onClose={onClose}
        title={subscription.name}
        size="xl"
        showCloseLabel={false}
        className="max-w-[min(640px,94vw)]"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={onEdit}>Edit</Button>
            {canPay && <Button type="button" size="sm" onClick={() => onRecord(subscription.nextRenewalAt)}>{subscription.paymentMode === 'manual' ? 'Pay now' : 'Record payment'}</Button>}
          </div>
        }
      >
        <div className="space-y-6">
          {/* What it costs, and when it next charges. */}
          <div className="grid grid-cols-2 overflow-hidden rounded-2xl bg-[var(--ref-surface-container-low)]">
            <div className="min-w-0 p-4 sm:p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">Costs</p>
              <p className="mt-1 truncate text-xl font-bold tabular-nums text-[var(--ref-on-surface)] sm:text-2xl">
                {formatAmount(subscription.amount)}<span className="ml-1 text-sm font-medium text-[var(--ref-on-surface-variant)]">{cycleSuffix(subscription)}</span>
              </p>
              <p className="mt-0.5 truncate text-xs text-[var(--ref-on-surface-variant)]">About {formatAmount(Math.round((subscription.monthlyEquivalent * 12) / 1000) * 1000)} a year</p>
            </div>
            <div className="min-w-0 border-l border-[var(--color-border)]/70 p-4 sm:p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">{late.length > 0 ? 'Past due' : 'Next payment'}</p>
              <p className={cn('mt-1 truncate text-xl font-bold tabular-nums sm:text-2xl', late.length > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-[var(--ref-on-surface)]')}>{late.length > 0 ? formatDate(late[0].dueAt) : nextLabel}</p>
              <p className="mt-0.5 truncate text-xs text-[var(--ref-on-surface-variant)]">{late.length > 0 ? relativeDue(late[0].dueAt) : nextDetail}{status === 'trial' && subscription.trialEndsAt ? ` · trial ends ${formatDate(subscription.trialEndsAt)}` : ''}</p>
            </div>
          </div>

          {late.length > 0 && (
            <div className="space-y-2">
              {late.map((item, index) => (
                <div key={item.dueAt} className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--ref-on-surface)]">The {formatDate(item.dueAt)} renewal isn’t recorded</p>
                    <p className="text-xs text-[var(--ref-on-surface-variant)]">{relativeDue(item.dueAt)} · {formatAmount(item.amount)} expected from {accountName}</p>
                  </div>
                  {index === 0 ? (
                    <div className="grid grid-cols-2 gap-2 sm:flex">
                      <Button type="button" size="sm" variant="secondary" onClick={() => onSkip(item)}>Skip</Button>
                      <Button type="button" size="sm" onClick={() => onRecord(item.dueAt)}>Record payment</Button>
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--ref-on-surface-variant)]">After the one above</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            {facts.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-[10px] font-bold uppercase tracking-widest text-[var(--ref-outline)]">{label}</dt>
                <dd className="mt-0.5 truncate text-sm text-[var(--ref-on-surface)]">{value}</dd>
              </div>
            ))}
          </dl>
          {subscription.notes && <p className="whitespace-pre-wrap rounded-xl bg-[var(--ref-surface-container-low)] px-4 py-3 text-sm text-[var(--ref-on-surface-variant)]">{subscription.notes}</p>}

          <section>
            <div className="mb-1 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[var(--ref-on-surface)]">Payments</h3>
                {history.data && history.data.paidCount > 0 && <p className="text-xs tabular-nums text-[var(--ref-on-surface-variant)]">{formatAmount(history.data.totalPaid)} across {history.data.paidCount} payment{history.data.paidCount === 1 ? '' : 's'}</p>}
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={() => setFinding(true)}>Find missing payments</Button>
            </div>
            <PaymentHistory history={history} onUnlink={(entry) => void unlinkIt(entry)} onDetach={(transactionId) => void detachIt(transactionId)} onFix={(entry, kind) => setFixing({ entry, kind })} />
          </section>

          <section className="settings-compact">
            <h3 className="mb-2 text-sm font-semibold text-[var(--ref-on-surface)]">Manage</h3>
            <div className="rounded-xl border border-[var(--color-border)] px-4 py-3">
              {manage.map((row) => (
                <SettingsRow
                  key={row.key}
                  inline
                  label={row.label}
                  description={row.detail}
                  action={<Button type="button" size="sm" variant="secondary" disabled={busy} onClick={row.run} className={row.danger ? 'text-[var(--color-danger)]' : undefined}>{row.action}</Button>}
                />
              ))}
            </div>
          </section>
        </div>
      </Modal>

      {dialog === 'resume' && (
        <DateDialog
          title={subscription.status === 'paused' ? `Resume ${subscription.name}` : subscription.status === 'archived' ? `Restore ${subscription.name}` : `Reactivate ${subscription.name}`}
          intro="When is the next payment? Renewals before it are left alone."
          label="Next payment"
          initial={resumeDefault}
          chips={[{ label: 'Next on its schedule', value: resumeDefault }, { label: 'Today', value: today }]}
          confirmLabel={subscription.status === 'archived' ? 'Restore' : 'Resume'}
          busy={update.isPending}
          onCancel={() => setDialog(null)}
          hint={(value) => value < today ? 'Renewals from this date until today will wait for review.' : null}
          onConfirm={(value) => {
            const nextRenewalAt = fromDateInput(value);
            void patch({ status: 'active', endsAt: null, ...(nextRenewalAt !== subscription.nextRenewalAt ? { nextRenewalAt } : {}) }, `${subscription.name} is active again. Next payment ${formatDate(nextRenewalAt)}.`);
          }}
        />
      )}
      {dialog === 'cancel' && (
        <DateDialog
          title={`Cancel ${subscription.name}`}
          intro="Pick its last day. Renewals up to then are still due; nothing after it is."
          label="Last day"
          initial={cancelDefault}
          chips={[...(cancelDefault !== today ? [{ label: 'Before the next payment', value: cancelDefault }] : []), { label: 'Today', value: today }]}
          confirmLabel="Cancel subscription"
          busy={update.isPending}
          onCancel={() => setDialog(null)}
          hint={(value) => fromDateInput(value) >= subscription.nextRenewalAt ? `The ${formatDate(subscription.nextRenewalAt)} payment is still due.` : 'No more payments are due.'}
          onConfirm={(value) => void patch({ status: 'cancelled', endsAt: fromDateInput(value) }, `${subscription.name} cancelled from ${formatDate(fromDateInput(value))}.`)}
        />
      )}
      {finding && <FindPaymentsDialog subscription={subscription} onClose={() => setFinding(false)} onMessage={onMessage} />}
      {fixing && (
        <FixDialog
          subscription={subscription}
          entry={fixing.entry}
          kind={fixing.kind}
          accounts={accounts}
          onClose={() => setFixing(null)}
          onDone={(message) => { setFixing(null); onMessage(message); }}
        />
      )}
    </>
  );
}
