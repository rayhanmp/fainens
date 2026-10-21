import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { Modal } from '../../../components/ui/Modal';
import { toast } from '../../../components/ui/useToast';
import { Field, MoneyField, Segmented } from '../../savings/fields';
import { Dropdown } from '../../settings/controls';
import { ErrorLine, Footer } from '../dialogs';
import { useAddPlanMutation, useDeletePlanMutation, useUpdatePlanMutation, type Trip } from './queries';
import { dayLabel, type TripPlan as Plan } from './trip-utils';

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/**
 * Adds a plan or changes one, in a dialog: what, which day and from when until when (or any time),
 * where, and what it should cost, in rupiah or the trip's money.
 */
export function PlanDialog({ goalId, trip, day, days, plan, initialTime, initialEnd, onClose }: { goalId: number; trip: Trip; day: string; days: string[]; plan?: Plan; initialTime?: string | null; initialEnd?: string | null; onClose: () => void }) {
  const { confirm } = useConfirm();
  const add = useAddPlanMutation();
  const update = useUpdatePlanMutation();
  const remove = useDeletePlanMutation();
  const foreign = trip.basics.currency;
  const [title, setTitle] = useState(plan?.title ?? '');
  const [onDay, setOnDay] = useState(plan?.day ?? day);
  const [time, setTime] = useState(plan?.time ?? initialTime ?? '');
  const [endTime, setEndTime] = useState(plan?.endTime ?? initialEnd ?? '');
  const [place, setPlace] = useState(plan?.place ?? '');
  const [cost, setCost] = useState(plan?.cost ?? 0);
  const [currency, setCurrency] = useState(plan?.costCurrency ?? foreign ?? 'IDR');
  const [error, setError] = useState<string | null>(null);
  const busy = add.isPending || update.isPending || remove.isPending;
  const dayOptions = [...new Set([...days, onDay])].map((key) => ({ value: key, label: days.includes(key) ? `Day ${days.indexOf(key) + 1} · ${dayLabel(key)}` : dayLabel(key) }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return setError('Say what the plan is.');
    if (time && endTime && endTime <= time) return setError('It has to end after it starts.');
    const body = { day: onDay, time: time || null, endTime: time && endTime ? endTime : null, title: title.trim(), place: place.trim() || null, cost, costCurrency: currency };
    try {
      if (plan) await update.mutateAsync({ id: plan.id, ...body });
      else await add.mutateAsync({ goalId, ...body });
      onClose();
    } catch (caught) {
      setError(errorText(caught, 'Could not save the plan'));
    }
  };

  return (
    <Modal
      isOpen
      onClose={() => { if (!busy) onClose(); }}
      title={plan ? 'Change the plan' : 'New plan'}
      footer={(
        <Footer
          formId="trip-plan"
          submitLabel={plan ? 'Save' : 'Add plan'}
          onClose={onClose}
          busy={busy}
          extra={plan ? (
            <Button type="button" size="sm" variant="danger" disabled={busy} onClick={async () => {
              if (!(await confirm({ title: `Remove ${plan.title}?`, message: 'It comes off the day and the budget.', confirmLabel: 'Remove', variant: 'danger' }))) return;
              remove.mutate(plan.id, { onSuccess: onClose, onError: (caught) => setError(errorText(caught, 'Could not remove the plan')) });
            }}>Remove</Button>
          ) : undefined}
        />
      )}
    >
      <form id="trip-plan" onSubmit={submit} className="settings-compact space-y-4">
        <ErrorLine error={error} />
        <Field label="What" htmlFor="plan-title">
          <input id="plan-title" autoFocus className="brutalist-input h-[34px] w-full" placeholder="Fushimi Inari at sunrise" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="col-span-2 sm:col-span-1"><Dropdown label="Day" value={onDay} options={dayOptions} onChange={setOnDay} /></div>
          <Field label="From" htmlFor="plan-from">
            <input id="plan-from" type="time" className="brutalist-input h-[34px] w-full" value={time} onChange={(event) => setTime(event.target.value)} />
          </Field>
          <Field label="Until" htmlFor="plan-until">
            <input id="plan-until" type="time" className="brutalist-input h-[34px] w-full" value={endTime} disabled={!time} onChange={(event) => setEndTime(event.target.value)} />
          </Field>
        </div>
        <p className="-mt-2 text-xs text-[var(--ref-on-surface-variant)]">{time ? 'Leave Until empty for about an hour.' : 'Without a time it goes under Any time.'}</p>
        <Field label="Where" htmlFor="plan-where" hint="For the map link.">
          <input id="plan-where" className="brutalist-input h-[34px] w-full" placeholder="Fushimi Inari Taisha, Kyoto" value={place} maxLength={200} onChange={(event) => setPlace(event.target.value)} />
        </Field>
        <Field label="Expected cost" htmlFor="plan-cost">
          <div className="flex gap-2">
            {foreign && <Segmented ariaLabel="Currency" value={currency} options={[{ value: 'IDR', label: 'Rp' }, { value: foreign, label: foreign }]} onChange={setCurrency} />}
            <div className="min-w-0 flex-1">
              {currency === 'IDR'
                ? <MoneyField id="plan-cost" value={cost} onChange={setCost} />
                : <input id="plan-cost" inputMode="decimal" className="brutalist-input h-[34px] w-full text-right tabular-nums" placeholder="0" value={cost ? String(cost) : ''} onChange={(event) => { const value = Number(event.target.value.replace(/[^\d.,]/g, '').replace(',', '.')); setCost(Number.isFinite(value) ? value : 0); }} />}
            </div>
          </div>
        </Field>
      </form>
    </Modal>
  );
}

/** Adds a plan to a day (at a time, when one's given), or edits one and can move it to another day. */
export function PlanForm({ goalId, trip, day, days, plan, initialTime, initialEnd, onDone }: { goalId: number; trip: Trip; day: string; days: string[]; plan?: Plan; initialTime?: string | null; initialEnd?: string | null; onDone: () => void }) {
  const add = useAddPlanMutation();
  const update = useUpdatePlanMutation();
  const remove = useDeletePlanMutation();
  const foreign = trip.basics.currency;
  const [title, setTitle] = useState(plan?.title ?? '');
  const [time, setTime] = useState(plan?.time ?? initialTime ?? '');
  const [endTime, setEndTime] = useState(plan?.endTime ?? initialEnd ?? '');
  const badEnd = Boolean(time && endTime && endTime <= time);
  const [place, setPlace] = useState(plan?.place ?? '');
  const [cost, setCost] = useState(plan?.cost ?? 0);
  const [currency, setCurrency] = useState(plan?.costCurrency ?? foreign ?? 'IDR');
  const [onDay, setOnDay] = useState(plan?.day ?? day);

  const save = async () => {
    if (!title.trim() || badEnd) return;
    const body = { day: onDay, time: time || null, endTime: time && endTime ? endTime : null, title: title.trim(), place: place.trim() || null, cost, costCurrency: currency };
    try {
      if (plan) await update.mutateAsync({ id: plan.id, ...body });
      else await add.mutateAsync({ goalId, ...body });
      onDone();
    } catch (error) {
      toast.error(errorText(error, 'Could not save the plan'));
    }
  };

  return (
    <form onSubmit={(event) => { event.preventDefault(); void save(); }} onKeyDown={(event) => { if (event.key === 'Escape') onDone(); }} className="my-2 space-y-2 rounded-xl bg-[var(--ref-surface-container-low)] p-3">
      <input aria-label="Plan" autoFocus className="brutalist-input h-[34px] w-full" placeholder="Fushimi Inari at sunrise" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ref-on-surface-variant)]">
        <input aria-label="From" type="time" className="brutalist-input h-[34px] w-[110px]" value={time} onChange={(event) => setTime(event.target.value)} />
        <span>until</span>
        <input aria-label="Until" type="time" className="brutalist-input h-[34px] w-[110px]" value={endTime} disabled={!time} onChange={(event) => setEndTime(event.target.value)} />
        {!time && <span>No time: it goes under Any time</span>}
        {badEnd && <span className="text-[var(--color-danger)]">It has to end after it starts</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <input aria-label="Where" className="brutalist-input h-[34px] min-w-0 flex-1" placeholder="Where (for the map)" value={place} maxLength={200} onChange={(event) => setPlace(event.target.value)} />
        {foreign && <Segmented ariaLabel="Currency" value={currency} options={[{ value: 'IDR', label: 'Rp' }, { value: foreign, label: foreign }]} onChange={setCurrency} />}
        <div className="w-[150px]">
          {currency === 'IDR'
            ? <MoneyField ariaLabel="Expected cost" value={cost} onChange={setCost} />
            : <input aria-label="Expected cost" inputMode="decimal" className="brutalist-input h-[34px] w-full text-right tabular-nums" placeholder="0" value={cost ? String(cost) : ''} onChange={(event) => { const value = Number(event.target.value.replace(/[^\d.,]/g, '').replace(',', '.')); setCost(Number.isFinite(value) ? value : 0); }} />}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {plan ? (
          <div className="flex items-center gap-2">
            <div className="w-[170px]"><Dropdown ariaLabel="Day" value={onDay} options={[...new Set([...days, plan.day])].map((key) => ({ value: key, label: days.includes(key) ? `Day ${days.indexOf(key) + 1} · ${dayLabel(key)}` : dayLabel(key) }))} onChange={setOnDay} /></div>
            <button type="button" aria-label="Remove plan" onClick={() => remove.mutate(plan.id, { onSuccess: onDone, onError: (error) => toast.error(errorText(error, 'Could not remove the plan')) })} className="grid h-[34px] w-[34px] place-items-center rounded-lg text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-high)]"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
          </div>
        ) : <span />}
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={onDone}>Cancel</Button>
          <Button type="submit" size="sm" isLoading={add.isPending || update.isPending} disabled={!title.trim() || badEnd}>{plan ? 'Save' : 'Add'}</Button>
        </div>
      </div>
    </form>
  );
}
