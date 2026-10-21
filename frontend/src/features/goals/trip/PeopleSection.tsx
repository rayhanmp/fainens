import { useState } from 'react';
import { AlertTriangle, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { toast } from '../../../components/ui/useToast';
import { cn } from '../../../lib/utils';
import { Field } from '../../savings/fields';
import { InfoHint } from '../../savings/InfoHint';
import { Dropdown, Toggle } from '../../settings/controls';
import { Section } from '../../subscriptions/PageParts';
import {
  useAddPackingMutation,
  useAddTravellerMutation,
  useDeletePackingMutation,
  useDeleteTravellerMutation,
  useUpdatePackingMutation,
  useUpdateTravellerMutation,
  type PackingItem,
  type Traveller,
  type Trip,
} from './queries';
import { dayKey, daysBetween, fromDayKey, packingStarter, passportState, PASSPORT_MONTHS, shortDate } from './trip-utils';

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
          <Field label="Name" htmlFor={`traveller-name-${traveller.id}`}>
            <input id={`traveller-name-${traveller.id}`} className="brutalist-input h-[34px] w-full" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Insurance" htmlFor={`traveller-insurance-${traveller.id}`} hint="Who with, and the policy number.">
            <input id={`traveller-insurance-${traveller.id}`} className="brutalist-input h-[34px] w-full" value={insurance} maxLength={200} onChange={(event) => setInsurance(event.target.value)} />
          </Field>
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
          <div className="flex items-center justify-between gap-2 sm:col-span-2">
            <Button type="button" size="sm" variant="danger" onClick={async () => {
              const ok = await confirm({ title: `Remove ${traveller.name}?`, message: 'Their own packing list goes with them.', confirmLabel: 'Remove', variant: 'danger' });
              if (ok) remove.mutate(traveller.id, { onError: (error) => toast.error(errorText(error, 'Could not remove them')) });
            }}>Remove</Button>
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

function PackingGroup({ goalId, title, travellerId, items }: { goalId: number; title: string; travellerId: number | null; items: PackingItem[] }) {
  const add = useAddPackingMutation();
  const update = useUpdatePackingMutation();
  const remove = useDeletePackingMutation();
  const [text, setText] = useState('');
  const packed = items.filter((item) => item.done).length;
  const submit = () => {
    if (!text.trim()) return;
    add.mutate({ goalId, items: [{ text: text.trim(), travellerId }] }, { onSuccess: () => setText(''), onError: (error) => toast.error(errorText(error, 'Could not add it')) });
  };
  return (
    <div className="py-3">
      <p className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--ref-on-surface-variant)]">
        <span>{title}</span>
        {items.length > 0 && <span className="tabular-nums tracking-normal">{packed} of {items.length}</span>}
      </p>
      <ul className="mt-1">
        {items.map((item) => (
          <li key={item.id} className="group flex items-center gap-3 py-1">
            <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--ref-primary)]" checked={item.done} aria-label={item.text} onChange={(event) => update.mutate({ id: item.id, done: event.target.checked }, { onError: (error) => toast.error(errorText(error, 'Could not save')) })} />
            <span className={cn('min-w-0 flex-1 truncate text-sm', item.done ? 'text-[var(--ref-on-surface-variant)] line-through' : 'text-[var(--ref-on-surface)]')}>{item.text}</span>
            <button type="button" aria-label={`Remove ${item.text}`} onClick={() => remove.mutate(item.id)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--ref-on-surface-variant)] opacity-60 hover:bg-[var(--ref-surface-container-low)] hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
          </li>
        ))}
      </ul>
      <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="mt-1">
        <input aria-label={`Add to ${title}`} className="brutalist-input h-[34px] w-full" placeholder="Add something" value={text} maxLength={120} onChange={(event) => setText(event.target.value)} />
      </form>
    </div>
  );
}

/**
 * What to pack, for each person and for the group, with how much is packed. An empty list can
 * start from one for the weather there.
 */
export function PackingSection({ goalId, trip }: { goalId: number; trip: Trip }) {
  const add = useAddPackingMutation();
  const total = trip.packing.length;
  const packed = trip.packing.filter((item) => item.done).length;
  const climates = [trip.basics.climate ?? 'cold', ...(['cold', 'warm', 'mixed'] as const).filter((climate) => climate !== (trip.basics.climate ?? 'cold'))];
  const label = { cold: 'Cold', warm: 'Warm', mixed: 'Some of each' } as const;
  const start = (climate: 'cold' | 'warm' | 'mixed') => {
    const items = packingStarter(climate, trip.travellers, trip.packing);
    if (items.length) add.mutate({ goalId, items }, { onError: (error) => toast.error(errorText(error, 'Could not add the list')) });
  };
  const groups = [
    ...trip.travellers.map((traveller) => ({ key: `t${traveller.id}`, title: traveller.name, travellerId: traveller.id as number | null })),
    { key: 'all', title: trip.travellers.length ? 'For everyone' : 'To pack', travellerId: null },
  ];
  return (
    <Section title="Packing" aside={total > 0 ? <span className="text-xs font-semibold tabular-nums text-[var(--ref-on-surface-variant)]">{packed} of {total} packed</span> : undefined}>
      <div className="px-4 sm:px-5">
        {total > 0 && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--ref-surface-container-high)]" aria-hidden>
            <div className="h-full rounded-full bg-[var(--ref-primary)] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${(packed / total) * 100}%` }} />
          </div>
        )}
        {total === 0 && (
          <div className="pt-4">
            <p className="text-sm text-[var(--ref-on-surface-variant)]">Start from a list for the weather there{trip.travellers.length ? ', one for each person and one for everyone' : ''}, then add your own.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {climates.map((climate, index) => <Button key={climate} type="button" size="sm" variant={index === 0 ? 'primary' : 'secondary'} isLoading={add.isPending && index === 0} onClick={() => start(climate)}>{label[climate]}</Button>)}
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {groups.map((group) => <PackingGroup key={group.key} goalId={goalId} title={group.title} travellerId={group.travellerId} items={trip.packing.filter((item) => item.travellerId === group.travellerId)} />)}
        </div>
      </div>
    </Section>
  );
}
