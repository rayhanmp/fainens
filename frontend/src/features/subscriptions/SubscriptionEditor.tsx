import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Dropdown, Toggle } from '../settings/controls';
import { cn, formatCurrency, parseIdNominalToInt } from '../../lib/utils';
import { CYCLE_PRESETS, cycleLabel, fromDateInput, monthlyEquivalent, toDateInput, type BillingCycle } from './schedule';
import { useCreateSubscriptionMutation, useUpdateSubscriptionMutation, type Subscription } from './queries';
import type { PaymentAccount } from './accounts';
import type { CreateSubscriptionBody } from '../../generated/client';
import { ICON_LABELS, ICON_MAP } from './icons';

const CURRENCIES = ['USD', 'EUR', 'SGD', 'GBP', 'AUD', 'JPY', 'MYR', 'CNY'] as const;

const UNIT_OPTIONS = [
  { value: 'daily', label: 'Days' },
  { value: 'weekly', label: 'Weeks' },
  { value: 'monthly', label: 'Months' },
  { value: 'annual', label: 'Years' },
] as const;

type Draft = {
  name: string;
  amount: string;
  cycle: string;
  customCount: string;
  customUnit: BillingCycle;
  nextRenewalDate: string;
  linkedAccountId: string;
  categoryId: string;
  paymentMode: 'auto' | 'manual';
  foreign: boolean;
  currency: string;
  foreignAmount: string;
  trial: boolean;
  trialEndsDate: string;
  notes: string;
  iconKey: string;
};

const groupDigits = (value: string) => {
  const digits = value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits ? new Intl.NumberFormat('id-ID').format(Number(digits)) : '';
};

function initialDraft(subscription: Subscription | null, accounts: PaymentAccount[]): Draft {
  if (!subscription) {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    return {
      name: '', amount: '', cycle: 'monthly-1', customCount: '2', customUnit: 'monthly',
      nextRenewalDate: toDateInput(nextMonth.getTime()), linkedAccountId: accounts[0] ? String(accounts[0].id) : '',
      categoryId: '', paymentMode: 'auto', foreign: false, currency: 'USD', foreignAmount: '',
      trial: false, trialEndsDate: '', notes: '', iconKey: 'default',
    };
  }
  const preset = CYCLE_PRESETS.find((option) => option.billingCycle === subscription.billingCycle && option.intervalCount === subscription.intervalCount);
  return {
    name: subscription.name,
    amount: new Intl.NumberFormat('id-ID').format(subscription.amount),
    cycle: preset?.value ?? 'custom',
    customCount: String(subscription.intervalCount),
    customUnit: subscription.billingCycle as BillingCycle,
    nextRenewalDate: toDateInput(subscription.nextRenewalAt),
    linkedAccountId: String(subscription.linkedAccountId),
    categoryId: subscription.categoryId != null ? String(subscription.categoryId) : '',
    paymentMode: subscription.paymentMode === 'manual' ? 'manual' : 'auto',
    foreign: subscription.currency != null,
    currency: subscription.currency ?? 'USD',
    foreignAmount: subscription.foreignAmount != null ? (subscription.foreignAmount / 100).toFixed(2) : '',
    trial: subscription.trialEndsAt != null,
    trialEndsDate: subscription.trialEndsAt != null ? toDateInput(subscription.trialEndsAt) : '',
    notes: subscription.notes ?? '',
    iconKey: ICON_MAP[subscription.iconKey] ? subscription.iconKey : 'default',
  };
}

function Field({ label, hint, children, htmlFor }: { label: string; hint?: React.ReactNode; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-[var(--color-text-secondary)]">{label}</label>
      {children}
      {hint && <p className="text-xs text-[var(--ref-on-surface-variant)]">{hint}</p>}
    </div>
  );
}

/** Add or edit a subscription. Pausing, cancelling and archiving live on the subscription's own page. */
export function SubscriptionEditor({ subscription, accounts, categories, accountNames, onClose, onSaved }: {
  subscription: Subscription | null;
  accounts: PaymentAccount[];
  categories: Array<{ id: number; name: string }>;
  accountNames: Map<number, string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(subscription, accounts));
  const [today] = useState(() => toDateInput(Date.now()));
  const [error, setError] = useState<string | null>(null);
  const create = useCreateSubscriptionMutation();
  const update = useUpdateSubscriptionMutation();
  const saving = create.isPending || update.isPending;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const preset = CYCLE_PRESETS.find((option) => option.value === draft.cycle);
  const schedule = preset
    ? { billingCycle: preset.billingCycle, intervalCount: preset.intervalCount }
    : { billingCycle: draft.customUnit, intervalCount: Math.max(1, Math.min(366, Number.parseInt(draft.customCount, 10) || 1)) };
  const amount = parseIdNominalToInt(draft.amount);
  const perMonth = amount > 0 ? monthlyEquivalent(amount, schedule) : 0;

  // A subscription may still point at an account that can no longer pay (closed, or PayLater).
  const accountOptions = accounts.map((account) => ({ value: String(account.id), label: account.name }));
  if (subscription && !accounts.some((account) => String(account.id) === draft.linkedAccountId)) {
    accountOptions.unshift({ value: draft.linkedAccountId, label: `${accountNames.get(subscription.linkedAccountId) ?? 'Unknown'} (can't pay subscriptions)` });
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const name = draft.name.trim();
    if (!name) return setError('Give the subscription a name.');
    if (!Number.isSafeInteger(amount) || amount <= 0) return setError(draft.foreign ? 'Enter the Rupiah estimate.' : 'Enter the price.');
    if (!draft.linkedAccountId) return setError('Choose the account it is paid from.');
    if (!draft.nextRenewalDate) return setError('Pick the next payment date.');
    const foreignMinor = Math.round(Number.parseFloat(draft.foreignAmount.replace(',', '.')) * 100);
    if (draft.foreign && (!Number.isSafeInteger(foreignMinor) || foreignMinor <= 0)) return setError(`Enter the price in ${draft.currency}.`);
    if (draft.trial && !draft.trialEndsDate) return setError('Pick the day the free trial ends.');

    const nextRenewalAt = fromDateInput(draft.nextRenewalDate);
    const body: CreateSubscriptionBody = {
      name,
      amount,
      linkedAccountId: Number(draft.linkedAccountId),
      categoryId: draft.categoryId ? Number(draft.categoryId) : null,
      billingCycle: schedule.billingCycle,
      intervalCount: schedule.intervalCount,
      nextRenewalAt,
      paymentMode: draft.paymentMode,
      currency: draft.foreign ? draft.currency : null,
      foreignAmount: draft.foreign ? foreignMinor : null,
      trialEndsAt: draft.trial ? fromDateInput(draft.trialEndsDate) : null,
      notes: draft.notes.trim() || null,
      iconKey: draft.iconKey as CreateSubscriptionBody['iconKey'],
    };
    try {
      if (subscription) {
        // Only send the schedule and account when they changed: the server checks both again.
        const data: Partial<CreateSubscriptionBody> = { ...body };
        if (body.linkedAccountId === subscription.linkedAccountId) delete data.linkedAccountId;
        if (toDateInput(subscription.nextRenewalAt) === draft.nextRenewalDate) delete data.nextRenewalAt;
        await update.mutateAsync({ id: subscription.id, data });
        onSaved(`${name} updated.`);
      } else {
        await create.mutateAsync(body);
        onSaved(`${name} added.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const pastDate = draft.nextRenewalDate && draft.nextRenewalDate < today;

  return (
    <Modal
      isOpen
      onClose={() => { if (!saving) onClose(); }}
      title={subscription ? `Edit ${subscription.name}` : 'Add subscription'}
      overlayClassName="!z-[60]"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-xs text-[var(--ref-on-surface-variant)]">
            {perMonth > 0 && !(schedule.billingCycle === 'monthly' && schedule.intervalCount === 1) ? `≈ ${formatCurrency(Math.round(perMonth))} a month` : ''}
          </span>
          <div className="flex shrink-0 gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
            <Button type="submit" form="subscription-editor" size="sm" isLoading={saving}>{subscription ? 'Save changes' : 'Add subscription'}</Button>
          </div>
        </div>
      }
    >
      <form id="subscription-editor" onSubmit={(event) => void submit(event)} className="settings-compact space-y-4">
        {error && <p role="alert" className="rounded-lg bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{error}</p>}

        <Field label="Name" htmlFor="sub-name">
          <input id="sub-name" className="brutalist-input" value={draft.name} onChange={(event) => set('name', event.target.value)} placeholder="Netflix, Spotify, gym…" maxLength={200} data-autofocus />
        </Field>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-[var(--color-text-secondary)]">Billed in another currency</span>
            <Toggle label="Billed in another currency" checked={draft.foreign} onChange={(next) => set('foreign', next)} />
          </div>
          {draft.foreign && (
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
              <Dropdown ariaLabel="Currency" value={draft.currency} options={CURRENCIES.map((code) => ({ value: code, label: code }))} onChange={(value) => set('currency', value)} />
              <input aria-label={`Price in ${draft.currency}`} className="brutalist-input brutalist-input--currency" inputMode="decimal" value={draft.foreignAmount} onChange={(event) => set('foreignAmount', event.target.value.replace(/[^\d.,]/g, ''))} placeholder="20.00" />
            </div>
          )}
        </div>

        <Field
          label={draft.foreign ? 'Estimate in Rupiah' : 'Price'}
          htmlFor="sub-amount"
          hint={draft.foreign ? 'Used for totals and reminders. When you record a payment you enter the Rupiah amount from your statement.' : undefined}
        >
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-muted)]">Rp</span>
            <input id="sub-amount" className="brutalist-input brutalist-input--currency !pl-9" inputMode="numeric" value={draft.amount} onChange={(event) => set('amount', groupDigits(event.target.value))} placeholder="0" />
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Repeats">
            <Dropdown ariaLabel="Repeats" value={draft.cycle} options={[...CYCLE_PRESETS.map(({ value, label }) => ({ value, label })), { value: 'custom', label: 'Custom…' }]} onChange={(value) => set('cycle', value)} />
          </Field>
          <Field label="Next payment" htmlFor="sub-next" hint={pastDate ? 'Renewals since this date will wait for you to review them.' : undefined}>
            <input id="sub-next" type="date" className="brutalist-input" value={draft.nextRenewalDate} onChange={(event) => set('nextRenewalDate', event.target.value)} />
          </Field>
        </div>
        {draft.cycle === 'custom' && (
          <div className="grid grid-cols-[auto_6rem_minmax(0,1fr)] items-center gap-2">
            <span className="text-sm text-[var(--color-text-secondary)]">Every</span>
            <input aria-label="Interval" className="brutalist-input" inputMode="numeric" value={draft.customCount} onChange={(event) => set('customCount', event.target.value.replace(/\D/g, '').slice(0, 3))} />
            <Dropdown ariaLabel="Interval unit" value={draft.customUnit} options={UNIT_OPTIONS} onChange={(value) => set('customUnit', value)} />
            <p className="col-span-3 text-xs text-[var(--ref-on-surface-variant)]">{cycleLabel(schedule)}</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Paid from">
            <Dropdown ariaLabel="Paid from" value={draft.linkedAccountId} options={accountOptions} onChange={(value) => set('linkedAccountId', value)} />
          </Field>
          <Field label="Category">
            <Dropdown ariaLabel="Category" value={draft.categoryId} options={[{ value: '', label: 'None' }, ...categories.map((category) => ({ value: String(category.id), label: category.name }))]} onChange={(value) => set('categoryId', value)} />
          </Field>
        </div>

        <Field label="How it's paid" hint={draft.paymentMode === 'auto' ? 'The provider charges the account on each renewal; you confirm the charge here.' : 'You pay it yourself each time, so record the payment when you make it — early is fine.'}>
          <div role="radiogroup" aria-label="How it's paid" className="ui-segmented ui-segmented--2 grid grid-cols-2 gap-1 rounded-lg bg-[var(--ref-surface-container)] p-1" data-segment-index={draft.paymentMode === 'auto' ? 0 : 1}>
            {(['auto', 'manual'] as const).map((mode) => (
              <button key={mode} type="button" role="radio" aria-checked={draft.paymentMode === mode} onClick={() => set('paymentMode', mode)} className={cn('h-[26px] rounded-md text-xs font-semibold', draft.paymentMode === mode ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]')}>
                {mode === 'auto' ? 'Charged automatically' : 'I pay manually'}
              </button>
            ))}
          </div>
        </Field>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-[var(--color-text-secondary)]">Free trial</span>
            <Toggle label="Free trial" checked={draft.trial} onChange={(next) => setDraft((current) => ({ ...current, trial: next, trialEndsDate: current.trialEndsDate || current.nextRenewalDate }))} />
          </div>
          {draft.trial && (
            <Field label="Trial ends" htmlFor="sub-trial" hint="You'll see a reminder before the first paid renewal, so you can cancel in time.">
              <input id="sub-trial" type="date" className="brutalist-input" value={draft.trialEndsDate} onChange={(event) => set('trialEndsDate', event.target.value)} />
            </Field>
          )}
        </div>

        <Field label="Icon">
          <div role="radiogroup" aria-label="Icon" className="flex flex-wrap gap-1.5">
            {Object.entries(ICON_MAP).map(([key, Icon]) => (
              <button key={key} type="button" role="radio" aria-checked={draft.iconKey === key} aria-label={ICON_LABELS[key]} title={ICON_LABELS[key]} onClick={() => set('iconKey', key)}
                className={cn('grid h-[34px] w-[34px] place-items-center rounded-lg border transition-colors', draft.iconKey === key ? 'border-[var(--ref-primary)] text-[var(--ref-primary)]' : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text-primary)]')}>
                <Icon className="h-4 w-4" aria-hidden />
              </button>
            ))}
          </div>
        </Field>

        <Field label="Notes" htmlFor="sub-notes">
          <textarea id="sub-notes" className="brutalist-input min-h-[68px] resize-y" value={draft.notes} onChange={(event) => set('notes', event.target.value)} placeholder="Account email, how to cancel, family plan members…" maxLength={1000} />
        </Field>
      </form>
    </Modal>
  );
}
