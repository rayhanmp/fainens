import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Dropdown, Toggle } from '../settings/controls';
import { Field, MoneyField, Segmented } from './fields';
import { monthInputValue, parseMonthInput } from './input-format';
import { MAX_MONTHS, MAX_POTS, monthDate, newId, planMonthOf, type PlanEvent, type PlanGoal, type PlanPot } from './plan';
import { OWN_POT } from './pots';

/** Which pot something belongs to; hidden while the plan has a single pot. */
function PotField({ pots, value, onChange, label }: { pots: PlanPot[]; value: string; onChange: (id: string) => void; label: string }) {
  if (pots.length < 2) return null;
  return <Dropdown label={label} value={value} options={pots.map((pot) => ({ value: pot.id, label: pot.name }))} onChange={onChange} />;
}

function Footer({ formId, submitLabel, onClose, busy }: { formId: string; submitLabel: string; onClose: () => void; busy?: boolean }) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
      <Button type="submit" form={formId} size="sm" isLoading={busy}>{submitLabel}</Button>
    </div>
  );
}

/** A month a plan can reach, from next month to 50 years out. */
function MonthField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return <input id={id} type="month" className="brutalist-input" value={value} min={monthInputValue(monthDate(1))} max={monthInputValue(monthDate(MAX_MONTHS))} onChange={(event) => onChange(event.target.value)} />;
}

export function EventDialog({ event, pots, defaultPotId, onClose, onSave }: { event: PlanEvent | null; pots: PlanPot[]; defaultPotId: string; onClose: () => void; onSave: (event: PlanEvent) => void }) {
  const [potId, setPotId] = useState(event?.potId ?? defaultPotId);
  const [direction, setDirection] = useState<'in' | 'out'>(event && event.amount < 0 ? 'out' : 'in');
  const [label, setLabel] = useState(event?.label ?? '');
  const [amount, setAmount] = useState(Math.abs(event?.amount ?? 0));
  const [month, setMonth] = useState(monthInputValue(monthDate(event?.month ?? 12)));
  const [yearly, setYearly] = useState(event?.yearly ?? false);
  const [error, setError] = useState<string | null>(null);

  const submit = (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    const date = parseMonthInput(month);
    if (!amount) return setError('Enter an amount.');
    if (!date) return setError('Pick a month.');
    const planMonth = planMonthOf(date);
    if (planMonth > MAX_MONTHS) return setError('Pick a month within 50 years.');
    onSave({ id: event?.id ?? newId(), label: label.trim(), amount: direction === 'in' ? amount : -amount, month: planMonth, yearly, potId });
  };

  return (
    <Modal isOpen onClose={onClose} title={event ? 'Edit money in or out' : 'Add money in or out'} footer={<Footer formId="plan-event" submitLabel={event ? 'Save' : 'Add'} onClose={onClose} />}>
      <form id="plan-event" onSubmit={submit} className="settings-compact space-y-4">
        {error && <p role="alert" className="rounded-lg bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{error}</p>}
        <Segmented ariaLabel="Direction" value={direction} onChange={setDirection} options={[{ value: 'in', label: 'Money in' }, { value: 'out', label: 'Money out' }]} />
        <Field label="What is it" htmlFor="event-label">
          <input id="event-label" className="brutalist-input" value={label} maxLength={80} onChange={(change) => setLabel(change.target.value)} placeholder={direction === 'in' ? 'THR, bonus, inheritance…' : 'Wedding, car, renovation…'} data-autofocus />
        </Field>
        <Field label="Amount" htmlFor="event-amount" hint="In the rupiah of that month.">
          <MoneyField id="event-amount" value={amount} onChange={setAmount} />
        </Field>
        <Field label={yearly ? 'First time' : 'When'} htmlFor="event-month">
          <MonthField id="event-month" value={month} onChange={setMonth} />
        </Field>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-[var(--color-text-secondary)]">Every year</span>
          <Toggle label="Every year" checked={yearly} onChange={setYearly} />
        </div>
        <PotField pots={pots} value={potId} onChange={setPotId} label={direction === 'in' ? 'Into' : 'Out of'} />
      </form>
    </Modal>
  );
}

export function GoalDialog({ goal, pots, defaultPotId, onClose, onSave }: { goal: PlanGoal | null; pots: PlanPot[]; defaultPotId: string; onClose: () => void; onSave: (goal: PlanGoal) => void }) {
  const [potId, setPotId] = useState(goal?.potId ?? defaultPotId);
  const [spend, setSpend] = useState(goal?.spend ?? true);
  const [name, setName] = useState(goal?.name ?? '');
  const [amount, setAmount] = useState(goal?.amount ?? 0);
  const [dated, setDated] = useState(goal ? goal.byMonth !== null : true);
  const [month, setMonth] = useState(monthInputValue(monthDate(goal?.byMonth ?? 36)));
  const [error, setError] = useState<string | null>(null);

  const submit = (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    if (!name.trim()) return setError('Give the goal a name.');
    if (!amount) return setError('Enter what it costs.');
    const date = dated ? parseMonthInput(month) : null;
    if (dated && !date) return setError('Pick a month.');
    const byMonth = date ? planMonthOf(date) : null;
    if (byMonth !== null && byMonth > MAX_MONTHS) return setError('Pick a month within 50 years.');
    onSave({ id: goal?.id ?? newId(), name: name.trim(), amount, byMonth, potId, spend });
  };

  return (
    <Modal isOpen onClose={onClose} title={goal ? `Edit ${goal.name}` : 'Add a goal'} footer={<Footer formId="plan-goal" submitLabel={goal ? 'Save' : 'Add goal'} onClose={onClose} />}>
      <form id="plan-goal" onSubmit={submit} className="settings-compact space-y-4">
        {error && <p role="alert" className="rounded-lg bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">{error}</p>}
        <Field label="Name" htmlFor="goal-name">
          <input id="goal-name" className="brutalist-input" value={name} maxLength={80} onChange={(change) => setName(change.target.value)} placeholder="House down payment, wedding, laptop…" data-autofocus />
        </Field>
        <Field label="Costs" htmlFor="goal-amount" hint="In today’s prices; the plan adds inflation.">
          <MoneyField id="goal-amount" value={amount} onChange={setAmount} />
        </Field>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-[var(--color-text-secondary)]">Needed by a date</span>
          <Toggle label="Needed by a date" checked={dated} onChange={setDated} />
        </div>
        {dated && (
          <Field label="By" htmlFor="goal-month">
            <MonthField id="goal-month" value={month} onChange={setMonth} />
          </Field>
        )}
        <Field
          label="Paid from"
          hint={potId === OWN_POT
            ? `A new pot called “${name.trim() || 'this goal'}”${dated ? ', saving each month what it needs to get there on time.' : '. Set how much goes into it under Your plan.'}`
            : undefined}
        >
          <Dropdown
            ariaLabel="Paid from"
            value={potId}
            options={[
              ...pots.map((pot) => ({ value: pot.id, label: pot.name })),
              ...(pots.length < MAX_POTS ? [{ value: OWN_POT, label: 'Its own pot' }] : []),
            ]}
            onChange={setPotId}
          />
        </Field>
        <div className="space-y-1">
          <Segmented
            ariaLabel="What happens when it’s reached"
            value={spend ? 'spend' : 'keep'}
            onChange={(value) => setSpend(value === 'spend')}
            options={[{ value: 'spend', label: 'Spend it when reached' }, { value: 'keep', label: 'Keep it saved' }]}
          />
          <p className="text-xs text-[var(--ref-on-surface-variant)]">
            {spend
              ? 'Like a laptop or a house down payment: the money leaves the pot when it’s bought, so the pot’s next goal saves from what’s left.'
              : 'Like an emergency fund: the pot just has to hold this much. Later goals in the pot can’t use it.'}
          </p>
        </div>
      </form>
    </Modal>
  );
}

export function NameDialog({ title, initial, submitLabel, busy, onClose, onSave }: { title: string; initial: string; submitLabel: string; busy: boolean; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(initial);
  return (
    <Modal isOpen onClose={() => { if (!busy) onClose(); }} title={title} footer={<Footer formId="plan-name" submitLabel={submitLabel} onClose={onClose} busy={busy} />}>
      <form id="plan-name" className="settings-compact" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSave(name.trim()); }}>
        <Field label="Name" htmlFor="plan-name-input">
          <input id="plan-name-input" className="brutalist-input" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Steady, Aggressive, After the wedding…" data-autofocus required />
        </Field>
      </form>
    </Modal>
  );
}
