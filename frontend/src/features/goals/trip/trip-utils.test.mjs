import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calendarLanes,
  clockOf,
  costText,
  dayCities,
  minutesOf,
  partOfDay,
  fromWallInput,
  itinerary,
  nextUp,
  passportState,
  toWall,
  tripBudget,
  tripCalendar,
  tripDays,
  tripPhase,
  wallInput,
  wallLabel,
} from './trip-utils.ts';

const noon = (month, date) => new Date(2027, month, date, 12).getTime();
const basics = { places: ['Tokyo'], startDate: noon(2, 10), endDate: noon(2, 13), currency: 'JPY', rate: 105, dailyBudget: 500_000, climate: 'cold' };
const booking = (patch) => ({ id: 1, kind: 'other', title: 'x', startAt: null, endAt: null, place: null, address: null, code: null, cost: 0, costCurrency: 'IDR', rupiah: 0, cancelBy: null, details: {}, partId: null, paidAt: null, paid: 0, ...patch });
const plan = (patch) => ({ id: 1, day: '2027-03-11', time: null, title: 'x', place: null, cost: 0, costCurrency: 'IDR', rupiah: 0, sortOrder: 0, ...patch });

test('a trip has its days, and is before, during or after them', () => {
  assert.deepEqual(tripDays(basics), ['2027-03-10', '2027-03-11', '2027-03-12', '2027-03-13']);
  assert.deepEqual(tripDays({ startDate: null, endDate: null }), []);
  assert.equal(tripPhase(basics, new Date(2027, 2, 9, 23).getTime()), 'before');
  assert.equal(tripPhase(basics, new Date(2027, 2, 10, 1).getTime()), 'during');
  assert.equal(tripPhase(basics, new Date(2027, 2, 13, 23).getTime()), 'during');
  assert.equal(tripPhase(basics, new Date(2027, 2, 14, 0, 30).getTime()), 'after');
  assert.equal(tripPhase({ startDate: null, endDate: null }, 0), null);
});

test('booking times are the clock time where they happen, whatever the time zone', () => {
  const leaves = toWall('2027-03-10', '06:05');
  assert.equal(wallInput(leaves), '2027-03-10T06:05');
  assert.equal(fromWallInput('2027-03-10T06:05'), leaves);
  assert.equal(fromWallInput(''), null);
  assert.equal(wallLabel(leaves), 'Wed 10 Mar, 06:05');
  assert.equal(wallLabel(toWall('2027-03-10', null)), 'Wed 10 Mar');
});

test('each day holds its bookings and plans in time order, and where you sleep', () => {
  const flight = booking({ id: 1, kind: 'flight', title: 'GA874', startAt: toWall('2027-03-10', '06:00'), endAt: toWall('2027-03-10', '15:30') });
  const hotel = booking({ id: 2, kind: 'stay', title: 'Shinjuku hotel', startAt: toWall('2027-03-10', '16:00'), endAt: toWall('2027-03-12', '11:00') });
  const home = booking({ id: 3, kind: 'flight', title: 'GA875', startAt: toWall('2027-03-13', '23:00'), endAt: toWall('2027-03-14', '05:00') });
  const plans = [
    plan({ id: 10, day: '2027-03-11', time: '09:00', title: 'Meiji Shrine', rupiah: 0 }),
    plan({ id: 11, day: '2027-03-11', title: 'Shopping', rupiah: 1_000_000, sortOrder: 1 }),
    plan({ id: 12, day: '2027-03-11', time: '07:30', title: 'Tsukiji breakfast', rupiah: 300_000, sortOrder: 2 }),
    plan({ id: 13, day: '2027-04-01', title: 'Moved away' }),
  ];
  const { days, elsewhere } = itinerary(basics, [flight, hotel, home], plans);
  const read = (day) => day.items.map((item) => (item.type === 'plan' ? item.plan.title : `${item.role} ${item.booking.title}`));
  assert.deepEqual(read(days[0]), ['leave GA874', 'check-in Shinjuku hotel']);
  assert.deepEqual(read(days[1]), ['Tsukiji breakfast', 'Meiji Shrine', 'Shopping']);
  assert.deepEqual(read(days[2]), ['check-out Shinjuku hotel']);
  // Landing after the trip's last day isn't shown in it.
  assert.deepEqual(read(days[3]), ['leave GA875']);
  assert.deepEqual(days.map((day) => day.sleep?.title ?? null), ['Shinjuku hotel', 'Shinjuku hotel', null, null]);
  assert.equal(days[1].planned, 1_300_000);
  assert.deepEqual(elsewhere.map((item) => item.title), ['Moved away']);
});

test('each day has its city, carried on from the day before, and times fall in parts of the day', () => {
  const days = ['2027-03-10', '2027-03-11', '2027-03-12', '2027-03-13'];
  assert.deepEqual(dayCities(days, ['Tokyo', 'Kyoto'], { '2027-03-12': 'Kyoto' }), ['Tokyo', 'Tokyo', 'Kyoto', 'Kyoto']);
  assert.deepEqual(dayCities(days.slice(0, 2), [], {}), ['', '']);
  assert.deepEqual([partOfDay('07:30'), partOfDay('12:00'), partOfDay('16:59'), partOfDay('17:00'), partOfDay(null)], ['morning', 'afternoon', 'afternoon', 'evening', 'any']);
});

test('a day on the calendar puts overlapping things side by side', () => {
  const laid = calendarLanes([
    { id: 'a', start: 9 * 60, end: 10 * 60 },
    { id: 'b', start: 9 * 60 + 30, end: 11 * 60 },
    { id: 'c', start: 10 * 60, end: 10 * 60 + 30 },
    { id: 'd', start: 14 * 60, end: 15 * 60 },
  ]);
  const read = Object.fromEntries(laid.map((item) => [item.id, [item.lane, item.lanes]]));
  assert.deepEqual(read, { a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] });
  assert.equal(clockOf(minutesOf('07:45') + 90), '09:15');
});

test('next up lists what comes from now on, in order', () => {
  const flight = booking({ id: 1, kind: 'flight', title: 'GA874', startAt: toWall('2027-03-10', '06:00'), endAt: toWall('2027-03-10', '15:30') });
  const hotel = booking({ id: 2, kind: 'stay', title: 'Hotel', startAt: toWall('2027-03-10', '16:00'), endAt: toWall('2027-03-12', '11:00') });
  const plans = [plan({ id: 9, day: '2027-03-11', time: '09:00', title: 'Meiji Shrine' }), plan({ id: 10, day: '2027-03-10', title: 'Dinner' })];
  const read = (list) => list.map((item) => (item.type === 'plan' ? item.plan.title : `${item.role} ${item.booking.title}`));
  assert.deepEqual(read(nextUp([flight, hotel], plans, new Date(2027, 1, 1).getTime())), ['Dinner', 'leave GA874', 'arrive GA874', 'check-in Hotel']);
  // On the day, at noon: the morning flight is past; the untimed dinner still to come.
  assert.deepEqual(read(nextUp([flight, hotel], plans, new Date(2027, 2, 10, 12).getTime(), 10)), ['Dinner', 'arrive GA874', 'check-in Hotel', 'Meiji Shrine', 'check-out Hotel']);
});

test('the budget counts bookings, plans and spending money against the target', () => {
  const bookings = [
    booking({ id: 1, kind: 'flight', cost: 9_000_000, rupiah: 9_000_000, paid: 9_000_000 }),
    booking({ id: 2, kind: 'stay', cost: 60_000, costCurrency: 'JPY', rupiah: 6_300_000 }),
    booking({ id: 3, kind: 'ticket', cost: 3_800, costCurrency: 'KRW', rupiah: 0 }),
  ];
  const travellers = [{ id: 1, name: 'A', paying: true, passportExpiry: null }, { id: 2, name: 'B', paying: true, passportExpiry: null }, { id: 3, name: 'Kid', paying: false, passportExpiry: null }];
  const budget = tripBudget(basics, bookings, [plan({ rupiah: 700_000 })], travellers, 30_000_000);
  assert.deepEqual([budget.days, budget.people, budget.payers], [4, 3, 2]);
  assert.equal(budget.byKind.flight, 9_000_000);
  assert.equal(budget.booked, 15_300_000);
  assert.equal(budget.paid, 9_000_000);
  // Rp500k a day for three people over four days.
  assert.equal(budget.spendingMoney, 6_000_000);
  assert.equal(budget.total, 22_000_000);
  assert.equal(budget.left, 8_000_000);
  assert.equal(budget.perPayer, 11_000_000);
  assert.equal(budget.unconverted, 1);
  assert.equal(costText(60_000, 'JPY'), '¥60.000');
  assert.equal(costText(1_250_000, 'IDR'), 'Rp1.250.000');
});

test('a passport is flagged when it runs out within six months of coming home', () => {
  assert.equal(passportState(noon(2, 12), basics), 'expired');
  assert.equal(passportState(noon(7, 1), basics), 'soon');
  assert.equal(passportState(noon(9, 1), basics), 'ok');
  assert.equal(passportState(null, basics), null);
});

test('the calendar file has an event for each dated booking and plan', () => {
  const ics = tripCalendar('Japan, spring', [
    booking({ id: 1, kind: 'flight', title: 'GA874', startAt: toWall('2027-03-10', '06:00'), endAt: toWall('2027-03-10', '15:30'), code: 'XK7P2Q' }),
    booking({ id: 2, kind: 'stay', title: 'Hotel; Shinjuku', startAt: toWall('2027-03-10', '15:00'), endAt: toWall('2027-03-12', '11:00') }),
    booking({ id: 3, kind: 'transport', title: 'JR Pass', startAt: toWall('2027-03-11', null), endAt: toWall('2027-03-13', null) }),
    booking({ id: 4, title: 'No date' }),
  ], [plan({ id: 9, day: '2027-03-11', time: '09:00', title: 'Meiji Shrine', place: 'Shibuya' }), plan({ id: 10, day: '2027-03-11', time: '12:00', endTime: '13:30', title: 'Lunch' })], Date.UTC(2026, 9, 21));
  assert.match(ics, /SUMMARY:Lunch\r\nDTSTART:20270311T120000\r\nDTEND:20270311T133000/);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 6);
  assert.match(ics, /SUMMARY:GA874\r\nDTSTART:20270310T060000\r\nDTEND:20270310T153000/);
  assert.match(ics, /SUMMARY:Check in: Hotel\\; Shinjuku/);
  assert.match(ics, /DTSTART;VALUE=DATE:20270311\r\nDTEND;VALUE=DATE:20270314/);
  assert.match(ics, /DTSTART:20270311T090000\r\nDTEND:20270311T100000\r\nLOCATION:Shibuya/);
  assert.match(ics, /X-WR-CALNAME:Japan\\, spring/);
  assert.ok(ics.split('\r\n').every((line) => line.length <= 75));
});
