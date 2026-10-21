import { useState } from 'react';
import { AlertTriangle, ChevronDown, Plus } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { toast } from '../../../components/ui/useToast';
import { cn } from '../../../lib/utils';
import { Field } from '../../savings/fields';
import { InfoHint } from '../../savings/InfoHint';
import { Dropdown, Toggle } from '../../settings/controls';
import { Section } from '../../subscriptions/PageParts';
import { RemoveButton } from '../dialogs';
import { useAddTravellerMutation, useDeleteTravellerMutation, useUpdateTravellerMutation, type Traveller, type Trip } from './queries';
import { dayKey, daysBetween, fromDayKey, passportState, PASSPORT_MONTHS, shortDate } from './trip-utils';

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

const VISA = {
  'not-needed': { label: 'Not needed', date: null },
  'to-apply': { label: 'To apply for', date: 'Apply by' },
  applied: { label: 'Applied', date: 'Applied on' },
  approved: { label: 'Approved', date: 'Valid until' },
} as const;
type VisaStatus = keyof typeof VISA;

/** Only the end of a passport number shows until you open the person. */
const masked = (value: string) => (value.length > 4 ? `•••${value.slice(-4)}` : value);

/** Someone on the trip: a summary line with any warning, opening to their details. */
function TravellerRow({ traveller, trip, now }: { traveller: Traveller; trip: Trip; now: number }) {
  const { confirm } = useConfirm();
  const update = useUpdateTravellerMutation();
  const remove = useDeleteTravellerMutation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(traveller.name);
  const [passportNumber, setPassportNumber] = useState(traveller.passportNumber ?? '');
  const [passportExpiry, setPassportExpiry] = useState(traveller.passportExpiry ? dayKey(traveller.passportExpiry) : '');
  const [visaStatus, setVisaStatus] = useState<VisaStatus>(traveller.visaStatus);
  const [visaDate, setVisaDate] = useState(traveller.visaDate ? dayKey(traveller.visaDate) : '');
  const [insurance, setInsurance] = useState(traveller.insurance ?? '');
  const back = trip.basics.endDate ?? trip.basics.startDate;
  // Once the trip is over, its passport rule no longer matters.
  const passport = back !== null && daysBetween(back, now) > 0 ? null : passportState(traveller.passportExpiry, trip.basics);
  const leavingIn = trip.basics.startDate !== null ? daysBetween(now, trip.basics.startDate) : null;
  const visaLate = traveller.visaStatus === 'to-apply' && leavingIn !== null && leavingIn >= 0 && leavingIn <= 45;
  const where = trip.basics.places.length ? trip.basics.places.join(', ') : 'where you’re going';

  const save = async () => {
    if (!name.trim()) return;
    try {
      await update.mutateAsync({
        id: traveller.id,
        name: name.trim(),
        passportNumber: passportNumber.trim() || null,
        passportExpiry: passportExpiry ? fromDayKey(passportExpiry) : null,
        visaStatus,
        visaDate: visaDate && VISA[visaStatus].date ? fromDayKey(visaDate) : null,
        insurance: insurance.trim() || null,
      });
      setOpen(false);
    } catch (error) {
      toast.error(errorText(error, 'Could not save'));
    }
  };

  const summary = [
    traveller.passportExpiry ? `Passport to ${shortDate(traveller.passportExpiry)}` : 'No passport date',
    traveller.visaStatus !== 'not-needed' ? `Visa ${VISA[traveller.visaStatus].label.toLowerCase()}${traveller.visaDate ? ` · ${shortDate(traveller.visaDate)}` : ''}` : null,
    traveller.insurance ? `Insured: ${traveller.insurance}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setOpen((shown) => !shown)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-[var(--ref-on-surface-variant)] transition-transform', open && 'rotate-180')} aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-[var(--ref-on-surface)]">{traveller.name}{traveller.passportNumber ? <span className="ml-2 font-mono text-xs font-normal text-[var(--ref-on-surface-variant)]">{masked(traveller.passportNumber)}</span> : null}</span>
            <span className="block truncate text-xs text-[var(--ref-on-surface-variant)]">{summary}</span>
          </span>
        </button>
        <label className="flex shrink-0 items-center gap-2 text-xs text-[var(--ref-on-surface-variant)]">
          Pays a share
          <Toggle label={`${traveller.name} pays a share`} checked={traveller.paying} disabled={update.isPending} onChange={(paying) => update.mutate({ id: traveller.id, paying }, { onError: (error) => toast.error(errorText(error, 'Could not save')) })} />
        </label>
      </div>
      {passport === 'expired' && <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--color-danger)]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />The passport runs out before the trip ends.</p>}
      {passport === 'soon' && <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--color-warning)]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />The passport runs out within {PASSPORT_MONTHS} months of coming home. Some countries won’t let you in with less left; check the rule for {where}.</p>}
      {visaLate && <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--color-warning)]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Leaving in {leavingIn} days and the visa isn’t applied for yet.</p>}
      {open && (
        <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="settings-compact mt-3 grid grid-cols-1 gap-3 rounded-xl bg-[var(--ref-surface-container-low)] p-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Name" htmlFor={`traveller-name-${traveller.id}`}>
              <input id={`traveller-name-${traveller.id}`} className="brutalist-input h-[34px] w-full" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
            </Field>
          </div>
          <Field label="Passport number" htmlFor={`traveller-passport-${traveller.id}`} hint="Optional, for filling in forms.">
            <input id={`traveller-passport-${traveller.id}`} className="brutalist-input h-[34px] w-full font-mono" value={passportNumber} maxLength={30} autoComplete="off" onChange={(event) => setPassportNumber(event.target.value)} />
          </Field>
          <Field label="Passport runs out" htmlFor={`traveller-expiry-${traveller.id}`}>
            <input id={`traveller-expiry-${traveller.id}`} type="date" className="brutalist-input h-[34px] w-full" value={passportExpiry} onChange={(event) => setPassportExpiry(event.target.value)} />
          </Field>
          <Dropdown label="Visa" value={visaStatus} options={(Object.keys(VISA) as VisaStatus[]).map((status) => ({ value: status, label: VISA[status].label }))} onChange={setVisaStatus} />
          {VISA[visaStatus].date && (
            <Field label={VISA[visaStatus].date!} htmlFor={`traveller-visa-${traveller.id}`}>
              <input id={`traveller-visa-${traveller.id}`} type="date" className="brutalist-input h-[34px] w-full" value={visaDate} onChange={(event) => setVisaDate(event.target.value)} />
            </Field>
          )}
          <div className="sm:col-span-2">
            <Field label="Insurance" htmlFor={`traveller-insurance-${traveller.id}`} hint="Who with, and the policy number.">
              <input id={`traveller-insurance-${traveller.id}`} className="brutalist-input h-[34px] w-full" value={insurance} maxLength={200} onChange={(event) => setInsurance(event.target.value)} />
            </Field>
          </div>
          <div className="flex items-center justify-between gap-2 sm:col-span-2">
            <RemoveButton onClick={async () => {
              const ok = await confirm({ title: `Remove ${traveller.name}?`, message: 'Their own packing list goes with them.', confirmLabel: 'Remove', variant: 'danger' });
              if (ok) remove.mutate(traveller.id, { onError: (error) => toast.error(errorText(error, 'Could not remove them')) });
            }} />
            <span className="flex gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" isLoading={update.isPending}>Save</Button>
            </span>
          </div>
        </form>
      )}
    </li>
  );
}

/**
 * Who's going: whether each pays a share (a child might not), their passport (warned when it runs
 * out too soon after the trip), visa and insurance.
 */
export function PeopleSection({ goalId, trip, now }: { goalId: number; trip: Trip; now: number }) {
  const add = useAddTravellerMutation();
  const [name, setName] = useState('');
  const submit = async () => {
    if (!name.trim()) return;
    try {
      await add.mutateAsync({ goalId, name: name.trim() });
      setName('');
    } catch (error) {
      toast.error(errorText(error, 'Could not add them'));
    }
  };
  return (
    <Section
      title="Who’s going"
      aside={<InfoHint label="About who’s going" align="right">Everyone counts for spending money and packing; only those who pay a share split the cost. Passports are checked against six months after you come home, a rule some countries have; check the one for where you’re going.</InfoHint>}
    >
      <div className="px-4 sm:px-5">
        {trip.travellers.length > 0 && <ul className="divide-y divide-[var(--color-border)]">{trip.travellers.map((traveller) => <TravellerRow key={`${traveller.id}:${traveller.passportExpiry}:${traveller.visaStatus}:${traveller.name}`} traveller={traveller} trip={trip} now={now} />)}</ul>}
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className={cn('flex gap-2 py-3', trip.travellers.length > 0 && 'border-t border-[var(--color-border)]')}>
          <input aria-label="Add someone" className="brutalist-input h-[34px] min-w-0 flex-1" placeholder={trip.travellers.length ? 'Someone else' : 'Your name, then anyone going with you'} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
          <Button type="submit" size="sm" variant="secondary" isLoading={add.isPending} disabled={!name.trim()}><Plus className="mr-1 inline h-3.5 w-3.5" aria-hidden />Add</Button>
        </form>
      </div>
    </Section>
  );
}

