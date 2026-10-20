import { useState, type ReactNode } from 'react';
import { Calculator, FolderOpen, Landmark, MapPin, Pencil, Save, Sparkles, Wallet, X } from 'lucide-react';
import { ComboBox, DateTimeField, EntryTypeSwitch, Field, fieldControl, type PickerOption } from '../../components/transactions/EntryPickers';
import { entryAccent } from '../../components/transactions/entry-types';
import { Button } from '../../components/ui/Button';
import { CurrencyInput } from '../../components/ui/CurrencyInput';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { useSequence } from './motion';
import { exampleAccounts, useHelpPersonal } from './personal';
import { VisualFrame } from './visuals';

/**
 * The Add transaction dialog, drawn with its own controls (type switch, amount, fields, pickers,
 * date) inside a copy of its frame. It fills itself in step by step; you can still click around,
 * but there is no Save here: use the practice composer, or Add transaction, for that.
 */

const CATEGORY_OPTIONS: PickerOption[] = ['Food & Dining', 'Groceries', 'Transportation', 'Shopping', 'Entertainment'].map((name) => ({ id: name, label: name }));

function localNow() {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The dialog’s frame: title with the Journal switch, the form, and the read-back footer. */
function ComposerShell({ children, summary, saveLabel }: { children: ReactNode; summary: ReactNode; saveLabel: string }) {
  return (
    <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
      <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="font-headline text-2xl font-extrabold tracking-tight text-[var(--color-text-primary)]">Add transaction</h2>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]"><Calculator className="h-3.5 w-3.5 opacity-70" /> Journal</span>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 rounded-lg p-1.5 text-[var(--color-muted)]"><X className="h-5 w-5" aria-hidden /><span className="text-sm font-medium">Cancel</span></span>
      </div>
      <div className="p-5">{children}</div>
      <div className="flex flex-col gap-3 border-t border-[var(--color-border)] p-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 text-sm leading-snug text-[var(--ref-on-surface-variant)] sm:truncate" aria-live="polite">{summary}</p>
        <Button type="button" tabIndex={-1} className="pointer-events-none shrink-0 rounded-full px-6 py-3 text-base shadow-lg sm:min-w-[12rem]"><Save className="mr-2 h-5 w-5" />{saveLabel}</Button>
      </div>
    </div>
  );
}

const strong = (text: string) => <strong className="font-semibold text-[var(--ref-on-surface)]">{text}</strong>;

/** An expense being typed in: amount, name, the suggested category, then the read-back. */
export function ComposerDemo() {
  const { ref, step, replay } = useSequence(4, 1000);
  const { formatAmount } = useBalanceVisibility();
  const { first, second } = exampleAccounts(useHelpPersonal());
  const accounts: PickerOption[] = [first, second].map((name) => ({ id: name, label: name }));
  const [when, setWhen] = useState(localNow);
  const [type, setType] = useState<'expense' | 'income' | 'transfer' | 'paylater'>('expense');
  // Follows your account names as they load, until you pick one.
  const [pickedAccount, setAccount] = useState<string | null>(null);
  const account = pickedAccount ?? second;
  const [category, setCategory] = useState('');
  const chosenCategory = category || (step >= 4 ? 'Food & Dining' : '');
  const amount = step >= 1 ? '25.000' : '';
  const name = step >= 2 ? 'Kopi susu' : '';

  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="The real form controls, filling in a sample expense. Type 25k and a name; Fainens suggests the category and reads the entry back.">
      <ComposerShell saveLabel={{ expense: 'Save expense', income: 'Save income', transfer: 'Save transfer', paylater: 'Record payment' }[type]} summary={chosenCategory && amount ? <>{strong(formatAmount(25_000))} on {strong(chosenCategory)} from {strong(account)} · today</> : null}>
        <div className="space-y-6">
          <EntryTypeSwitch value={type} onChange={setType} />
          <div style={{ '--color-accent': entryAccent(type) } as React.CSSProperties}>
            <CurrencyInput label="Amount spent" value={amount} onChange={() => undefined} size="md" />
          </div>
          <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
            <Field label="Name" icon={Pencil} className="sm:col-span-2" hint={step >= 3 && !category ? (
              <span className="flex items-center gap-1.5 text-xs font-normal"><Sparkles className="h-3.5 w-3.5 text-[var(--ref-primary)]" aria-hidden />Looks like <strong className="font-semibold">Food &amp; Dining</strong><button type="button" onClick={() => setCategory('Food & Dining')} className="ml-1 rounded px-1.5 py-0.5 font-semibold text-[var(--ref-primary)] hover:bg-[var(--ref-primary)]/10">Use it</button></span>
            ) : undefined}>
              <input type="text" value={name} readOnly placeholder="e.g. Weekly groceries at Alfamart" className={fieldControl} />
            </Field>
            <Field label="Category" icon={FolderOpen}>
              <ComboBox value={chosenCategory} options={CATEGORY_OPTIONS} onChange={setCategory} placeholder="Choose a category" searchPlaceholder="Search categories" />
            </Field>
            <Field label="Paid from" icon={Wallet}>
              <ComboBox value={account} options={accounts} onChange={setAccount} placeholder="Choose an account" searchPlaceholder="Search accounts" />
            </Field>
            <DateTimeField value={when} onChange={setWhen} />
            <Field label="Place" icon={MapPin} hint={<span className="text-xs font-normal text-[var(--ref-outline)]">Optional</span>}>
              <input type="text" readOnly placeholder="e.g. Starbucks, Indomaret, Online" className={fieldControl} />
            </Field>
          </div>
        </div>
      </ComposerShell>
    </VisualFrame>
  );
}

/** A transfer between two accounts, with a fee paid by the sender. */
export function TransferDemo() {
  const { ref, step, replay } = useSequence(2, 1100);
  const { formatAmount } = useBalanceVisibility();
  const { first, second } = exampleAccounts(useHelpPersonal());
  const accounts: PickerOption[] = [first, second].map((name) => ({ id: name, label: name }));
  const [when, setWhen] = useState(localNow);
  const [pickedFrom, setFrom] = useState<string | null>(null);
  const [pickedTo, setTo] = useState<string | null>(null);
  const from = pickedFrom ?? first;
  const to = pickedTo ?? second;

  return (
    <VisualFrame frameRef={ref} onReplay={replay} caption="The transfer form. The fee shows under the amount and is recorded as its own small expense.">
      <ComposerShell saveLabel="Save transfer" summary={step >= 2 ? <>{strong(formatAmount(100_000))} from {strong(from)} to {strong(to)} · today</> : null}>
        <div className="space-y-6">
          <EntryTypeSwitch value="transfer" onChange={() => undefined} />
          <div style={{ '--color-accent': entryAccent('transfer') } as React.CSSProperties}>
            <CurrencyInput label="Amount to send" value={step >= 1 ? '100.000' : ''} onChange={() => undefined} size="md" hint={step >= 2 ? `+ ${formatAmount(2_500)} transfer fee paid by the sender` : undefined} />
          </div>
          <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
            <Field label="From" icon={Wallet}><ComboBox value={from} options={accounts} onChange={setFrom} placeholder="Source account" searchPlaceholder="Search accounts" /></Field>
            <Field label="To" icon={Landmark}><ComboBox value={to} options={accounts.map((option) => (option.id === from ? { ...option, disabled: true, disabledReason: 'Same as source' } : option))} onChange={setTo} placeholder="Destination account" searchPlaceholder="Search accounts" /></Field>
            <DateTimeField value={when} onChange={setWhen} className="sm:col-span-2" />
          </div>
        </div>
      </ComposerShell>
    </VisualFrame>
  );
}
