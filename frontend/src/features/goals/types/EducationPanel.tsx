import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { cn } from '../../../lib/utils';
import { Field, MoneyField, PercentField } from '../../savings/fields';
import { Dropdown } from '../../settings/controls';
import { Section } from '../../subscriptions/PageParts';
import { Figure } from './PanelParts';
import { nextFee, termDates } from './type-math';

type Fee = { id: number; name: string; amount: number; dueAt: number | null; paidAt: number | null };
const date = (time: number) => new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const monthYear = (time: number) => new Date(time).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
const REPEAT = [{ value: '0', label: 'Once' }, { value: '3', label: 'Every 3 months' }, { value: '6', label: 'Every 6 months' }, { value: '12', label: 'Every year' }] as const;

/** Adds a fee, or a run of them that repeats each term or year. */
function AddFees({ onAdd }: { onAdd: (fees: Array<{ name: string; amount: number; dueAt: number }>) => Promise<void> }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState(0);
  const [first, setFirst] = useState('');
  const [every, setEvery] = useState<(typeof REPEAT)[number]['value']>('0');
  const [count, setCount] = useState(4);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim() || !amount || !first) return;
    const [year, month, day] = first.split('-').map(Number);
    const start = new Date(year, month - 1, day, 12).getTime();
    const dates = every === '0' ? [start] : termDates(start, Number(every), count);
    setBusy(true);
    try {
      await onAdd(dates.map((dueAt) => ({ name: dates.length > 1 ? `${name.trim()}, ${monthYear(dueAt)}` : name.trim(), amount, dueAt })));
      setName('');
      setAmount(0);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="settings-compact mt-4 grid grid-cols-2 gap-3 rounded-xl bg-[var(--ref-surface-container-low)] p-3 @lg:grid-cols-4">
      <Field label="Fee" htmlFor="fee-name" className="col-span-2">
        <input id="fee-name" className="brutalist-input h-[34px] w-full" placeholder="Term fee, entry fee, books…" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Amount" htmlFor="fee-amount" className="col-span-2">
        <MoneyField id="fee-amount" value={amount} onChange={setAmount} />
      </Field>
      <Field label="Due" htmlFor="fee-due" className="col-span-2 @lg:col-span-1">
        <input id="fee-due" type="date" className="brutalist-input h-[34px] w-full" value={first} onChange={(event) => setFirst(event.target.value)} />
      </Field>
      <div className="col-span-2 @lg:col-span-1"><Dropdown label="Repeats" value={every} options={REPEAT} onChange={setEvery} /></div>
      {every !== '0' && (
        <Field label="Times" htmlFor="fee-count">
          <PercentField id="fee-count" suffix="×" value={count} min={2} max={24} onChange={(value) => setCount(Math.round(value))} />
        </Field>
      )}
      <div className={cn('flex items-end', every === '0' ? 'col-span-2' : 'col-span-1')}>
        <Button type="submit" size="sm" isLoading={busy} disabled={!name.trim() || !amount || !first} className="h-[34px] w-full"><Plus className="mr-1 inline h-3.5 w-3.5" aria-hidden />Add</Button>
      </div>
    </form>
  );
}

/**
 * A school's fees by when they're due: the next one with how long until it and whether the goal
 * holds enough for it, then every dated fee in order. Fees repeat by term or year when added.
 */
export function EducationPanel({ fees, held, now, onAddFees }: {
  fees: readonly Fee[];
  held: number;
  now: number;
  onAddFees?: (fees: Array<{ name: string; amount: number; dueAt: number }>) => Promise<void>;
}) {
  const { formatAmount } = useBalanceVisibility();
  const next = nextFee(fees, now);
  const dated = fees.filter((fee) => fee.dueAt !== null).sort((a, b) => a.dueAt! - b.dueAt!);
  const enough = next ? held >= next.part.amount : false;

  return (
    <Section title="Fees">
      <div className="@container px-4 py-4 sm:px-5">
        {next ? (
          <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
            <Figure label="Next fee" value={`${formatAmount(next.part.amount)}`} hint={`${next.part.name}, ${next.days <= 0 ? 'due today' : next.days === 1 ? 'due tomorrow' : `in ${next.days} days`} (${date(next.part.dueAt!)})`} large />
            <Figure
              label="The goal has"
              value={formatAmount(held)}
              hint={enough ? 'Enough for it' : `${formatAmount(next.part.amount - held)} more by ${date(next.part.dueAt!)}`}
              tone={enough ? 'good' : 'warn'}
            />
          </div>
        ) : (
          <p className="text-sm text-[var(--ref-on-surface-variant)]">Add the school’s fees with when they’re due, and this counts down to the next one. You’re reminded a month ahead when the goal can’t cover it yet.</p>
        )}
        {dated.length > 0 && (
          <ol className="mt-4 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
            {dated.map((fee) => (
              <li key={fee.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-[96px] shrink-0 tabular-nums text-[var(--ref-on-surface-variant)]">{date(fee.dueAt!)}</span>
                <span className={cn('min-w-0 flex-1 truncate', fee.paidAt ? 'text-[var(--ref-on-surface-variant)] line-through' : 'text-[var(--ref-on-surface)]')}>{fee.name}</span>
                {fee.paidAt && <Check className="h-3.5 w-3.5 shrink-0 text-[var(--color-success)]" aria-label="Paid" />}
                <span className="shrink-0 font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(fee.amount)}</span>
              </li>
            ))}
          </ol>
        )}
        {onAddFees && <AddFees onAdd={onAddFees} />}
      </div>
    </Section>
  );
}
