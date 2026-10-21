/**
 * The arithmetic of a holiday goal's trip, kept apart from the page so it can be tested: its days,
 * what each day holds, what it all costs against the target, what to pack, and its calendar file.
 */

export type TripBasics = {
  places: string[];
  startDate: number | null;
  endDate: number | null;
  currency: string | null;
  rate: number | null;
  dailyBudget: number;
  climate: 'cold' | 'warm' | 'mixed' | null;
};

export type BookingKind = 'flight' | 'stay' | 'transport' | 'ticket' | 'other';

export type TripBooking = {
  id: number;
  kind: BookingKind;
  title: string;
  startAt: number | null;
  endAt: number | null;
  place: string | null;
  address: string | null;
  code: string | null;
  cost: number;
  costCurrency: string;
  rupiah: number;
  cancelBy: number | null;
  details: Record<string, string | number | null>;
  partId: number | null;
  paidAt: number | null;
  paid: number;
};

export type TripPlan = { id: number; day: string; time: string | null; endTime?: string | null; title: string; place: string | null; cost: number; costCurrency: string; rupiah: number; color?: PlanColor | null; sortOrder: number };

/** A plan's colour on the calendar; each is dark enough for white text on it. Null is the accent colour. */
export const PLAN_COLORS = ['blue', 'teal', 'green', 'amber', 'red', 'pink', 'purple', 'graphite'] as const;
export type PlanColor = (typeof PLAN_COLORS)[number];
export const PLAN_COLOR_INFO: Record<PlanColor, { label: string; fill: string }> = {
  blue: { label: 'Blue', fill: '#2563eb' },
  teal: { label: 'Teal', fill: '#0f766e' },
  green: { label: 'Green', fill: '#15803d' },
  amber: { label: 'Amber', fill: '#b45309' },
  red: { label: 'Red', fill: '#dc2626' },
  pink: { label: 'Pink', fill: '#db2777' },
  purple: { label: 'Purple', fill: '#7c3aed' },
  graphite: { label: 'Graphite', fill: '#475569' },
};
/** The fill and text colour for a plan's block. */
export const planFill = (color: PlanColor | null | undefined) => (color ? { background: PLAN_COLOR_INFO[color].fill, color: '#fff' } : { background: 'var(--ref-primary)', color: 'var(--color-surface)' });
export type TripTraveller = { id: number; name: string; paying: boolean; passportExpiry: number | null };

export const BOOKING_KINDS: Record<BookingKind, { label: string; plural: string; titleHint: string }> = {
  flight: { label: 'Flight', plural: 'Flights', titleHint: 'Garuda to Tokyo' },
  stay: { label: 'Stay', plural: 'Stays', titleHint: 'Hotel in Shinjuku' },
  transport: { label: 'Getting around', plural: 'Getting around', titleHint: 'JR Pass, 7 days' },
  ticket: { label: 'Ticket', plural: 'Tickets', titleHint: 'teamLab Planets' },
  other: { label: 'Other', plural: 'Other', titleHint: 'Travel insurance' },
};
export const BOOKING_KIND_KEYS = Object.keys(BOOKING_KINDS) as BookingKind[];

/** Currencies a trip is likely to be paid in, nearest first. */
export const CURRENCIES: Array<{ code: string; name: string; symbol: string }> = [
  { code: 'SGD', name: 'Singapore dollar', symbol: 'S$' },
  { code: 'MYR', name: 'Malaysian ringgit', symbol: 'RM' },
  { code: 'THB', name: 'Thai baht', symbol: '฿' },
  { code: 'VND', name: 'Vietnamese dong', symbol: '₫' },
  { code: 'PHP', name: 'Philippine peso', symbol: '₱' },
  { code: 'JPY', name: 'Japanese yen', symbol: '¥' },
  { code: 'KRW', name: 'Korean won', symbol: '₩' },
  { code: 'CNY', name: 'Chinese yuan', symbol: 'CN¥' },
  { code: 'HKD', name: 'Hong Kong dollar', symbol: 'HK$' },
  { code: 'TWD', name: 'Taiwan dollar', symbol: 'NT$' },
  { code: 'AUD', name: 'Australian dollar', symbol: 'A$' },
  { code: 'NZD', name: 'New Zealand dollar', symbol: 'NZ$' },
  { code: 'SAR', name: 'Saudi riyal', symbol: 'SAR' },
  { code: 'AED', name: 'UAE dirham', symbol: 'AED' },
  { code: 'TRY', name: 'Turkish lira', symbol: '₺' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British pound', symbol: '£' },
  { code: 'CHF', name: 'Swiss franc', symbol: 'CHF' },
  { code: 'USD', name: 'US dollar', symbol: 'US$' },
];

const DAY = 86_400_000;
const pad = (value: number) => String(value).padStart(2, '0');

/** A day as `YYYY-MM-DD` on this device's calendar. */
export const dayKey = (time: number) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** Noon of a `YYYY-MM-DD` day, so it's the same day in any time zone near this one. */
export const fromDayKey = (key: string) => {
  const [year, month, date] = key.split('-').map(Number);
  return new Date(year, month - 1, date, 12).getTime();
};

/*
 * A booking's times are the clock time where they happen (a flight leaving at 06:00 in Jakarta and
 * landing at 15:30 in Tokyo), kept as if they were UTC so they read the same whatever time zone
 * the phone is in on the way. These read and write them.
 */

/** The day of a booking time, as `YYYY-MM-DD`. */
export const wallDay = (time: number) => {
  const date = new Date(time);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

/** `HH:MM` of a booking time, or null at midnight, which reads as "no time given". */
export const wallTime = (time: number) => {
  const date = new Date(time);
  return date.getUTCHours() === 0 && date.getUTCMinutes() === 0 ? null : `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};

/** A day and time as a booking time. */
export const toWall = (day: string, time: string | null) => {
  const [year, month, date] = day.split('-').map(Number);
  const [hours, minutes] = (time ?? '00:00').split(':').map(Number);
  return Date.UTC(year, month - 1, date, hours, minutes);
};

/** A booking time for a `datetime-local` input, and back. */
export const wallInput = (time: number | null) => (time === null ? '' : `${wallDay(time)}T${wallTime(time) ?? '00:00'}`);
export const fromWallInput = (value: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ? toWall(value.slice(0, 10), value.slice(11, 16)) : null);

/** A booking time to read, like "Wed 10 Mar, 06:00". */
export const wallLabel = (time: number) => `${dayLabel(wallDay(time))}${wallTime(time) ? `, ${wallTime(time)}` : ''}`;

export const dayLabel = (key: string) => new Date(fromDayKey(key)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
export const shortDate = (time: number) => new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** Days from one time to another, by the calendar. */
export const daysBetween = (from: number, to: number) => Math.round((new Date(to).setHours(0, 0, 0, 0) - new Date(from).setHours(0, 0, 0, 0)) / DAY);

/** How many days the trip lasts, counting both ends; 0 without both dates. */
export function tripLength(basics: Pick<TripBasics, 'startDate' | 'endDate'>) {
  if (basics.startDate === null || basics.endDate === null || basics.endDate < basics.startDate) return 0;
  return daysBetween(basics.startDate, basics.endDate) + 1;
}

/** Each day of the trip as `YYYY-MM-DD`, up to 60 of them. */
export function tripDays(basics: Pick<TripBasics, 'startDate' | 'endDate'>): string[] {
  const length = Math.min(60, tripLength(basics));
  const start = new Date(basics.startDate ?? 0);
  return Array.from({ length }, (_, index) => dayKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + index, 12).getTime()));
}

/** Before, during or after the trip; null without a date to leave. */
export function tripPhase(basics: Pick<TripBasics, 'startDate' | 'endDate'>, now: number): 'before' | 'during' | 'after' | null {
  if (basics.startDate === null) return null;
  if (daysBetween(now, basics.startDate) > 0) return 'before';
  return daysBetween(basics.endDate ?? basics.startDate, now) > 0 ? 'after' : 'during';
}

export type DayItem =
  | { type: 'booking'; booking: TripBooking; role: 'leave' | 'arrive' | 'check-in' | 'check-out' | 'on'; time: string | null }
  | { type: 'plan'; plan: TripPlan; time: string | null };

/**
 * What each day of the trip holds: bookings where they fall (a flight on the day it leaves and,
 * when different, the day it lands; a stay on check-in and check-out), the day's own plans, and
 * where you sleep that night. Timed things come in order of time, then plans without one.
 */
export function itinerary(basics: TripBasics, bookings: readonly TripBooking[], plans: readonly TripPlan[]) {
  const days = tripDays(basics);
  const inTrip = new Set(days);
  const byDay = new Map<string, DayItem[]>(days.map((key) => [key, []]));
  const add = (key: string, item: DayItem) => byDay.get(key)?.push(item);
  for (const booking of bookings) {
    if (booking.startAt === null) continue;
    const start = wallDay(booking.startAt);
    const end = booking.endAt !== null ? wallDay(booking.endAt) : null;
    if (booking.kind === 'stay') {
      add(start, { type: 'booking', booking, role: 'check-in', time: wallTime(booking.startAt) });
      if (end && end !== start) add(end, { type: 'booking', booking, role: 'check-out', time: wallTime(booking.endAt!) });
    } else if (booking.kind === 'flight') {
      add(start, { type: 'booking', booking, role: 'leave', time: wallTime(booking.startAt) });
      if (end && end !== start) add(end, { type: 'booking', booking, role: 'arrive', time: wallTime(booking.endAt!) });
    } else {
      add(start, { type: 'booking', booking, role: 'on', time: wallTime(booking.startAt) });
    }
  }
  for (const plan of [...plans].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)) add(plan.day, { type: 'plan', plan, time: plan.time });
  const stays = bookings.filter((booking) => booking.kind === 'stay' && booking.startAt !== null && booking.endAt !== null);
  return {
    days: days.map((key, index) => {
      const items = byDay.get(key)!;
      const timed = items.filter((item) => item.time !== null).sort((a, b) => a.time!.localeCompare(b.time!));
      const untimed = items.filter((item) => item.time === null);
      const noon = fromDayKey(key);
      // A night is spent where you checked in on or before this day and leave after it.
      const sleep = stays.find((stay) => wallDay(stay.startAt!) <= key && wallDay(stay.endAt!) > key) ?? null;
      return {
        key,
        index: index + 1,
        items: [...timed, ...untimed],
        planned: items.reduce((sum, item) => sum + (item.type === 'plan' ? item.plan.rupiah : 0), 0),
        sleep,
        noon,
      };
    }),
    /** Plans on days outside the trip, like after the dates moved. */
    elsewhere: plans.filter((plan) => !inTrip.has(plan.day)),
  };
}

/**
 * The city each day of the trip is spent in: the one you chose for it, or else the day before's,
 * starting from the first place on the trip.
 */
export function dayCities(days: readonly string[], places: readonly string[], chosen: Readonly<Record<string, unknown>>): string[] {
  let current = places[0] ?? '';
  return days.map((day) => {
    const set = chosen[day];
    if (typeof set === 'string' && set.trim()) current = set.trim();
    return current;
  });
}

export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'any';
export const PARTS_OF_DAY: Record<PartOfDay, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', any: 'Any time' };

/** Before noon is morning, until five the afternoon, then evening; no time is any time. */
export const partOfDay = (time: string | null): PartOfDay => (time === null ? 'any' : time < '12:00' ? 'morning' : time < '17:00' ? 'afternoon' : 'evening');

/** `HH:MM` as minutes after midnight, and back. */
export const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export const clockOf = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;

/**
 * Side-by-side lanes for one day's timed things on a calendar: what overlaps sits next to each
 * other, each taking a lane, and a group of overlapping things shares how many lanes it needs.
 */
export function calendarLanes<T extends { start: number; end: number }>(items: readonly T[]): Array<T & { lane: number; lanes: number }> {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Array<T & { lane: number; lanes: number }> = [];
  let group: Array<T & { lane: number; lanes: number }> = [];
  let groupEnd = -1;
  const close = () => {
    const lanes = Math.max(1, ...group.map((item) => item.lane + 1));
    for (const item of group) item.lanes = lanes;
    out.push(...group);
    group = [];
  };
  for (const item of sorted) {
    if (group.length && item.start >= groupEnd) close();
    const used = new Set(group.filter((other) => other.end > item.start).map((other) => other.lane));
    let lane = 0;
    while (used.has(lane)) lane += 1;
    group.push({ ...item, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, item.end);
  }
  if (group.length) close();
  return out;
}

export type NextItem =
  | { type: 'booking'; day: string; time: string | null; booking: TripBooking; role: 'leave' | 'arrive' | 'check-in' | 'check-out' | 'on' }
  | { type: 'plan'; day: string; time: string | null; plan: TripPlan };

/**
 * What's coming next on the trip, in order: bookings (a flight leaving or landing, checking in or
 * out) and plans from now on, the first few. Today's untimed things count as still to come.
 */
export function nextUp(bookings: readonly TripBooking[], plans: readonly TripPlan[], now: number, limit = 4): NextItem[] {
  const today = dayKey(now);
  const date = new Date(now);
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const items: NextItem[] = [];
  for (const booking of bookings) {
    if (booking.startAt === null) continue;
    const startRole = booking.kind === 'stay' ? 'check-in' : booking.kind === 'flight' ? 'leave' : 'on';
    items.push({ type: 'booking', day: wallDay(booking.startAt), time: wallTime(booking.startAt), booking, role: startRole });
    if (booking.endAt !== null && (booking.kind === 'stay' || booking.kind === 'flight')) {
      items.push({ type: 'booking', day: wallDay(booking.endAt), time: wallTime(booking.endAt), booking, role: booking.kind === 'stay' ? 'check-out' : 'arrive' });
    }
  }
  for (const plan of plans) items.push({ type: 'plan', day: plan.day, time: plan.time, plan });
  return items
    .filter((item) => item.day > today || (item.day === today && (item.time === null || item.time >= clock)))
    .sort((a, b) => `${a.day}T${a.time ?? '00:00'}`.localeCompare(`${b.day}T${b.time ?? '00:00'}`))
    .slice(0, limit);
}

export type TripBudget = {
  days: number;
  people: number;
  payers: number;
  byKind: Record<BookingKind, number>;
  booked: number;
  paid: number;
  plans: number;
  spendingMoney: number;
  total: number;
  /** What's left of the target once all this is counted; negative when it's over. */
  left: number;
  perPayer: number;
  /** Costs in the trip's currency that can't be counted in rupiah until its rate is set. */
  unconverted: number;
};

/** Everything planned for the trip against the goal's target. */
export function tripBudget(basics: TripBasics, bookings: readonly TripBooking[], plans: readonly TripPlan[], travellers: readonly TripTraveller[], target: number): TripBudget {
  const days = tripLength(basics);
  const people = Math.max(1, travellers.length);
  const payers = Math.max(1, travellers.filter((traveller) => traveller.paying).length);
  const byKind = Object.fromEntries(Object.keys(BOOKING_KINDS).map((kind) => [kind, 0])) as Record<BookingKind, number>;
  for (const booking of bookings) byKind[booking.kind] += booking.rupiah;
  const booked = bookings.reduce((sum, booking) => sum + booking.rupiah, 0);
  const paid = bookings.reduce((sum, booking) => sum + booking.paid, 0);
  const planned = plans.reduce((sum, plan) => sum + plan.rupiah, 0);
  const spendingMoney = basics.dailyBudget * days * people;
  const total = booked + planned + spendingMoney;
  const unconverted = [...bookings, ...plans].filter((item) => item.cost > 0 && item.rupiah === 0).length;
  return { days, people, payers, byKind, booked, paid, plans: planned, spendingMoney, total, left: target - total, perPayer: Math.round(total / payers), unconverted };
}

/** A cost as written in its currency, like ¥60.000 or Rp1.200.000. */
export function costText(cost: number, currency: string) {
  if (currency === 'IDR') return `Rp${Math.round(cost).toLocaleString('id-ID')}`;
  const symbol = CURRENCIES.find((item) => item.code === currency)?.symbol ?? currency;
  return `${symbol}${cost.toLocaleString('id-ID', { maximumFractionDigits: 2 })}`;
}

/** Google Maps for a place or address. */
export const mapsUrl = (query: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

/** Some countries want a passport valid six months after you arrive or leave; check the country's rule. */
export const PASSPORT_MONTHS = 6;

/** Whether a passport runs out before the trip ends, or within six months after it. */
export function passportState(expiry: number | null, basics: Pick<TripBasics, 'startDate' | 'endDate'>): 'ok' | 'soon' | 'expired' | null {
  if (expiry === null) return null;
  const back = basics.endDate ?? basics.startDate;
  if (back === null) return null;
  if (expiry < back) return 'expired';
  const needed = new Date(back);
  needed.setMonth(needed.getMonth() + PASSPORT_MONTHS);
  return expiry < needed.getTime() ? 'soon' : 'ok';
}

const icsText = (value: string) => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** A booking time as a calendar's "floating" time: that clock time wherever you are. */
const icsWall = (time: number) => `${wallDay(time).replace(/-/g, '')}T${(wallTime(time) ?? '00:00').replace(':', '')}00`;
const icsUtc = (time: number) => new Date(time).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** Long lines folded at 75 characters, as calendar files want. */
const fold = (line: string) => line.match(/.{1,74}/g)!.join('\r\n ');

/**
 * The trip as a calendar file: each booking and plan with a date is an event, at the clock time
 * it happens there (a calendar shows it at that time wherever you are); one without a time lasts the day.
 */
export function tripCalendar(goalName: string, bookings: readonly TripBooking[], plans: readonly TripPlan[], now = Date.now()) {
  const stamp = icsUtc(now);
  const events: string[][] = [];
  const timed = (start: number, end: number | null) => {
    if (wallTime(start) === null && (end === null || wallTime(end) === null)) {
      const after = (end ?? start) + DAY;
      return [`DTSTART;VALUE=DATE:${wallDay(start).replace(/-/g, '')}`, `DTEND;VALUE=DATE:${wallDay(after).replace(/-/g, '')}`];
    }
    return [`DTSTART:${icsWall(start)}`, `DTEND:${icsWall(end !== null && end > start ? end : start + 3_600_000)}`];
  };
  for (const booking of bookings) {
    if (booking.startAt === null) continue;
    const where = [booking.place, booking.address].filter(Boolean).join(', ');
    const notes = [booking.code ? `Booking code: ${booking.code}` : null, booking.cancelBy ? `Free cancellation until ${shortDate(booking.cancelBy)}` : null, goalName].filter(Boolean).join('\n');
    if (booking.kind === 'stay' && booking.endAt !== null) {
      // A stay is two moments: checking in and checking out.
      events.push([`UID:stay-in-${booking.id}@fainens`, `SUMMARY:${icsText(`Check in: ${booking.title}`)}`, ...timed(booking.startAt, null), ...(where ? [`LOCATION:${icsText(where)}`] : []), `DESCRIPTION:${icsText(notes)}`]);
      events.push([`UID:stay-out-${booking.id}@fainens`, `SUMMARY:${icsText(`Check out: ${booking.title}`)}`, ...timed(booking.endAt, null), ...(where ? [`LOCATION:${icsText(where)}`] : []), `DESCRIPTION:${icsText(notes)}`]);
      continue;
    }
    events.push([`UID:booking-${booking.id}@fainens`, `SUMMARY:${icsText(booking.title)}`, ...timed(booking.startAt, booking.endAt), ...(where ? [`LOCATION:${icsText(where)}`] : []), `DESCRIPTION:${icsText(notes)}`]);
  }
  for (const plan of plans) {
    events.push([`UID:plan-${plan.id}@fainens`, `SUMMARY:${icsText(plan.title)}`, ...timed(toWall(plan.day, plan.time), plan.time && plan.endTime ? toWall(plan.day, plan.endTime) : null), ...(plan.place ? [`LOCATION:${icsText(plan.place)}`] : []), `DESCRIPTION:${icsText(goalName)}`]);
  }
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fainens//Trip//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsText(goalName)}`, ...events.flatMap((event) => ['BEGIN:VEVENT', `DTSTAMP:${stamp}`, ...event, 'END:VEVENT']), 'END:VCALENDAR'];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
