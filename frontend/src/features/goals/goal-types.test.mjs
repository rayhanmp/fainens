import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GOAL_TYPE_KEYS, GOAL_TYPES, goalHeadline } from './goal-types.ts';

const now = new Date(2026, 9, 21, 10).getTime();
const amount = (value) => `Rp${value}`;
const goal = (goalType, patch = {}) => ({ goalType, typeData: {}, targetAmount: 30_000_000, setAside: 21_000_000, byDate: null, ...patch });

test('every type has a name, an emoji, notes to start from and a kind', () => {
  for (const key of GOAL_TYPE_KEYS) {
    const info = GOAL_TYPES[key];
    assert.equal(info.key, key);
    assert.ok(info.label && info.icon && info.notes.length > 20);
    assert.ok(info.kind === 'spend' || info.kind === 'keep');
  }
  assert.deepEqual(GOAL_TYPE_KEYS.filter((key) => GOAL_TYPES[key].yearly), ['vehicle-tax', 'insurance', 'lebaran']);
});

test('each type leads with its own figure', () => {
  const context = { now, amount, spending: 5_000_000 };
  assert.equal(goalHeadline(goal('emergency'), context), '4,2 of 6 months of spending');
  assert.equal(goalHeadline(goal('emergency', { typeData: { months: 8 } }), context), '4,2 of 8 months of spending');
  // Past its target it says so, rather than "4,8 of 3,6".
  assert.equal(goalHeadline(goal('emergency', { setAside: 24_000_000, targetAmount: 18_000_000 }), context), '4,8 months of spending covered, past its 3,6-month target');
  assert.equal(goalHeadline(goal('emergency', { setAside: 30_000_000 }), context), 'All 6 months of spending covered');
  // Your own month's spending counts instead of the average.
  assert.equal(goalHeadline(goal('emergency', { typeData: { burn: 3_000_000, months: 8 } }), context), '7 of 8 months of spending');
  assert.equal(goalHeadline(goal('emergency'), { now, amount }), null);
  assert.equal(goalHeadline(goal('trip', { byDate: new Date(2027, 2, 13, 12).getTime() }), context), '143 days to go');
  assert.equal(goalHeadline(goal('trip', { typeData: { startDate: new Date(2026, 9, 22).getTime() } }), context), 'Tomorrow');
  assert.equal(goalHeadline(goal('trip', { typeData: { startDate: new Date(2026, 9, 18).getTime(), endDate: new Date(2026, 9, 25).getTime() } }), context), 'On the trip');
  assert.equal(goalHeadline(goal('house', { typeData: { price: 850_000_000 } }), context), 'Down payment for a Rp850000000 house');
  assert.equal(goalHeadline(goal('wedding', { typeData: { guests: 300 } }), context), 'Rp100000 a guest for 300 guests');
  assert.equal(goalHeadline(goal('umrah', { typeData: { travellers: 2 }, byDate: new Date(2027, 2, 31).getTime() }), context), 'For 2 people · leaving Mar 2027');
  assert.equal(goalHeadline(goal('education'), { ...context, parts: [
    { name: 'Entry', amount: 9, dueAt: new Date(2026, 8, 1).getTime(), paidAt: 1 },
    { name: 'Term 2', amount: 12_000_000, dueAt: new Date(2027, 0, 20).getTime(), paidAt: null },
    { name: 'Term 1', amount: 10_000_000, dueAt: new Date(2026, 10, 1).getTime(), paidAt: null },
  ] }), 'Next fee in 11 days: Rp10000000');
  assert.equal(goalHeadline(goal('gadget', { typeData: { firstPrice: 20_000_000, linkPrice: 18_800_000 } }), context), 'Rp1200000 cheaper than when you added it');
  assert.equal(goalHeadline(goal('vehicle-tax', { byDate: new Date(2026, 11, 14).getTime(), typeData: { lastYear: 2_100_000 } }), context), 'Due in 54 days · last year Rp2100000');
  assert.equal(goalHeadline(goal(null), context), null);
});
