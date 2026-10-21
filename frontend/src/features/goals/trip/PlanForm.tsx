import { useState } from 'react';
import { Check, Clock, ExternalLink, MapPin, Wallet } from 'lucide-react';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { Modal } from '../../../components/ui/Modal';
import { MoneyField, Segmented } from '../../savings/fields';
import { Dropdown } from '../../settings/controls';
import { ErrorLine, Footer, IconRow as Row, RemoveButton, TitleInput } from '../dialogs';
import { useAddPlanMutation, useDeletePlanMutation, useUpdatePlanMutation, type Trip } from './queries';
import { clockOf, costText, dayLabel, mapsUrl, minutesOf, PLAN_COLOR_INFO, PLAN_COLORS, planFill, type PlanColor, type TripPlan as Plan } from './trip-utils';

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const LAST = 24 * 60 - 1;
const later = (clock: string, by: number) => clockOf(Math.min(LAST, minutesOf(clock) + by));

/** "1 h 30 min" between two clock times, or null when the end isn't after the start. */
function lengthText(from: string, until: string) {
  const minutes = minutesOf(until) - minutesOf(from);
  if (!from || !until || minutes <= 0) return null;
  return [Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} h` : '', minutes % 60 ? `${minutes % 60} min` : ''].filter(Boolean).join(' ');
}

/**
 * Adds a plan or changes one, like an event in a calendar app: what it is and its colour, the day
 * and (or not) a time with its end, where, and what it should cost in rupiah or the trip's money.
 * Moving the start keeps how long it takes.
 */
export function PlanDialog({ goalId, trip, day, days, plan, initialTime, initialEnd, onClose }: { goalId: number; trip: Trip; day: string; days: string[]; plan?: Plan; initialTime?: string | null; initialEnd?: string | null; onClose: () => void }) {
  const { confirm } = useConfirm();
  const add = useAddPlanMutation();
  const update = useUpdatePlanMutation();
  const remove = useDeletePlanMutation();
  const foreign = trip.basics.currency;
  const startAt = plan ? plan.time : initialTime ?? null;
  const [title, setTitle] = useState(plan?.title ?? '');
  const [color, setColor] = useState<PlanColor | null>(plan?.color ?? null);
  const [onDay, setOnDay] = useState(plan?.day ?? day);
  const [timed, setTimed] = useState(Boolean(startAt));
  const [time, setTime] = useState(startAt ?? '09:00');
  const [endTime, setEndTime] = useState((plan ? plan.endTime : initialEnd) ?? later(startAt ?? '09:00', 60));
  const [place, setPlace] = useState(plan?.place ?? '');
  const [cost, setCost] = useState(plan?.cost ?? 0);
  const [currency, setCurrency] = useState(plan?.costCurrency ?? foreign ?? 'IDR');
  const [error, setError] = useState<string | null>(null);
  const busy = add.isPending || update.isPending || remove.isPending;
  const dayOptions = [...new Set([...days, onDay])].map((key) => ({ value: key, label: days.includes(key) ? `Day ${days.indexOf(key) + 1} · ${dayLabel(key)}` : dayLabel(key) }));
  const length = lengthText(time, endTime);
  const rate = trip.basics.rate;

  // A new start keeps the plan as long as it was, like moving an event in a calendar.
  const changeStart = (next: string) => {
    if (!next) return setTime(next);
    const kept = time && endTime && minutesOf(endTime) > minutesOf(time) ? minutesOf(endTime) - minutesOf(time) : 60;
    setTime(next);
    setEndTime(later(next, kept));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return setError('Say what the plan is.');
    if (timed && !time) return setError('Pick when it starts, or make it Any time.');
    if (timed && endTime && endTime <= time) return setError('It has to end after it starts.');
    const body = { day: onDay, time: timed ? time : null, endTime: timed ? endTime || null : null, title: title.trim(), place: place.trim() || null, cost, costCurrency: currency, color };
    try {
      if (plan) await update.mutateAsync({ id: plan.id, ...body });
      else await add.mutateAsync({ goalId, ...body });
      onClose();
    } catch (caught) {
      setError(errorText(caught, 'Could not save the plan'));
    }
  };

  const removePlan = async () => {
    if (!plan || !(await confirm({ title: `Remove ${plan.title}?`, message: 'It comes off the day and the budget.', confirmLabel: 'Remove', variant: 'danger' }))) return;
    remove.mutate(plan.id, { onSuccess: onClose, onError: (caught) => setError(errorText(caught, 'Could not remove the plan')) });
  };

  return (
    <Modal
      isOpen
      onClose={() => { if (!busy) onClose(); }}
      title={plan ? 'Edit plan' : 'New plan'}
      footer={(
        <Footer
          formId="trip-plan"
          submitLabel={plan ? 'Save' : 'Add plan'}
          onClose={onClose}
          busy={busy}
          extra={plan ? <RemoveButton disabled={busy} onClick={() => void removePlan()} /> : undefined}
        />
      )}
    >
      <form id="trip-plan" onSubmit={submit} className="settings-compact space-y-5">
        <ErrorLine error={error} />

        {/* What it is, in its colour. */}
        <div className="space-y-3">
          <TitleInput ariaLabel="What" autoFocus placeholder="What’s the plan?" value={title} onChange={setTitle} mark={<span className="h-4 w-4 rounded-[5px]" style={{ background: planFill(color).background }} aria-hidden />} />
          <div role="radiogroup" aria-label="Colour" className="ml-8 flex flex-wrap gap-2">
            {([null, ...PLAN_COLORS] as Array<PlanColor | null>).map((value) => {
              const fill = planFill(value);
              const label = value ? PLAN_COLOR_INFO[value].label : 'Accent';
              return (
                <button
                  key={value ?? 'accent'}
                  type="button"
                  role="radio"
                  aria-checked={color === value}
                  aria-label={label}
                  title={label}
                  onClick={() => setColor(value)}
                  className="grid h-6 w-6 place-items-center rounded-full ring-offset-2 ring-offset-[var(--color-surface)] transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ref-primary)] aria-checked:ring-2 aria-checked:ring-[var(--ref-outline)]"
                  style={{ background: fill.background }}
                >
                  {color === value && <Check className="h-3.5 w-3.5" style={{ color: fill.color }} strokeWidth={3} aria-hidden />}
                </button>
              );
            })}
          </div>
        </div>

        <Row icon={Clock} label="When">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Dropdown ariaLabel="Day" value={onDay} options={dayOptions} onChange={setOnDay} />
            <Segmented ariaLabel="Time" value={timed ? 'at' : 'any'} options={[{ value: 'any', label: 'Any time' }, { value: 'at', label: 'At a time' }]} onChange={(value) => setTimed(value === 'at')} />
          </div>
          {timed && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-[120px]"><input aria-label="From" type="time" className="brutalist-input tabular-nums" value={time} onChange={(event) => changeStart(event.target.value)} /></div>
              <span className="text-sm text-[var(--ref-on-surface-variant)]">to</span>
              <div className="w-[120px]"><input aria-label="Until" type="time" className="brutalist-input tabular-nums" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></div>
              {length && <span className="rounded-full bg-[var(--ref-surface-container-high)] px-2 py-0.5 text-xs font-medium tabular-nums text-[var(--ref-on-surface-variant)]">{length}</span>}
            </div>
          )}
        </Row>

        <Row icon={MapPin} label="Where">
          <input aria-label="Where" className="brutalist-input" placeholder="Add a place, like Fushimi Inari Taisha" value={place} maxLength={200} onChange={(event) => setPlace(event.target.value)} />
          {place.trim() && (
            <a href={mapsUrl(place.trim())} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--ref-primary)] hover:underline">
              See it on the map<ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          )}
        </Row>

        <Row icon={Wallet} label="Expected cost">
          <div className="flex gap-2">
            {foreign && <Segmented ariaLabel="Currency" value={currency} options={[{ value: 'IDR', label: 'Rp' }, { value: foreign, label: foreign }]} onChange={setCurrency} />}
            <div className="min-w-0 flex-1">
              {currency === 'IDR'
                ? <MoneyField ariaLabel="Expected cost" value={cost} onChange={setCost} />
                : <input aria-label="Expected cost" inputMode="decimal" className="brutalist-input text-right tabular-nums" placeholder="0" value={cost ? String(cost) : ''} onChange={(event) => { const value = Number(event.target.value.replace(/[^\d.,]/g, '').replace(',', '.')); setCost(Number.isFinite(value) ? value : 0); }} />}
            </div>
          </div>
          {currency !== 'IDR' && cost > 0 && rate ? <p className="text-xs tabular-nums text-[var(--ref-on-surface-variant)]">About {costText(cost * rate, 'IDR')} at Rp{rate.toLocaleString('id-ID')} for {costText(1, currency)}</p> : null}
        </Row>
      </form>
    </Modal>
  );
}
