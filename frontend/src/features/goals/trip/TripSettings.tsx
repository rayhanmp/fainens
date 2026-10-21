import { useId, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { toast } from '../../../components/ui/useToast';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { cn } from '../../../lib/utils';
import { MoneyField } from '../../savings/fields';
import { Dropdown } from '../../settings/controls';
import { guessClimate, guessText, suggestPlaces, WEATHER } from './climate';
import type { Trip, TripSave } from './queries';
import { CURRENCIES, dayKey, fromDayKey, tripLength } from './trip-utils';

/** Bank Indonesia's daily exchange rates. */
const BI_RATES = 'https://www.bi.go.id/id/statistik/informasi-kurs/transaksi-bi/default.aspx';

const note = 'text-xs text-[var(--ref-on-surface-variant)]';

/**
 * The places, in order: chips, and a field that suggests places people often go (by name or
 * country) as you type. One that isn't listed is added as typed.
 */
export function PlacesEditor({ places, save }: { places: string[]; save: (places: string[]) => void }) {
  const listId = useId();
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typed = draft.trim();
  const matches = suggestPlaces(typed, places);
  const listed = matches.some((place) => place.name.toLowerCase() === typed.toLowerCase());
  const options = [...matches.map((place) => ({ value: place.name, hint: place.country })), ...(typed && !listed ? [{ value: typed, hint: null }] : [])];
  const add = (place: string) => {
    const name = place.trim();
    setDraft('');
    setActive(0);
    if (!name || places.some((item) => item.toLowerCase() === name.toLowerCase())) return;
    save([...places, name]);
  };

  return (
    <div className="space-y-2">
      {places.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {places.map((place) => (
            <span key={place} className="inline-flex items-center gap-1 rounded-full bg-[var(--ref-surface-container-high)] py-0.5 pl-2.5 pr-1 text-xs font-semibold text-[var(--ref-on-surface)]">
              {place}
              <button type="button" aria-label={`Remove ${place}`} onClick={() => save(places.filter((item) => item !== place))} className="grid h-5 w-5 place-items-center rounded-full text-[var(--ref-on-surface-variant)] hover:bg-[var(--color-surface)]"><X className="h-3 w-3" aria-hidden /></button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          role="combobox"
          aria-label="Add a place"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          className="brutalist-input"
          placeholder={places.length ? 'Add another place' : 'Pick or type a place'}
          value={draft}
          maxLength={80}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(event) => { setDraft(event.target.value); setActive(0); setOpen(true); }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((at) => Math.min(options.length - 1, at + 1)); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActive((at) => Math.max(0, at - 1)); }
            if (event.key === 'Escape') setOpen(false);
            if (event.key === 'Enter') { event.preventDefault(); if (open && options[active]) add(options[active].value); else if (typed) add(typed); }
          }}
        />
        {open && options.length > 0 && (
          <ul id={listId} role="listbox" aria-label="Places" className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg">
            {options.map((option, at) => (
              <li
                key={`${option.value}-${option.hint ?? 'typed'}`}
                id={`${listId}-${at}`}
                role="option"
                aria-selected={at === active}
                onMouseDown={(event) => { event.preventDefault(); add(option.value); }}
                onMouseEnter={() => setActive(at)}
                className={cn('flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm', at === active && 'bg-[var(--ref-surface-container-low)]')}
              >
                {option.hint
                  ? <><span className="truncate text-[var(--ref-on-surface)]">{option.value}</span><span className="shrink-0 text-xs text-[var(--ref-on-surface-variant)]">{option.hint}</span></>
                  : <span className="flex min-w-0 items-center gap-1.5 text-[var(--ref-primary)]"><Plus className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="truncate">Add “{option.value}”</span></span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** When you leave and come back; moving the day you leave keeps the trip as long as it was. */
export function DatesEditor({ trip, save }: { trip: Trip; save: TripSave }) {
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
    <div className="space-y-2">
      {/* Side by side only where a date fits whole; stacked on a phone and in the narrow side rail. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
        <label className="min-w-0 space-y-1">
          <span className={cn('block', note)}>Leave</span>
          <input type="date" className="brutalist-input tabular-nums" value={startDate !== null ? dayKey(startDate) : ''} onChange={(event) => setStart(event.target.value)} />
        </label>
        <label className="min-w-0 space-y-1">
          <span className={cn('block', note)}>Come back</span>
          <input type="date" className="brutalist-input tabular-nums" min={startDate !== null ? dayKey(startDate) : undefined} value={endDate !== null ? dayKey(endDate) : ''} onChange={(event) => setEnd(event.target.value)} />
        </label>
      </div>
      {days > 0 && <p className={note}>{days} day{days === 1 ? '' : 's'}, {days - 1} night{days - 1 === 1 ? '' : 's'}</p>}
    </div>
  );
}

/** The currency spent there, and what one unit costs in rupiah; the rate saves when you leave the field. */
export function MoneyEditor({ trip, save }: { trip: Trip; save: TripSave }) {
  const { currency, rate } = trip.basics;
  const [draft, setDraft] = useState(rate !== null ? String(rate) : '');
  const parsed = Number(draft.replace(',', '.'));
  const valid = draft.trim() !== '' && Number.isFinite(parsed) && parsed > 0;
  const symbol = CURRENCIES.find((item) => item.code === currency)?.symbol ?? currency;
  const commit = () => { if (valid && parsed !== rate) save({ rate: parsed }); };
  return (
    <div className="space-y-2">
      <Dropdown
        ariaLabel="Money there"
        value={currency ?? 'IDR'}
        options={[{ value: 'IDR', label: 'Rupiah' }, ...CURRENCIES.map((item) => ({ value: item.code, label: `${item.code} · ${item.name}` }))]}
        onChange={(value) => { setDraft(''); save({ currency: value === 'IDR' ? null : value, rate: null }); }}
      />
      {currency && (
        <>
          <form onSubmit={(event) => { event.preventDefault(); commit(); }}>
            <label className="flex items-center gap-2">
              <span className={cn('shrink-0 whitespace-nowrap', note)}>Rp for {symbol}1</span>
              <input aria-label={`Rupiah for one ${currency}`} inputMode="decimal" className="brutalist-input text-right tabular-nums" placeholder="105,5" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} />
            </label>
          </form>
          {rate === null
            ? <p className="text-xs text-[var(--color-warning)]">Costs in {currency} aren’t counted until the rate is set.</p>
            : <p className={note}>Today’s rates are on <a href={BI_RATES} target="_blank" rel="noreferrer noopener" className="font-medium text-[var(--ref-primary)] hover:underline">Bank Indonesia’s site</a>; your card may charge a little more.</p>}
        </>
      )}
    </div>
  );
}

/** Spending money for each person each day, counted for the whole trip; saves when you leave the field. */
export function SpendingEditor({ trip, save }: { trip: Trip; save: TripSave }) {
  const { formatAmount } = useBalanceVisibility();
  const [draft, setDraft] = useState(trip.basics.dailyBudget);
  const people = Math.max(1, trip.travellers.length);
  const days = tripLength(trip.basics);
  const commit = () => { if (draft !== trip.basics.dailyBudget) save({ dailyBudget: draft }); };
  return (
    <form onSubmit={(event) => { event.preventDefault(); commit(); }} className="space-y-1">
      <div onBlur={commit}><MoneyField ariaLabel="Spending money a person a day" value={draft} onChange={setDraft} /></div>
      <p className={note}>
        A person a day{draft > 0 && days > 0 ? <> · {people} {people === 1 ? 'person' : 'people'} × {days} days = <span className="font-semibold tabular-nums text-[var(--ref-on-surface)]">{formatAmount(draft * people * days)}</span></> : null}
      </p>
    </form>
  );
}

/** The weather, which picks the packing list; left alone, it's guessed from the places and dates. */
export function WeatherEditor({ trip, save }: { trip: Trip; save: TripSave }) {
  const guess = guessClimate(trip.basics.places, trip.basics.startDate, trip.basics.endDate);
  return (
    <div className="space-y-1">
      <Dropdown
        ariaLabel="Weather"
        value={trip.basics.climate ?? 'none'}
        options={[{ value: 'none', label: guess ? `${WEATHER[guess.climate]} (guessed)` : 'Not said' }, { value: 'cold', label: 'Cold' }, { value: 'warm', label: 'Warm' }, { value: 'mixed', label: 'Some of each' }]}
        onChange={(value) => save({ climate: value === 'none' ? null : value })}
      />
      {guess && (
        <>
          <p className={cn(note, 'first-letter:uppercase')}>{guessText(guess)}, from long-term averages, not a forecast.</p>
          <p className="text-[11px] text-[var(--ref-outline)]">{guess.sources.replace(/^.*?forecast\. /, 'Source: ')}</p>
        </>
      )}
    </div>
  );
}
