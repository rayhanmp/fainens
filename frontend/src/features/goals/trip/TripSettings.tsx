import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import type { UpdateGoalTripBody } from '../../../generated/client';
import { toast } from '../../../components/ui/useToast';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { MoneyField } from '../../savings/fields';
import { Dropdown } from '../../settings/controls';
import { DetailRow } from '../detail/DetailRow';
import { useUpdateTripMutation, type Trip } from './queries';
import { CURRENCIES, dayKey, fromDayKey, tripLength } from './trip-utils';

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
/** Bank Indonesia's daily exchange rates. */
const BI_RATES = 'https://www.bi.go.id/id/statistik/informasi-kurs/transaksi-bi/default.aspx';

type Save = (body: UpdateGoalTripBody) => void;

/** The places, in order: chips, and a field that adds one on Enter. */
function PlacesRow({ places, save }: { places: string[]; save: (places: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const place = draft.trim();
    if (!place || places.some((item) => item.toLowerCase() === place.toLowerCase())) return setDraft('');
    save([...places, place]);
    setDraft('');
  };
  return (
    <DetailRow label="Where" info="The cities or places you’re going, in order. They name the trip’s days and the packing list.">
      {places.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {places.map((place) => (
            <span key={place} className="inline-flex items-center gap-1 rounded-full bg-[var(--ref-surface-container-low)] py-0.5 pl-2.5 pr-1 text-xs font-medium text-[var(--ref-on-surface)]">
              {place}
              <button type="button" aria-label={`Remove ${place}`} onClick={() => save(places.filter((item) => item !== place))} className="grid h-5 w-5 place-items-center rounded-full text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-high)]"><X className="h-3 w-3" aria-hidden /></button>
            </span>
          ))}
        </div>
      )}
      <div className="mt-2">
        <input
          aria-label="Add a place"
          className="brutalist-input h-[34px] w-full"
          placeholder={places.length ? 'Another place' : 'Tokyo, Kyoto…'}
          value={draft}
          maxLength={80}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}
          onBlur={add}
        />
      </div>
    </DetailRow>
  );
}

/** When you leave and come back; moving the day you leave keeps the trip as long as it was. */
function DatesRow({ trip, save }: { trip: Trip; save: Save }) {
  const { startDate, endDate } = trip.basics;
  const days = tripLength(trip.basics);
  const setStart = (value: string) => {
    if (!value) return save({ startDate: null });
    const start = fromDayKey(value);
    const end = endDate !== null && startDate !== null ? fromDayKey(dayKey(start + (endDate - startDate))) : endDate;
    save({ startDate: start, endDate: end !== null && end < start ? start : end });
  };
  const setEnd = (value: string) => {
    if (!value) return save({ endDate: null });
    const end = fromDayKey(value);
    if (startDate !== null && end < startDate) return toast.error('Coming back can’t be before you leave.');
    save({ endDate: end });
  };
  return (
    <DetailRow label="When" info="The day you leave and the day you come back. The trip’s days, its countdown and its reminders follow them.">
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs text-[var(--ref-on-surface-variant)]">
          Leave
          <input type="date" className="brutalist-input h-[34px] w-full" value={startDate !== null ? dayKey(startDate) : ''} onChange={(event) => setStart(event.target.value)} />
        </label>
        <label className="space-y-1 text-xs text-[var(--ref-on-surface-variant)]">
          Come back
          <input type="date" className="brutalist-input h-[34px] w-full" min={startDate !== null ? dayKey(startDate) : undefined} value={endDate !== null ? dayKey(endDate) : ''} onChange={(event) => setEnd(event.target.value)} />
        </label>
      </div>
      {days > 0 && <p className="mt-2 text-xs text-[var(--ref-on-surface-variant)]">{days} day{days === 1 ? '' : 's'}, {days - 1} night{days - 1 === 1 ? '' : 's'}</p>}
    </DetailRow>
  );
}

/** The currency spent there, and what one unit costs in rupiah. */
function MoneyRow({ trip, save }: { trip: Trip; save: Save }) {
  const { currency, rate } = trip.basics;
  const [draft, setDraft] = useState(rate !== null ? String(rate) : '');
  const parsed = Number(draft.replace(',', '.'));
  const valid = draft.trim() !== '' && Number.isFinite(parsed) && parsed > 0;
  const symbol = CURRENCIES.find((item) => item.code === currency)?.symbol ?? currency;
  return (
    <DetailRow
      label="Money there"
      info="Bookings and plans can be priced in this currency; they’re counted in rupiah at your rate. Use the rate your bank or card charges."
      control={(
        <Dropdown
          ariaLabel="Money there"
          value={currency ?? 'IDR'}
          options={[{ value: 'IDR', label: 'Rupiah' }, ...CURRENCIES.map((item) => ({ value: item.code, label: `${item.code} · ${item.name}` }))]}
          onChange={(value) => { setDraft(''); save({ currency: value === 'IDR' ? null : value, rate: null }); }}
        />
      )}
    >
      {currency && (
        <form onSubmit={(event) => { event.preventDefault(); if (valid) save({ rate: parsed }); }} className="mt-2">
          <div className="flex items-center justify-end gap-2">
            <span className="shrink-0 whitespace-nowrap text-xs text-[var(--ref-on-surface-variant)]">Rp for {symbol}1</span>
            <input aria-label={`Rupiah for one ${currency}`} inputMode="decimal" className="brutalist-input h-[34px] w-[110px] text-right tabular-nums" placeholder="105,5" value={draft} onChange={(event) => setDraft(event.target.value)} />
            <Button type="submit" size="sm" variant="secondary" disabled={!valid || parsed === rate}>Save</Button>
          </div>
          {rate === null
            ? <p className="mt-2 text-xs text-[var(--color-warning)]">Costs in {currency} aren’t counted until the rate is set.</p>
            : <p className="mt-2 text-xs text-[var(--ref-on-surface-variant)]">Today’s rates are on <a href={BI_RATES} target="_blank" rel="noreferrer noopener" className="font-medium text-[var(--ref-primary)] hover:underline">Bank Indonesia’s site</a>; your card may charge a little more.</p>}
        </form>
      )}
    </DetailRow>
  );
}

/** Spending money for each person each day, counted for the whole trip. */
function SpendingRow({ trip, save }: { trip: Trip; save: Save }) {
  const { formatAmount } = useBalanceVisibility();
  const [draft, setDraft] = useState(trip.basics.dailyBudget);
  const people = Math.max(1, trip.travellers.length);
  const days = tripLength(trip.basics);
  return (
    <DetailRow label="Spending money" info="What each person spends a day on the trip, on food, local transport and small things, beyond what’s booked or planned for the day.">
      <form onSubmit={(event) => { event.preventDefault(); save({ dailyBudget: draft }); }} className="mt-2 flex items-center justify-end gap-2">
        <span className="shrink-0 whitespace-nowrap text-xs text-[var(--ref-on-surface-variant)]">A person a day</span>
        <div className="w-[150px]"><MoneyField ariaLabel="Spending money a person a day" value={draft} onChange={setDraft} /></div>
        <Button type="submit" size="sm" variant="secondary" disabled={draft === trip.basics.dailyBudget}>Save</Button>
      </form>
      {trip.basics.dailyBudget > 0 && days > 0 && (
        <p className="mt-2 text-right text-xs text-[var(--ref-on-surface-variant)]">
          {people} {people === 1 ? 'person' : 'people'} × {days} days = <span className="font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(trip.basics.dailyBudget * people * days)}</span>
        </p>
      )}
    </DetailRow>
  );
}

/**
 * The trip's settings, as rows: where, when, the money spent there and its rate, spending money a
 * day, and the weather (which picks the packing list). Each saves as it changes.
 */
export function TripSettings({ goalId, trip }: { goalId: number; trip: Trip }) {
  const update = useUpdateTripMutation();
  const save: Save = (body) => update.mutate({ id: goalId, ...body }, { onError: (error) => toast.error(errorText(error, 'Could not save the trip')) });
  return (
      <div className="-mx-4 divide-y divide-[var(--color-border)] sm:-mx-5">
        <PlacesRow places={trip.basics.places} save={(places) => save({ places })} />
        <DatesRow trip={trip} save={save} />
        <MoneyRow key={`${trip.basics.currency}:${trip.basics.rate}`} trip={trip} save={save} />
        <SpendingRow key={trip.basics.dailyBudget} trip={trip} save={save} />
        <DetailRow
          label="Weather"
          info="Picks the packing list to start from."
          control={(
            <Dropdown
              ariaLabel="Weather"
              value={trip.basics.climate ?? 'none'}
              options={[{ value: 'none', label: 'Not said' }, { value: 'cold', label: 'Cold' }, { value: 'warm', label: 'Warm' }, { value: 'mixed', label: 'Some of each' }]}
              onChange={(value) => save({ climate: value === 'none' ? null : value })}
            />
          )}
        />
      </div>
  );
}
