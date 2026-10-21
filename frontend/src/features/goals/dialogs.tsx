import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { cn, formatDate } from '../../lib/utils';
import { Toggle } from '../settings/controls';
import { Field, MoneyField, Segmented } from '../savings/fields';
import { monthInputValue, parseMonthInput } from '../savings/input-format';
import { useTransactionList } from '../transactions/queries';
import type { Goal } from './queries';

function Footer({ formId, submitLabel, onClose, busy, extra }: { formId: string; submitLabel: string; onClose: () => void; busy?: boolean; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex gap-2">{extra}</div>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button type="submit" form={formId} size="sm" isLoading={busy}>{submitLabel}</Button>
      </div>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <p role="alert" className="rounded-lg bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{error}</p> : null;
}

export type GoalDraft = {
  name: string;
  targetAmount: number;
  byDate: number | null;
  kind: 'spend' | 'keep';
  monthlyAmount: number;
  setAside: number;
  wishlistId?: number | null;
};

/** Add or edit a goal. A new one can start with money you've already saved for it, from what's free. */
export function GoalDialog({ goal, initial, unassigned, busy, onClose, onSave, onArchive, onDelete }: {
  goal: Goal | null;
  initial?: Partial<GoalDraft>;
  unassigned: number;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: GoalDraft) => void;
  onArchive?: () => void;
  onDelete?: () => void;
}) {
  const { formatAmount } = useBalanceVisibility();
  const start = { ...initial, ...(goal ? { ...goal, setAside: 0 } : {}) };
  const [name, setName] = useState(start.name ?? '');
  const [targetAmount, setTarget] = useState(start.targetAmount ?? 0);
  const [dated, setDated] = useState(start.byDate != null);
  const [month, setMonth] = useState(monthInputValue(start.byDate ? new Date(start.byDate) : new Date(new Date().getFullYear() + 1, new Date().getMonth(), 1)));
  const [kind, setKind] = useState<'spend' | 'keep'>(start.kind ?? 'spend');
  const [monthlyAmount, setMonthly] = useState(start.monthlyAmount ?? 0);
  const [setAside, setSetAside] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const free = Math.max(0, unassigned);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError('Give the goal a name.');
    if (!targetAmount) return setError('Enter what it costs or how much to keep.');
    const date = dated ? parseMonthInput(month) : null;
    if (dated && !date) return setError('Pick a month.');
    if (setAside > free) return setError(`Only ${formatAmount(free)} is free.`);
    // A "by" month means by the end of it.
    const byDate = date ? new Date(date.getFullYear(), date.getMonth() + 1, 0, 12).getTime() : null;
    onSave({ name: name.trim(), targetAmount, byDate, kind, monthlyAmount, setAside, wishlistId: start.wishlistId ?? null });
  };

  return (
    <Modal
      isOpen
      onClose={() => { if (!busy) onClose(); }}
      title={goal ? `Edit ${goal.name}` : 'Add a goal'}
      footer={<Footer formId="goal-form" submitLabel={goal ? 'Save' : 'Add goal'} onClose={onClose} busy={busy} extra={goal && (
        <>
          {onArchive && <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onArchive}>Archive</Button>}
          {onDelete && <Button type="button" size="sm" variant="secondary" className="text-[var(--color-danger)]" disabled={busy} onClick={onDelete}>Delete</Button>}
        </>
      )} />}
    >
      <form id="goal-form" onSubmit={submit} className="settings-compact space-y-4">
        <ErrorLine error={error} />
        <Field label="Name" htmlFor="goal-name">
          <input id="goal-name" className="brutalist-input" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Emergency fund, laptop, trip to Japan…" data-autofocus />
        </Field>
        <Segmented
          ariaLabel="What it’s for"
          value={kind}
          onChange={setKind}
          options={[{ value: 'spend', label: 'Something to buy' }, { value: 'keep', label: 'Money to keep' }]}
        />
        <Field label={kind === 'spend' ? 'It costs' : 'Keep this much'} htmlFor="goal-target">
          <MoneyField id="goal-target" value={targetAmount} onChange={setTarget} />
        </Field>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-[var(--color-text-secondary)]">Needed by a date</span>
          <Toggle label="Needed by a date" checked={dated} onChange={setDated} />
        </div>
        {dated && (
          <Field label="By" htmlFor="goal-month">
            <input id="goal-month" type="month" className="brutalist-input" value={month} min={monthInputValue(new Date())} onChange={(event) => setMonth(event.target.value)} />
          </Field>
        )}
        {!goal && (
          <Field label="Already saved for it" htmlFor="goal-set-aside" hint={`Part of the ${formatAmount(free)} you have free that’s already meant for this. It stays in your accounts.`}>
            <div className="flex gap-2">
              <MoneyField id="goal-set-aside" value={setAside} onChange={setSetAside} />
              {free > 0 && targetAmount > 0 && <Button type="button" size="sm" variant="secondary" className="h-[34px] shrink-0" onClick={() => setSetAside(Math.min(free, targetAmount))}>{targetAmount <= free ? 'All of it' : 'All that’s free'}</Button>}
            </div>
          </Field>
        )}
        <Field label="Put in each month" htmlFor="goal-monthly" info="How much you’ll put into this goal every month. One button, here or in Budget, puts in every goal’s monthly amount at once.">
          <MoneyField id="goal-monthly" value={monthlyAmount} onChange={setMonthly} />
        </Field>
      </form>
    </Modal>
  );
}

/** Put money into a goal from what's free, or take some out again. */
export function MoveMoneyDialog({ goal, unassigned, busy, onClose, onSave }: { goal: Goal; unassigned: number; busy: boolean; onClose: () => void; onSave: (amount: number, note: string | null) => void }) {
  const { formatAmount } = useBalanceVisibility();
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const free = Math.max(0, unassigned);
  const toGo = Math.max(0, goal.targetAmount - goal.setAside);
  const limit = direction === 'in' ? free : goal.setAside;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!amount) return setError('Enter an amount.');
    if (amount > limit) return setError(direction === 'in' ? `Only ${formatAmount(free)} is free.` : `${goal.name} has ${formatAmount(goal.setAside)}.`);
    onSave(direction === 'in' ? amount : -amount, note.trim() || null);
  };

  return (
    <Modal isOpen onClose={() => { if (!busy) onClose(); }} title={goal.name} footer={<Footer formId="goal-move" submitLabel={direction === 'in' ? 'Put in' : 'Take out'} onClose={onClose} busy={busy} />}>
      <form id="goal-move" onSubmit={submit} className="settings-compact space-y-4">
        <ErrorLine error={error} />
        <p className="text-sm text-[var(--ref-on-surface-variant)]">
          Has <span className="font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(goal.setAside)}</span> of {formatAmount(goal.targetAmount)}. You have <span className="font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(free)}</span> free.
        </p>
        <Segmented ariaLabel="Direction" value={direction} onChange={(value) => { setDirection(value); setAmount(0); }} options={[{ value: 'in', label: 'Put money in' }, { value: 'out', label: 'Take out' }]} />
        <Field label="Amount" htmlFor="goal-move-amount" hint={direction === 'out' ? 'It goes back to your free money.' : 'From your free money. Nothing moves between accounts.'}>
          <MoneyField id="goal-move-amount" value={amount} onChange={setAmount} autoFocus />
        </Field>
        <div className="flex flex-wrap gap-2">
          {direction === 'in' && toGo > 0 && free > 0 && <Button type="button" size="sm" variant="secondary" onClick={() => setAmount(Math.min(toGo, free))}>{toGo <= free ? `What it still needs · ${formatAmount(toGo)}` : `All that's free · ${formatAmount(free)}`}</Button>}
          {direction === 'in' && goal.monthlyAmount > 0 && goal.monthlyAmount <= free && <Button type="button" size="sm" variant="secondary" onClick={() => setAmount(Math.min(goal.monthlyAmount, toGo || goal.monthlyAmount))}>This month’s · {formatAmount(goal.monthlyAmount)}</Button>}
          {direction === 'out' && goal.setAside > 0 && <Button type="button" size="sm" variant="secondary" onClick={() => setAmount(goal.setAside)}>All of it · {formatAmount(goal.setAside)}</Button>}
        </div>
        <Field label="Note" htmlFor="goal-move-note">
          <input id="goal-move-note" className="brutalist-input" value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} placeholder={direction === 'in' ? 'THR, bonus, this month…' : 'Needed it for…'} />
        </Field>
      </form>
    </Modal>
  );
}

/** Mark something you saved for as bought, optionally with the expense that paid for it. */
export function CompleteGoalDialog({ goal, busy, onClose, onSave }: { goal: Goal; busy: boolean; onClose: () => void; onSave: (transactionId: number | null) => void }) {
  const { formatAmount } = useBalanceVisibility();
  const [search, setSearch] = useState(goal.name.split(' ')[0] ?? '');
  const [picked, setPicked] = useState<number | null>(null);
  const filters = useMemo(() => ({ kind: 'expense', periodId: 'all', status: 'posted', limit: '25', sort: 'newest', ...(search.trim() ? { search: search.trim() } : {}) }), [search]);
  const transactions = useTransactionList(filters as never);
  const rows = (transactions.data as { data?: Array<{ id: number; date: number | string; description: string; expenseCents?: number }> } | undefined)?.data ?? [];

  return (
    <Modal
      isOpen
      onClose={() => { if (!busy) onClose(); }}
      title={`Bought ${goal.name}?`}
      footer={<Footer formId="goal-complete" submitLabel={picked ? 'Mark bought' : 'Skip and mark bought'} onClose={onClose} busy={busy} />}
    >
      <form id="goal-complete" onSubmit={(event) => { event.preventDefault(); onSave(picked); }} className="settings-compact space-y-3">
        <p className="text-sm text-[var(--ref-on-surface-variant)]">
          Its <span className="font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(goal.setAside)}</span> was spent on it, so the goal is finished and its money leaves it.
        </p>
        <p className="text-sm text-[var(--ref-on-surface-variant)]">
          Optional: pick the expense you recorded for the purchase, so the goal’s history shows what you bought{goal.wishlistId ? ' and its wishlist item is marked bought too' : ''}.
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" aria-hidden />
          <input className="brutalist-input !pl-9" value={search} onChange={(event) => { setSearch(event.target.value); setPicked(null); }} placeholder="Search your expenses" aria-label="Search your expenses" />
        </div>
        <ul className="max-h-64 divide-y divide-[var(--color-border)] overflow-y-auto rounded-xl border border-[var(--color-border)]" role="listbox" aria-label="Expenses">
          {transactions.isPending && !transactions.data ? <li className="px-3 py-3 text-xs text-[var(--ref-on-surface-variant)]">Loading…</li> : rows.length === 0 ? (
            <li className="px-3 py-3 text-xs text-[var(--ref-on-surface-variant)]">No expenses match.</li>
          ) : rows.map((row) => (
            <li key={row.id}>
              <button type="button" role="option" aria-selected={picked === row.id} onClick={() => setPicked(picked === row.id ? null : row.id)} className={cn('flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors', picked === row.id ? 'bg-[var(--color-accent)]/10' : 'hover:bg-[var(--ref-surface-container-low)]')}>
                <span className="min-w-0">
                  <span className="block truncate text-[var(--ref-on-surface)]">{row.description}</span>
                  <span className="block text-xs text-[var(--ref-on-surface-variant)]">{formatDate(Number(row.date))}</span>
                </span>
                <span className="shrink-0 tabular-nums text-[var(--ref-on-surface)]">{formatAmount(row.expenseCents ?? 0)}</span>
              </button>
            </li>
          ))}
        </ul>
      </form>
    </Modal>
  );
}
