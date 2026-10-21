import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cheapestOption,
  emergencyData,
  emergencyTarget,
  gadgetData,
  gadgetTarget,
  houseCosts,
  houseData,
  kprFit,
  kprPayment,
  monthsCovered,
  nextFee,
  plateRenewalDue,
  termDates,
  typeReminders,
  umrahData,
  umrahTotal,
  weddingData,
  weddingTotal,
  yearlyMonthly,
} from './type-math.ts';

const now = new Date(2026, 9, 21, 10).getTime();
const day = (offset) => new Date(2026, 9, 21 + offset, 12).getTime();

test('an emergency fund counts months of spending, and its target follows them', () => {
  assert.deepEqual(emergencyData({}, 30_000_000, 5_000_000), { months: 6, household: 'single' });
  assert.deepEqual(emergencyData({ months: 9, household: 'family' }, 30_000_000, 5_000_000), { months: 9, household: 'family' });
  assert.deepEqual(emergencyData({}, 30_000_000, null), { months: 3, household: 'single' });
  assert.equal(monthsCovered(21_000_000, 5_000_000), 4.2);
  assert.equal(monthsCovered(21_000_000, null), null);
  assert.equal(emergencyTarget(6, 5_123_456), 30_700_000);
});

test('a house has its down payment, buying costs and KPR payment', () => {
  const house = houseData({ price: 1_000_000_000 });
  assert.deepEqual(house, { price: 1_000_000_000, dpShare: 20, years: 15, rate: 8, notary: 1, provisi: 1, appraisal: 0.1, limit: 30 });
  const costs = houseCosts(house);
  assert.equal(costs.downPayment, 200_000_000);
  assert.equal(costs.loan, 800_000_000);
  // 5% of the price above the first Rp80 juta.
  assert.equal(costs.bphtb, 46_000_000);
  assert.equal(costs.upfront, 265_000_000);
  assert.equal(costs.monthly, 7_645_217);
  assert.equal(kprPayment(120_000_000, 0, 10), 1_000_000);
  assert.equal(kprPayment(0, 8, 15), 0);
  assert.deepEqual(kprFit(7_645_217, 20_000_000, 30), { allowed: 6_000_000, share: 38.226085, over: true });
  assert.equal(kprFit(7_645_217, null, 30), null);
});

test('a wedding is catering for its guests and the rest of its parts', () => {
  const wedding = weddingData({ guests: 300, perGuest: 150_000 });
  assert.deepEqual(weddingTotal(wedding, [{ name: 'Venue', amount: 40_000_000 }, { name: 'Catering', amount: 1 }, { name: 'Attire', amount: 15_000_000 }]), { catering: 45_000_000, others: 55_000_000, total: 100_000_000 });
});

test('an umrah is its package and spending money for each person', () => {
  assert.equal(umrahTotal(umrahData({ travellers: 2, packagePrice: 32_000_000, spending: 5_000_000 })), 74_000_000);
  assert.deepEqual(umrahData({}), { travellers: 1, packagePrice: 0, spending: 0 });
});

test('school fees: the next one due, and dates for fees that repeat', () => {
  const parts = [
    { id: 1, name: 'Entry', amount: 15_000_000, dueAt: day(-30), paidAt: day(-31) },
    { id: 2, name: 'Term 2', amount: 9_000_000, dueAt: day(40), paidAt: null },
    { id: 3, name: 'Term 1', amount: 9_000_000, dueAt: day(12), paidAt: null },
  ];
  assert.deepEqual(nextFee(parts, now), { part: parts[2], days: 12 });
  assert.equal(nextFee([], now), null);
  assert.deepEqual(termDates(new Date(2027, 0, 10, 12).getTime(), 6, 3).map((time) => new Date(time).toISOString().slice(0, 7)), ['2027-01', '2027-07', '2028-01']);
});

test('a gadget compares prices, picks one and counts the trade-in', () => {
  const gadget = gadgetData({ options: [{ url: 'a', title: 'A', image: null, price: 21_000_000, firstPrice: 22_000_000, checkedAt: 1 }, { url: 'b', title: 'B', image: null, price: 19_500_000, firstPrice: 19_500_000, checkedAt: 1 }, { nope: true }], pick: 1, tradeIn: 4_000_000 });
  assert.equal(gadget.options.length, 2);
  assert.equal(gadgetTarget(gadget), 15_500_000);
  assert.equal(cheapestOption(gadget.options), 1);
  assert.equal(gadgetData({ pick: 5 }).pick, 0);
});

test('a yearly bill asks a twelfth of last year, or what’s left over the months until it’s due', () => {
  assert.deepEqual(yearlyMonthly(3_000_000, 1_000_000, new Date(2027, 2, 15).getTime(), now), { twelfth: 250_000, toDue: 400_000, months: 5 });
  assert.deepEqual(yearlyMonthly(3_000_000, 0, null, now), { twelfth: 250_000, toDue: null, months: null });
  assert.equal(plateRenewalDue(2027, new Date(2027, 2, 15).getTime()), true);
  assert.equal(plateRenewalDue(2029, new Date(2027, 2, 15).getTime()), false);
});

test('each kind reminds of what it needs', () => {
  const goal = (id, goalType, patch = {}) => ({ id, name: goalType, status: 'active', goalType, typeData: {}, targetAmount: 30_000_000, setAside: 10_000_000, byDate: null, ...patch });
  const reminders = typeReminders([
    goal(1, 'emergency'),
    goal(2, 'house', { typeData: { price: 1_000_000_000 } }),
    goal(3, 'umrah', { byDate: day(50) }),
    goal(4, 'gadget', { typeData: { options: [{ url: 'a', title: 'A', image: null, price: 19_000_000, firstPrice: 21_000_000, checkedAt: 1 }] } }),
    goal(5, 'vehicle-tax', { byDate: day(20), targetAmount: 3_000_000, setAside: 1_000_000 }),
    goal(6, 'lebaran', { byDate: day(90) }),
    goal(7, 'emergency', { status: 'archived' }),
  ], { spending: 5_000_000, salary: 20_000_000, now });
  assert.deepEqual(reminders.map((item) => [item.kind, item.goalId]), [['emergency-low', 1], ['kpr-limit', 2], ['umrah-papers', 3], ['price-drop', 4], ['yearly-due', 5]]);
  assert.equal(reminders[0].months, 2);
  assert.equal(reminders[4].short, 2_000_000);
  // Without spending or salary, those two can't be judged.
  assert.deepEqual(typeReminders([goal(1, 'emergency'), goal(2, 'house', { typeData: { price: 1 } })], { spending: null, salary: null, now }), []);
});
