import { useRef, useState } from 'react';
import { ArrowRight, Check, Clock, ExternalLink, Hash, MapPin, Paperclip, Plus, Tag, Upload, Wallet } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { Modal } from '../../../components/ui/Modal';
import { toast } from '../../../components/ui/useToast';
import { useBalanceVisibility } from '../../../hooks/useBalanceVisibility';
import { cn } from '../../../lib/utils';
import { MoneyField, Segmented } from '../../savings/fields';
import { Dropdown } from '../../settings/controls';
import { Section } from '../../subscriptions/PageParts';
import { ErrorLine, Footer, IconRow, RemoveButton, SubField, TitleInput } from '../dialogs';
import { goalFileUrl, useUploadGoalFileMutation, type GoalFile } from '../queries';
import { BOOKING_ICONS } from './booking-icons';
import { useAddBookingMutation, useDeleteBookingMutation, useUpdateBookingMutation, type Booking, type Trip } from './queries';
import { BOOKING_KIND_KEYS, BOOKING_KINDS, costText, CURRENCIES, daysBetween, dayKey, fromDayKey, fromWallInput, mapsUrl, shortDate, wallDay, wallInput, wallLabel, wallTime, type BookingKind } from './trip-utils';

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

const TRANSPORT_TYPES = ['Pass', 'Train', 'Car rental', 'Bus', 'Ferry', 'Other'] as const;

const text = (value: string | number | null | undefined) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const orNull = (value: string) => (value.trim() ? value.trim() : null);

/** Nights between checking in and out, by the calendar. */
const nights = (booking: Pick<Booking, 'startAt' | 'endAt'>) => (booking.startAt !== null && booking.endAt !== null ? Math.max(0, Math.round((fromDayKey(wallDay(booking.endAt)) - fromDayKey(wallDay(booking.startAt))) / 86_400_000)) : 0);

/** A plain text box, labelled by the `SubField` or `IconRow` around it. */
function TextInput({ value, onChange, placeholder, maxLength = 200, autoFocus, mono }: { value: string; onChange: (value: string) => void; placeholder?: string; maxLength?: number; autoFocus?: boolean; mono?: boolean }) {
  return <input className={cn('brutalist-input', mono && 'font-mono uppercase placeholder:normal-case')} value={value} maxLength={maxLength} placeholder={placeholder} autoFocus={autoFocus} onChange={(event) => onChange(event.target.value)} />;
}

function WhenInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <input type="datetime-local" className="brutalist-input tabular-nums" value={value} onChange={(event) => onChange(event.target.value)} />;
}

/** An amount in a foreign currency, typed as a plain number. */
function ForeignInput({ value, onChange, ariaLabel }: { value: number; onChange: (value: number) => void; ariaLabel?: string }) {
  return <input aria-label={ariaLabel} inputMode="decimal" className="brutalist-input text-right tabular-nums" value={value ? String(value) : ''} placeholder="0" onChange={(event) => { const next = Number(event.target.value.replace(/[^\d.,]/g, '').replace(',', '.')); onChange(Number.isFinite(next) ? next : 0); }} />;
}

/** Nights between two `datetime-local` values, by the calendar. */
const nightsBetween = (from: string, until: string) => (from && until ? Math.max(0, Math.round((fromDayKey(until.slice(0, 10)) - fromDayKey(from.slice(0, 10))) / 86_400_000)) : 0);

/**
 * Adds or edits a booking. Each kind asks for what matters for it: a flight its airline, number and
 * airports; a stay its address, check-in and check-out and deposit; getting around its type. Times
 * are the clock time where they happen. Its cost can be in rupiah or the trip's currency.
 */
export function BookingDialog({ goalId, trip, files, booking, initialKind = 'flight', onClose }: {
  goalId: number;
  trip: Trip;
  files: GoalFile[];
  booking: Booking | null;
  initialKind?: BookingKind;
  onClose: () => void;
}) {
  const { formatAmount } = useBalanceVisibility();
  const { confirm } = useConfirm();
  const add = useAddBookingMutation();
  const update = useUpdateBookingMutation();
  const remove = useDeleteBookingMutation();
  const upload = useUploadGoalFileMutation();
  const fileInput = useRef<HTMLInputElement>(null);
  const details = booking?.details ?? {};
  const [kind, setKind] = useState<BookingKind>(booking?.kind ?? initialKind);
  const [title, setTitle] = useState(booking?.title ?? '');
  const [startAt, setStartAt] = useState(wallInput(booking?.startAt ?? null));
  const [endAt, setEndAt] = useState(wallInput(booking?.endAt ?? null));
  const [place, setPlace] = useState(booking?.place ?? '');
  const [address, setAddress] = useState(booking?.address ?? '');
  const [code, setCode] = useState(booking?.code ?? '');
  const [cost, setCost] = useState(booking?.cost ?? 0);
  const [currency, setCurrency] = useState(booking?.costCurrency ?? trip.basics.currency ?? 'IDR');
  const [cancelBy, setCancelBy] = useState(booking?.cancelBy ? dayKey(booking.cancelBy) : '');
  const [airline, setAirline] = useState(text(details.airline));
  const [number, setNumber] = useState(text(details.number));
  const [to, setTo] = useState(text(details.to));
  const [deposit, setDeposit] = useState(typeof details.deposit === 'number' ? details.deposit : 0);
  const [transportType, setTransportType] = useState(text(details.type) || 'Pass');
  const [fileIds, setFileIds] = useState<number[]>(booking?.fileIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const busy = add.isPending || update.isPending || remove.isPending;
  const foreign = trip.basics.currency;
  const symbol = CURRENCIES.find((item) => item.code === currency)?.symbol ?? currency;
  // A flight can go without a name: its airline, number and airports name it.
  const flightName = [[airline, number].filter((part) => part.trim()).join(' '), [place, to].filter((part) => part.trim()).join(' → ')].filter(Boolean).join(' ');
  const stayNights = kind === 'stay' ? nightsBetween(startAt, endAt) : 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const named = title.trim() || (kind === 'flight' ? flightName : '');
    if (!named.trim()) return setError('Give it a name.');
    const start = fromWallInput(startAt);
    const end = fromWallInput(endAt);
    if (start !== null && end !== null && end < start) return setError(kind === 'stay' ? 'Checking out can’t be before checking in.' : 'It can’t end before it starts.');
    const kindDetails: Record<string, string | number | null> = kind === 'flight' ? { airline: orNull(airline), number: orNull(number), to: orNull(to) }
      : kind === 'stay' ? { deposit: deposit || null }
        : kind === 'transport' ? { type: transportType, to: orNull(to) }
          : {};
    const body = {
      kind,
      title: named.trim().slice(0, 120),
      startAt: start,
      endAt: kind === 'ticket' ? null : end,
      place: orNull(place),
      address: orNull(address),
      code: orNull(code),
      cost,
      costCurrency: currency,
      cancelBy: cancelBy ? fromDayKey(cancelBy) : null,
      details: Object.fromEntries(Object.entries(kindDetails).filter(([, value]) => value !== null)),
      fileIds,
    };
    try {
      if (booking) await update.mutateAsync({ id: booking.id, ...body });
      else await add.mutateAsync({ goalId, ...body });
      onClose();
    } catch (caught) {
      setError(errorText(caught, 'Could not save the booking'));
    }
  };

  const attach = async (file: File) => {
    try {
      const created = await upload.mutateAsync({ id: goalId, file, fromNotes: true });
      setFileIds((ids) => [...ids, created.id]);
    } catch (caught) {
      toast.error(errorText(caught, 'Could not upload the file'));
    }
  };

  const KindIcon = BOOKING_ICONS[kind];
  const times = kind === 'stay'
    ? { label: 'Check in and out', start: 'Check in', end: 'Check out' }
    : kind === 'flight' ? { label: 'Times, as the clock reads there', start: 'Leaves', end: 'Lands' }
      : kind === 'ticket' ? { label: 'When', start: 'At', end: null }
        : { label: 'When', start: 'Starts', end: 'Ends (optional)' };

  return (
    <Modal
      isOpen
      onClose={() => { if (!busy) onClose(); }}
      title={booking ? `Edit ${BOOKING_KINDS[booking.kind].label.toLowerCase()}` : 'Add a booking'}
      footer={(
        <Footer
          formId="trip-booking"
          submitLabel={booking ? 'Save' : 'Add booking'}
          onClose={onClose}
          busy={busy}
          extra={booking ? (
            <RemoveButton disabled={busy} onClick={async () => {
              const ok = await confirm({ title: `Remove ${booking.title}?`, message: booking.paidAt ? 'Its payment stays in the breakdown.' : 'Its part of the breakdown goes with it.', confirmLabel: 'Remove', variant: 'danger' });
              if (!ok) return;
              try {
                await remove.mutateAsync(booking.id);
                onClose();
              } catch (caught) {
                setError(errorText(caught, 'Could not remove the booking'));
              }
            }} />
          ) : undefined}
        />
      )}
    >
      <form id="trip-booking" onSubmit={submit} className="settings-compact space-y-5">
        <ErrorLine error={error} />

        {/* What kind it is; each asks for what matters for it. */}
        {!booking && (
          <div role="radiogroup" aria-label="Kind of booking" className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
            {BOOKING_KIND_KEYS.map((key) => {
              const Icon = BOOKING_ICONS[key];
              const on = kind === key;
              return (
                <button key={key} type="button" role="radio" aria-checked={on} onClick={() => setKind(key)} className={cn('flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-xs font-semibold transition-colors', on ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]' : 'border-[var(--color-border)] text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)] hover:text-[var(--ref-on-surface)]')}>
                  <Icon className="h-4 w-4" aria-hidden />{BOOKING_KINDS[key].label}
                </button>
              );
            })}
          </div>
        )}

        <TitleInput
          ariaLabel={kind === 'stay' ? 'Where you stay' : 'Name'}
          autoFocus={!booking && kind !== 'flight'}
          placeholder={kind === 'flight' ? flightName || 'Named from the flight below' : BOOKING_KINDS[kind].titleHint}
          value={title}
          onChange={setTitle}
          mark={<KindIcon className="h-4 w-4 text-[var(--ref-primary)]" aria-hidden />}
        />

        {kind === 'flight' && (
          <IconRow icon={Tag} label="Flight">
            <div className="grid grid-cols-2 gap-2">
              <SubField label="Airline"><TextInput value={airline} onChange={setAirline} placeholder="Garuda" maxLength={60} autoFocus={!booking} /></SubField>
              <SubField label="Flight number"><TextInput value={number} onChange={setNumber} placeholder="GA874" maxLength={20} mono /></SubField>
            </div>
          </IconRow>
        )}

        {(kind === 'flight' || kind === 'transport') ? (
          <IconRow icon={MapPin} label={kind === 'flight' ? 'Route' : 'Route (to is optional)'}>
            {kind === 'transport' && <Dropdown ariaLabel="Type" value={transportType} options={TRANSPORT_TYPES.map((type) => ({ value: type, label: type }))} onChange={setTransportType} />}
            <div className="grid grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)] items-end gap-2">
              <SubField label={kind === 'flight' ? 'From' : 'From or pick-up'}><TextInput value={place} onChange={setPlace} placeholder={kind === 'flight' ? 'Jakarta (CGK)' : 'Tokyo Station'} /></SubField>
              <ArrowRight className="mb-[9px] h-4 w-4 text-[var(--ref-on-surface-variant)]" aria-hidden />
              <SubField label={kind === 'flight' ? 'To' : 'To or drop-off'}><TextInput value={to} onChange={setTo} placeholder={kind === 'flight' ? 'Tokyo (HND)' : 'Kyoto'} /></SubField>
            </div>
          </IconRow>
        ) : (
          <IconRow icon={MapPin} label={kind === 'stay' ? 'Address' : 'Where'}>
            {kind !== 'stay' && <TextInput value={place} onChange={setPlace} placeholder="Toyosu, Tokyo" />}
            {(kind === 'stay' || kind === 'ticket') && <TextInput value={address} onChange={setAddress} placeholder={kind === 'stay' ? '1-2-3 Shinjuku, Tokyo' : 'Street address, for the map'} maxLength={300} />}
          </IconRow>
        )}

        <IconRow icon={Clock} label={times.label}>
          <div className={cn('grid gap-2', times.end ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:max-w-[calc(50%-4px)]')}>
            <SubField label={times.start}><WhenInput value={startAt} onChange={setStartAt} /></SubField>
            {times.end && <SubField label={times.end}><WhenInput value={endAt} onChange={setEndAt} /></SubField>}
          </div>
          {stayNights > 0 && <span className="inline-block rounded-full bg-[var(--ref-surface-container-high)] px-2 py-0.5 text-xs font-medium tabular-nums text-[var(--ref-on-surface-variant)]">{stayNights} night{stayNights === 1 ? '' : 's'}</span>}
        </IconRow>

        <IconRow icon={Hash} label="Booking">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <SubField label="Booking code"><TextInput value={code} onChange={setCode} placeholder="XK7P2Q" maxLength={60} mono /></SubField>
            <SubField label="Free cancellation until">
              <input type="date" className="brutalist-input tabular-nums" value={cancelBy} onChange={(event) => setCancelBy(event.target.value)} />
            </SubField>
          </div>
          {cancelBy && <p className="text-xs text-[var(--ref-on-surface-variant)]">You’re reminded three days before it ends.</p>}
        </IconRow>

        <IconRow icon={Wallet} label="Cost">
          <div className="flex gap-2">
            {foreign && <Segmented ariaLabel="Currency" value={currency} options={[{ value: 'IDR', label: 'Rp' }, { value: foreign, label: foreign }]} onChange={setCurrency} />}
            <div className="min-w-0 flex-1">
              {currency === 'IDR' ? <MoneyField ariaLabel="Cost" value={cost} onChange={setCost} /> : <ForeignInput ariaLabel="Cost" value={cost} onChange={setCost} />}
            </div>
          </div>
          {currency !== 'IDR' && cost > 0 && (
            <p className="text-xs text-[var(--ref-on-surface-variant)]">
              {trip.basics.rate ? <>About <span className="font-semibold tabular-nums">{formatAmount(Math.round(cost * trip.basics.rate))}</span> at Rp{trip.basics.rate.toLocaleString('id-ID')} for {symbol}1</> : 'Set the trip’s rate to count it in rupiah.'}
            </p>
          )}
          {kind === 'stay' && (
            <SubField label="Deposit paid ahead (the rest is paid at the stay)">
              {currency === 'IDR' ? <MoneyField value={deposit} onChange={setDeposit} /> : <ForeignInput value={deposit} onChange={setDeposit} />}
            </SubField>
          )}
        </IconRow>

        {/* Its tickets, vouchers and confirmations, from the goal's files. */}
        <IconRow icon={Paperclip} label="Tickets and vouchers">
          {files.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {files.map((file) => (
                <li key={file.id}>
                  <label className="flex items-center gap-2 text-sm text-[var(--ref-on-surface)]">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--ref-primary)]" checked={fileIds.includes(file.id)} onChange={(event) => setFileIds((ids) => (event.target.checked ? [...ids, file.id] : ids.filter((item) => item !== file.id)))} />
                    <span className="truncate">{file.filename}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <input ref={fileInput} type="file" className="hidden" accept="image/*,application/pdf,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) void attach(file); event.target.value = ''; }} />
          <Button type="button" size="sm" variant="secondary" isLoading={upload.isPending} onClick={() => fileInput.current?.click()}><Upload className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />Upload a file</Button>
        </IconRow>
      </form>
    </Modal>
  );
}

/** When a booking happens, in a few words for its kind. */
function when(booking: Booking) {
  if (booking.startAt === null) return null;
  if (booking.kind === 'stay') {
    const count = nights(booking);
    return `${wallLabel(booking.startAt)}${booking.endAt !== null ? ` → ${wallLabel(booking.endAt)}` : ''}${count ? ` · ${count} night${count === 1 ? '' : 's'}` : ''}`;
  }
  if (booking.kind === 'flight' && booking.endAt !== null) {
    const sameDay = wallDay(booking.endAt) === wallDay(booking.startAt);
    return `${wallLabel(booking.startAt)} → ${sameDay ? wallTime(booking.endAt) ?? '' : wallLabel(booking.endAt)}`;
  }
  return `${wallLabel(booking.startAt)}${booking.endAt !== null ? ` → ${wallLabel(booking.endAt)}` : ''}`;
}

function BookingRow({ booking, files, canPay, onPay, onOpen, now }: { booking: Booking; files: GoalFile[]; canPay: boolean; onPay: (partId: number) => void; onOpen: () => void; now: number }) {
  const { formatAmount } = useBalanceVisibility();
  const Icon = BOOKING_ICONS[booking.kind];
  const route = booking.kind === 'flight' || booking.kind === 'transport' ? [booking.place, booking.details.to].filter(Boolean).join(' → ') : booking.place;
  const mapQuery = booking.address ?? (booking.kind === 'flight' ? null : booking.place);
  const attached = files.filter((file) => booking.fileIds.includes(file.id));
  const cancelDays = booking.cancelBy !== null ? daysBetween(now, booking.cancelBy) : null;
  const deposit = typeof booking.details.deposit === 'number' ? booking.details.deposit : null;
  return (
    <li className="flex gap-3 py-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ref-on-surface-variant)]" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <button type="button" onClick={onOpen} className="min-w-0 text-left">
            <span className="block truncate text-sm font-semibold text-[var(--ref-on-surface)] hover:underline">{booking.title}</span>
            {when(booking) && <span className="block text-xs text-[var(--ref-on-surface-variant)]">{when(booking)}</span>}
          </button>
          <span className="shrink-0 text-right">
            {booking.costCurrency !== 'IDR' && booking.cost > 0 && <span className="block text-xs tabular-nums text-[var(--ref-on-surface-variant)]">{costText(booking.cost, booking.costCurrency)}</span>}
            <span className="block text-sm font-semibold tabular-nums text-[var(--ref-on-surface)]">{booking.rupiah > 0 ? formatAmount(booking.rupiah) : booking.cost > 0 ? '—' : 'Free'}</span>
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ref-on-surface-variant)]">
          {route && !booking.title.includes(route) && <span>{route}</span>}
          {booking.code && <span>Code <span className="font-mono font-semibold text-[var(--ref-on-surface)]">{booking.code}</span></span>}
          {deposit !== null && <span>Deposit {costText(deposit, booking.costCurrency)}</span>}
          {mapQuery && <a href={mapsUrl(mapQuery)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 font-medium text-[var(--ref-primary)] hover:underline">Map<ExternalLink className="h-3 w-3" aria-hidden /></a>}
          {attached.map((file) => <a key={file.id} href={goalFileUrl(file.id)} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-[160px] items-center gap-0.5 font-medium text-[var(--ref-primary)] hover:underline"><Paperclip className="h-3 w-3 shrink-0" aria-hidden /><span className="truncate">{file.filename}</span></a>)}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {booking.paidAt !== null ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-success)]/10 px-2 py-0.5 text-[11px] font-semibold text-[var(--color-success)]"><Check className="h-3 w-3" aria-hidden />Paid {shortDate(booking.paidAt)}</span>
          ) : booking.partId !== null ? (
            canPay
              ? <Button type="button" size="sm" variant="secondary" className="h-[28px] px-2 text-xs" onClick={() => onPay(booking.partId!)}>Pay from goal</Button>
              : <span className="rounded-full bg-[var(--ref-surface-container-low)] px-2 py-0.5 text-[11px] font-semibold">Not paid</span>
          ) : null}
          {cancelDays !== null && cancelDays >= 0 && (
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', cancelDays <= 3 ? 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]' : 'bg-[var(--ref-surface-container-low)] text-[var(--ref-on-surface-variant)]')}>
              Free cancellation {cancelDays === 0 ? 'ends today' : cancelDays === 1 ? 'ends tomorrow' : `until ${shortDate(booking.cancelBy!)}`}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * The trip's bookings by kind: when, where (with a map link), the booking code, what it costs
 * there and in rupiah, whether it's paid, and when free cancellation ends. Each one with a cost
 * is a part of the breakdown, so paying it from the goal ticks it off in both places.
 */
export function BookingsSection({ goalId, trip, files, canPay, onPay, now }: { goalId: number; trip: Trip; files: GoalFile[]; canPay: boolean; onPay: (partId: number) => void; now: number }) {
  const { formatAmount } = useBalanceVisibility();
  const [open, setOpen] = useState<{ booking: Booking | null; kind: BookingKind } | null>(null);
  const groups = BOOKING_KIND_KEYS.map((kind) => ({ kind, bookings: trip.bookings.filter((booking) => booking.kind === kind) })).filter((group) => group.bookings.length > 0);
  const unpaid = trip.bookings.filter((booking) => booking.partId !== null && booking.paidAt === null);

  return (
    <Section
      title="Bookings"
      aside={(
        <span className="flex items-center gap-2">
          {unpaid.length > 0 && <span className="text-xs text-[var(--ref-on-surface-variant)]">{unpaid.length} not paid · {formatAmount(unpaid.reduce((sum, booking) => sum + booking.rupiah, 0))}</span>}
          {trip.bookings.length > 0 && <Button type="button" size="sm" variant="secondary" onClick={() => setOpen({ booking: null, kind: 'flight' })}><Plus className="mr-1 inline h-3.5 w-3.5" aria-hidden />Add</Button>}
        </span>
      )}
    >
      <div className="px-4 sm:px-5">
        {groups.length === 0 ? (
          <div className="py-4">
            <p className="text-sm text-[var(--ref-on-surface-variant)]">Flights, stays, passes and tickets go here, each with its booking code, map link and files. What they cost fills the breakdown.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {BOOKING_KIND_KEYS.map((kind) => {
                const Icon = BOOKING_ICONS[kind];
                return (
                  <Button key={kind} type="button" size="sm" variant="secondary" onClick={() => setOpen({ booking: null, kind })}>
                    <Icon className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />{BOOKING_KINDS[kind].label}
                  </Button>
                );
              })}
            </div>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.kind} className="border-b border-[var(--color-border)] py-1 last:border-b-0">
              <p className="flex items-center justify-between pt-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--ref-on-surface-variant)]">
                <span>{BOOKING_KINDS[group.kind].plural}</span>
                <span className="tabular-nums tracking-normal">{formatAmount(group.bookings.reduce((sum, booking) => sum + booking.rupiah, 0))}</span>
              </p>
              <ul className="divide-y divide-[var(--color-border)]">
                {group.bookings.map((booking) => <BookingRow key={booking.id} booking={booking} files={files} canPay={canPay} onPay={onPay} onOpen={() => setOpen({ booking, kind: booking.kind })} now={now} />)}
              </ul>
            </div>
          ))
        )}
        {trip.bookings.some((booking) => booking.cost > 0 && booking.rupiah === 0) && (
          <p className="pb-3 text-xs text-[var(--color-warning)]">Some costs are in {trip.basics.currency ?? 'another currency'} and aren’t counted yet: set the rate in Trip.</p>
        )}
      </div>
      {open && <BookingDialog goalId={goalId} trip={trip} files={files} booking={open.booking} initialKind={open.kind} onClose={() => setOpen(null)} />}
    </Section>
  );
}
