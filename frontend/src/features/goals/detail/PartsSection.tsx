import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { toast } from '../../../components/ui/useToast';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { cn } from '../../../lib/utils';
import { MoneyField } from '../../savings/fields';
import { InfoHint } from '../../savings/InfoHint';
import { Section } from '../../subscriptions/PageParts';
import { useAddPartMutation, useDeletePartMutation, useUpdateGoalMutation, useUpdatePartMutation, type GoalDetail, type GoalPart } from '../queries';

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/** One part of the cost: tick it when paid, rename or re-price it in place, pay it from the goal. */
function PartRow({ part, canPay, onPay }: { part: GoalPart; canPay: boolean; onPay: (part: GoalPart) => void }) {
  const { formatAmount } = useBalanceVisibility();
  const update = useUpdatePartMutation();
  const remove = useDeletePartMutation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(part.name);
  const [amount, setAmount] = useState(part.amount);
  const paid = part.paidAt !== null;

  const save = async () => {
    if (!name.trim()) return;
    try {
      await update.mutateAsync({ id: part.id, name: name.trim(), amount });
      setEditing(false);
    } catch (error) {
      toast.error(errorText(error, 'Could not save the part'));
    }
  };

  if (editing) {
    return (
      <li className="flex flex-wrap items-center gap-2 py-2">
        <input aria-label="Part name" className="brutalist-input h-[34px] min-w-0 flex-1" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void save(); if (event.key === 'Escape') setEditing(false); }} autoFocus />
        <div className="w-[150px]"><MoneyField ariaLabel="Part amount" value={amount} onChange={setAmount} /></div>
        <Button type="button" size="sm" isLoading={update.isPending} onClick={() => void save()}>Save</Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
      </li>
    );
  }

  return (
    <li className="group flex items-center gap-3 py-2">
      <input
        type="checkbox"
        checked={paid}
        disabled={update.isPending}
        onChange={(event) => update.mutate({ id: part.id, paid: event.target.checked }, { onError: (error) => toast.error(errorText(error, 'Could not save')) })}
        aria-label={`${part.name} paid`}
        className="h-4 w-4 shrink-0 accent-[var(--ref-primary)]"
      />
      <button type="button" onClick={() => setEditing(true)} className="min-w-0 flex-1 text-left">
        <span className={cn('block truncate text-sm text-[var(--ref-on-surface)]', paid && 'text-[var(--ref-on-surface-variant)] line-through')}>{part.name}</span>
        {paid && part.paidAt && <span className="block text-[11px] text-[var(--ref-on-surface-variant)]">Paid {new Date(part.paidAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
      </button>
      <span className={cn('shrink-0 text-sm tabular-nums', paid ? 'text-[var(--ref-on-surface-variant)]' : 'font-semibold text-[var(--ref-on-surface)]')}>{formatAmount(part.amount)}</span>
      {!paid && canPay && <Button type="button" size="sm" variant="secondary" className="h-[30px] shrink-0 px-2 text-xs" onClick={() => onPay(part)}>Pay</Button>}
      <button type="button" aria-label={`Remove ${part.name}`} onClick={() => remove.mutate(part.id, { onError: (error) => toast.error(errorText(error, 'Could not remove')) })} className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg text-[var(--ref-on-surface-variant)] opacity-60 hover:bg-[var(--ref-surface-container-low)] hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100">
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </button>
    </li>
  );
}

/**
 * What the goal's cost is made of, like a trip's flights, stay and JR Pass. Parts are ticked off
 * as they're paid; one can be paid straight from the goal's money. Their total can become the target.
 */
export function PartsSection({ detail, onPay }: { detail: GoalDetail; onPay: (part: GoalPart) => void }) {
  const { formatAmount } = useBalanceVisibility();
  const add = useAddPartMutation();
  const updateGoal = useUpdateGoalMutation();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState(0);
  const { goal, parts } = detail;
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  const paid = parts.filter((part) => part.paidAt !== null).reduce((sum, part) => sum + part.amount, 0);
  const active = goal.status === 'active';

  const submit = async () => {
    if (!name.trim() || !amount) return;
    try {
      await add.mutateAsync({ id: goal.id, name: name.trim(), amount });
      setName('');
      setAmount(0);
    } catch (error) {
      toast.error(errorText(error, 'Could not add the part'));
    }
  };

  return (
    <Section
      title="Breakdown"
      aside={<InfoHint label="About the breakdown" align="right">Split the cost into parts, like flights, stay and spending money. Tick a part when it’s paid; Pay takes its cost out of the goal’s money and can link the expense you recorded.</InfoHint>}
    >
      <div className="px-4 py-3 sm:px-5">
        {parts.length > 0 && (
          <>
            <ul className="divide-y divide-[var(--color-border)]">
              {parts.map((part) => <PartRow key={part.id} part={part} canPay={active && goal.setAside > 0} onPay={onPay} />)}
            </ul>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3 text-sm">
              <span className="text-[var(--ref-on-surface-variant)]">
                <span className="font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(total)}</span> in parts{paid > 0 ? <>, <span className="tabular-nums">{formatAmount(paid)}</span> paid</> : null}
                {total !== goal.targetAmount && <> · {total > goal.targetAmount ? `${formatAmount(total - goal.targetAmount)} more than` : `${formatAmount(goal.targetAmount - total)} less than`} the target</>}
              </span>
              {total > 0 && total !== goal.targetAmount && active && (
                <Button type="button" size="sm" variant="secondary" isLoading={updateGoal.isPending} onClick={() => updateGoal.mutate({ id: goal.id, targetAmount: total }, { onError: (error) => toast.error(errorText(error, 'Could not save')) })}>Make it the target</Button>
              )}
            </div>
          </>
        )}
        {active && (
          <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className={cn('flex flex-wrap items-center gap-2', parts.length > 0 && 'mt-3')}>
            <input aria-label="New part" className="brutalist-input h-[34px] w-full min-w-0 sm:w-auto sm:flex-1" placeholder={parts.length ? 'Another part' : 'A part of the cost, like flights'} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
            <div className="min-w-0 flex-1 sm:w-[150px] sm:flex-none"><MoneyField ariaLabel="Part amount" value={amount} onChange={setAmount} /></div>
            <Button type="submit" size="sm" variant="secondary" isLoading={add.isPending} disabled={!name.trim() || !amount}><Plus className="mr-1 inline h-3.5 w-3.5" aria-hidden />Add</Button>
          </form>
        )}
        {!active && parts.length === 0 && <p className="text-sm text-[var(--ref-on-surface-variant)]">No breakdown.</p>}
      </div>
    </Section>
  );
}
