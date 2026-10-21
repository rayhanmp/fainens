import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_PLAN, DEFAULT_POT, compactRupiah, durationLabel, eventsInMonth, goalOutlooks, monthlyNeeded, normalizePlan, planRange, potGoals, recentSaving, runPlan, runPot, savingInMonth, setAside, unallocated, withOwnPot } from './plan.ts';

const pot = (overrides = {}) => ({ ...DEFAULT_POT, returnRate: 0, ...overrides });
const plan = (overrides = {}, potOverrides = {}) => ({ ...DEFAULT_PLAN, inflation: 0, pots: [pot(potOverrides)], ...overrides });
const last = (run) => run.months[run.months.length - 1];
const goal = (overrides) => ({ id: 'g', name: 'Goal', amount: 1, byMonth: null, potId: DEFAULT_POT.id, spend: false, saved: 0, ...overrides });

test('without returns or inflation the balance is what went in', () => {
  const run = runPlan(plan({ years: 2 }, { start: 1_000_000, monthly: 500_000 }));
  assert.equal(run.months.length, 25);
  assert.equal(last(run).balance, 13_000_000);
  assert.equal(last(run).deposits, 13_000_000);
});

test('a yearly return compounds to that return over twelve months', () => {
  const run = runPlan(plan({ years: 1 }, { start: 100_000_000, returnRate: 6 }));
  assert.ok(Math.abs(last(run).balance - 106_000_000) < 1);
});

test('the balance matches the closed-form future value', () => {
  // FV = P(1+i)^n + C((1+i)^n − 1)/i with i the monthly rate equivalent to the yearly one.
  for (const [start, monthly, yearly, years] of [[10_000_000, 1_000_000, 6, 10], [0, 2_500_000, 9, 25], [50_000_000, 0, 4.5, 3]]) {
    const i = (1 + yearly / 100) ** (1 / 12) - 1;
    const n = years * 12;
    const expected = start * (1 + i) ** n + monthly * (((1 + i) ** n - 1) / i);
    const actual = last(runPlan(plan({ years }, { start, monthly, returnRate: yearly }))).balance;
    assert.ok(Math.abs(actual - expected) / expected < 1e-9, `${actual} vs ${expected}`);
  }
});

test('pots grow at their own rates and add up', () => {
  const inputs = { ...DEFAULT_PLAN, inflation: 0, years: 5, pots: [pot({ id: 'cash', start: 10_000_000, returnRate: 2.5 }), pot({ id: 'sbn', start: 10_000_000, returnRate: 6.3 })] };
  const run = runPlan(inputs);
  const [cash, sbn] = run.pots.map((part) => last(part).balance);
  assert.ok(Math.abs(cash - 10_000_000 * 1.025 ** 5) < 1);
  assert.ok(Math.abs(sbn - 10_000_000 * 1.063 ** 5) < 1);
  assert.ok(Math.abs(last(run).balance - (cash + sbn)) < 1e-6);
});

test('in today’s money each deposit is deflated at its own month', () => {
  const run = runPlan(plan({ inflation: 10, years: 2 }, { start: 1_000_000, monthly: 1_000_000 }));
  let expected = 1_000_000;
  for (let month = 1; month <= 24; month++) expected += 1_000_000 / 1.1 ** (month / 12);
  assert.ok(Math.abs(last(run).realNetDeposits - expected) < 1e-6);
  assert.ok(last(run).realNetDeposits > last(run).deposits / last(run).deflator);
  assert.ok(last(run).balance / last(run).deflator <= last(run).realNetDeposits);
});

test('the monthly saving rises once a year', () => {
  const inputs = pot({ monthly: 1_000_000, raise: 10 });
  assert.equal(savingInMonth(inputs, 12), 1_000_000);
  assert.ok(Math.abs(savingInMonth(inputs, 13) - 1_100_000) < 1e-6);
  assert.ok(Math.abs(savingInMonth(inputs, 25) - 1_210_000) < 1e-6);
});

test('yearly events repeat every twelve months from their first month', () => {
  const events = [{ id: 'thr', label: 'THR', month: 4, amount: 5, yearly: true, potId: 'main' }, { id: 'car', label: 'Car', month: 16, amount: -3, yearly: false, potId: 'main' }];
  assert.deepEqual([3, 4, 5, 16, 28].map((month) => eventsInMonth(events, month)), [0, 5, 0, 2, 5]);
});

test('a withdrawal takes no more than the pot holds and marks when it ran out', () => {
  const run = runPlan(plan({ years: 1, events: [{ id: 'w', label: 'Trip', month: 3, amount: -5_000_000, yearly: false, potId: 'main' }] }, { start: 1_000_000 }));
  assert.equal(run.months[3].balance, 0);
  assert.equal(run.months[3].withdrawals, 1_000_000);
  assert.equal(run.emptiedAt, 3);
});

test('kept goals compare against the pot in today’s money', () => {
  const inputs = plan({ goals: [goal({ id: 'a', amount: 12_000_000 })] }, { monthly: 1_000_000 });
  assert.equal(goalOutlooks(inputs, null)[0].reach, 12);
  assert.ok(goalOutlooks({ ...inputs, inflation: 5 }, null)[0].reach > 12);
  assert.equal(goalOutlooks(plan({ goals: [goal({ amount: 10 })] }, { start: 5 }), null)[0].reach, null);
  assert.equal(goalOutlooks(plan({ goals: [goal({ amount: 10 })] }, { start: 50 }), null)[0].reach, 0);
});

test('spent goals leave the pot, so two goals never count the same money', () => {
  // Rp1 juta a month: a 12 juta laptop is bought at month 12, and a 12 juta trip has to save again from zero.
  const goals = [goal({ id: 'laptop', amount: 12_000_000, spend: true }), goal({ id: 'trip', amount: 12_000_000, spend: true })];
  const run = runPot(plan({ goals }), pot({ monthly: 1_000_000 }), 30);
  assert.equal(run.reached.laptop, 12);
  assert.equal(run.reached.trip, 24);
  assert.equal(run.months[12].balance, 0);
  assert.equal(run.months[30].withdrawals, 24_000_000);
  // A kept goal stays in the pot but is held back: the next goal saves on top of it.
  const kept = runPot(plan({ goals: goals.map((item) => ({ ...item, spend: false })) }), pot({ monthly: 1_000_000 }), 30);
  assert.deepEqual([kept.reached.laptop, kept.reached.trip], [12, 24]);
  assert.equal(kept.months[24].balance, 24_000_000);
  const fundThenLaptop = runPot(plan({ goals: [goal({ id: 'fund', amount: 6_000_000 }), goal({ id: 'laptop', amount: 6_000_000, spend: true })] }), pot({ monthly: 1_000_000 }), 12);
  assert.deepEqual([fundThenLaptop.reached.fund, fundThenLaptop.reached.laptop], [6, 12]);
  assert.equal(fundThenLaptop.months[12].balance, 6_000_000);
});

test('a pot pays dated goals by date and no earlier, then the rest', () => {
  const goals = [goal({ id: 'whenever', amount: 1_000_000, spend: true }), goal({ id: 'house', amount: 5_000_000, byMonth: 6, spend: true })];
  const inputs = plan({ goals });
  assert.deepEqual(potGoals(inputs, 'main').map((item) => item.id), ['house', 'whenever']);
  const run = runPot(inputs, pot({ start: 10_000_000 }), 12);
  assert.equal(run.reached.house, 6);
  assert.equal(run.reached.whenever, 6);
  assert.equal(run.months[5].balance, 10_000_000);
  assert.equal(run.months[6].balance, 4_000_000);
});

test('goals in different pots don’t share money', () => {
  const inputs = { ...DEFAULT_PLAN, inflation: 0, pots: [pot({ id: 'a', start: 10_000_000 }), pot({ id: 'b', start: 0 })], goals: [goal({ id: 'x', amount: 5_000_000, potId: 'b' })] };
  assert.equal(goalOutlooks(inputs, null)[0].reach, null);
});

test('the monthly saving needed reaches the goal by its date, with the pot’s earlier goals paid', () => {
  const inputs = plan({ inflation: 3, goals: [goal({ id: 'first', amount: 10_000_000, byMonth: 12, spend: true }), goal({ id: 'house', amount: 50_000_000, byMonth: 36 })] }, { start: 2_000_000, returnRate: 5 });
  const target = inputs.goals[1];
  const needed = monthlyNeeded(inputs, target);
  assert.equal(needed % 1_000, 0);
  const reachedBy = (monthly) => (runPot(inputs, { ...inputs.pots[0], monthly }, 36).reached.house ?? Infinity) <= 36;
  assert.ok(reachedBy(needed));
  assert.ok(!reachedBy(needed - 2_000));
  assert.equal(monthlyNeeded(plan({ goals: [goal({ amount: 50, byMonth: 12 })] }, { start: 60 }), goal({ amount: 50, byMonth: 12 })), 0);
});

test('money set aside today belongs to its goal; the rest is unallocated', () => {
  // 45 juta today: 24 juta set aside for the emergency fund, the laptop saves from the other 21.
  const goals = [goal({ id: 'fund', amount: 30_000_000, saved: 24_000_000 }), goal({ id: 'laptop', amount: 21_000_000, spend: true })];
  const inputs = plan({ goals }, { start: 45_000_000, monthly: 1_000_000 });
  assert.deepEqual(setAside(inputs, inputs.pots[0]), { fund: 24_000_000, laptop: 0 });
  assert.equal(unallocated(inputs, inputs.pots[0]), 21_000_000);
  const run = runPot(inputs, inputs.pots[0], 24);
  // The fund comes first: its 24 juta plus 6 juta of the unallocated money reach it now.
  assert.equal(run.reached.fund, 0);
  // The laptop gets the other 15 juta and saves the last 6 at 1 juta a month, then leaves the pot.
  assert.equal(run.reached.laptop, 6);
  assert.equal(run.months[6].balance, 30_000_000);
  // Without anything set aside the pot's order is the same, but nothing is held for the fund until it's reached.
  const loose = plan({ goals: goals.map((item) => ({ ...item, saved: 0 })) }, { start: 45_000_000, monthly: 1_000_000 });
  assert.equal(runPot(loose, loose.pots[0], 24).reached.fund, 0);
});

test('a goal its own money covers is reached at once, whatever its place in line', () => {
  const goals = [goal({ id: 'house', amount: 100_000_000, byMonth: 12 }), goal({ id: 'phone', amount: 5_000_000, saved: 5_000_000 })];
  const run = runPot(plan({ goals }), pot({ start: 5_000_000 }), 12);
  assert.equal(run.reached.phone, 0);
  // Other goals can't count the phone's money.
  assert.equal(run.reached.house, undefined);
  // A pot can't set aside more than it holds: later goals get what's left.
  const over = plan({ goals: [goal({ id: 'a', saved: 8 }), goal({ id: 'b', saved: 8 })] }, { start: 10 });
  assert.deepEqual(setAside(over, over.pots[0]), { a: 8, b: 2 });
});

test('a goal can get a pot of its own that saves exactly what it needs', () => {
  const inputs = plan({ goals: [goal({ id: 'fund', amount: 5_000_000 })] }, { start: 5_000_000, monthly: 1_000_000 });
  const car = goal({ id: 'car', name: 'Car', amount: 60_000_000, byMonth: 24, spend: true });
  const next = withOwnPot(inputs, car, 'car-pot');
  assert.equal(next.pots.length, 2);
  assert.deepEqual({ name: next.pots[1].name, start: next.pots[1].start }, { name: 'Car', start: 0 });
  assert.equal(next.goals.find((item) => item.id === 'car').potId, 'car-pot');
  // Its monthly saving reaches the car by month 24 and a little less would not; the first pot is untouched.
  const reachWith = (monthly) => goalOutlooks({ ...next, pots: [next.pots[0], { ...next.pots[1], monthly }] }, null).find((item) => item.goal.id === 'car').reach;
  assert.ok(next.pots[1].monthly < 2_500_000, 'the new pot earns the default return');
  assert.ok(reachWith(next.pots[1].monthly) <= 24);
  assert.ok(reachWith(next.pots[1].monthly - 2_000) > 24);
  assert.deepEqual(next.pots[0], inputs.pots[0]);
  // Moving an existing goal keeps one copy of it; an undated goal's pot saves nothing until you fill it.
  const moved = withOwnPot(inputs, { ...inputs.goals[0], byMonth: null }, 'fund-pot');
  assert.equal(moved.goals.length, 1);
  assert.equal(moved.pots[1].monthly, 0);
  // What's set aside moves with it, so the plan's money today stays the same.
  const funded = withOwnPot(inputs, { ...inputs.goals[0], saved: 3_000_000 }, 'fund-pot', inputs.pots[0].id);
  assert.deepEqual([funded.pots[0].start, funded.pots[1].start], [2_000_000, 3_000_000]);
  // It can't take more than the old pot has unallocated.
  const greedy = withOwnPot(inputs, { ...inputs.goals[0], saved: 9_000_000 }, 'fund-pot', inputs.pots[0].id);
  assert.deepEqual([greedy.pots[0].start, greedy.pots[1].start], [0, 5_000_000]);
});

test('the range is the same every time, brackets the plan and gives goal chances', () => {
  const inputs = plan({ inflation: 0, goals: [goal({ id: 'g', amount: 120_000_000, byMonth: 120 })] }, { start: 10_000_000, monthly: 1_000_000, returnRate: 7, uncertainty: 'medium' });
  const first = planRange(inputs, 300);
  assert.deepEqual(first, planRange(inputs, 300));
  const middle = last(runPlan(inputs)).balance;
  assert.ok(first.low[120] < middle && middle < first.high[120]);
  assert.ok(first.chances.g > 0 && first.chances.g <= 1);
  assert.equal(planRange({ ...inputs, pots: [{ ...inputs.pots[0], uncertainty: 'off' }] }), null);
});

test('the uncertainty band matches the lognormal percentiles it models', () => {
  // A lump sum with no deposits: ln(B/B0) is normal with mean n(ln(1+i) − σ²/2) and variance nσ², σ monthly.
  const inputs = plan({ years: 20 }, { start: 100_000_000, returnRate: 7, uncertainty: 'high' });
  const range = planRange(inputs, 4000);
  const n = 240;
  const sigma = 0.18 / Math.sqrt(12);
  const mean = n * (Math.log(1.07 ** (1 / 12)) - sigma ** 2 / 2);
  const spread = sigma * Math.sqrt(n);
  assert.ok(Math.abs(range.low[n] / (100_000_000 * Math.exp(mean - 1.2816 * spread)) - 1) < 0.06);
  assert.ok(Math.abs(range.high[n] / (100_000_000 * Math.exp(mean + 1.2816 * spread)) - 1) < 0.06);
});

test('stored plans are cleaned up, and a plan from before pots becomes one pot', () => {
  const legacy = normalizePlan({ start: -5, monthly: 2_000_000, returnRate: 6, years: 99, uncertainty: 'wild', events: [{ month: 0, amount: 1 }, { id: 'a', month: 2, amount: 3, yearly: true }], goals: [{ name: ' ', amount: 1 }, { id: 'h', name: 'Home', amount: 10, byMonth: 9999 }] });
  assert.equal(legacy.pots.length, 1);
  assert.deepEqual({ start: legacy.pots[0].start, monthly: legacy.pots[0].monthly, returnRate: legacy.pots[0].returnRate, uncertainty: legacy.pots[0].uncertainty }, { start: 0, monthly: 2_000_000, returnRate: 6, uncertainty: 'off' });
  assert.equal(legacy.years, 50);
  assert.deepEqual(legacy.events, [{ id: 'a', label: '', month: 2, amount: 3, yearly: true, potId: legacy.pots[0].id }]);
  assert.deepEqual(legacy.goals, [{ id: 'h', name: 'Home', amount: 10, byMonth: null, potId: legacy.pots[0].id, spend: false, saved: 0 }]);
  const current = normalizePlan({ pots: [{ id: 'x', name: 'SBN' }], goals: [{ id: 'g', name: 'Car', amount: 5, potId: 'gone', spend: true }] });
  assert.equal(current.goals[0].potId, 'x');
  assert.equal(current.goals[0].spend, true);
  assert.equal(normalizePlan({ pots: [] }).pots.length, 1);
});

test('recent saving averages finished periods only', () => {
  const now = 1_000;
  const periods = [
    { periodName: 'Jan', startDate: 0, endDate: 100, income: 10, expenses: 6, net: 4 },
    { periodName: 'Feb', startDate: 101, endDate: 200, income: 10, expenses: 8, net: 2 },
    { periodName: 'Now', startDate: 900, endDate: 2_000, income: 1, expenses: 9, net: -8 },
  ];
  assert.deepEqual(recentSaving(periods, now), { average: 3, averageSpending: 7, periods: [{ name: 'Jan', net: 4 }, { name: 'Feb', net: 2 }] });
  assert.equal(recentSaving([], now), null);
});

test('labels', () => {
  assert.equal(durationLabel(0), 'Now');
  assert.equal(durationLabel(27), '2 yrs 3 mo');
  assert.equal(durationLabel(8), '8 mo');
  assert.equal(compactRupiah(1_250_000_000), 'Rp1,25 M');
  assert.equal(compactRupiah(450_000_000), 'Rp450 jt');
  assert.equal(compactRupiah(1_200_000), 'Rp1,2 jt');
});
