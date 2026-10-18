import assert from 'node:assert/strict';
import { test } from 'node:test';
import { budgetLineCopy, budgetLineStatus, compareByUrgency } from './budget-line.ts';

const rupiah = (amount) => `Rp${Math.round(amount).toLocaleString('id-ID')}`;
// Day 19 of a 31-day period, about 60% of the time gone.
const midPeriod = { dayIndex: 19, totalDays: 31, elapsedRatio: 0.6, status: 'active' };

test('spending past the plan is over, with the plan mark pulled back to show the spill', () => {
  const status = budgetLineStatus({ actualAmount: 563_125, plannedAmount: 235_000 }, midPeriod);
  assert.equal(status.group, 'over');
  assert.equal(status.tone, 'danger');
  assert.equal(status.label, 'Over');
  assert.ok(Math.abs(status.planMark - 235_000 / 563_125) < 1e-9);
  assert.equal(status.perDay, null);
  assert.deepEqual(budgetLineCopy(status, rupiah), { value: 'Rp328.125 over', detail: 'Past the plan' });
});

test('a category well inside the plan reads as on track with a daily allowance', () => {
  const status = budgetLineStatus({ actualAmount: 273_829, plannedAmount: 540_000 }, midPeriod);
  assert.equal(status.group, 'onTrack');
  assert.equal(status.label, null);
  assert.equal(status.planMark, 1);
  assert.equal(status.paceMark, 0.6);
  assert.equal(status.daysLeft, 13);
  assert.deepEqual(budgetLineCopy(status, rupiah), { value: 'Rp266.171 left', detail: 'Rp20.474 a day for 13 days' });
});

test('near the limit and ahead of the calendar both land in the watch group', () => {
  const near = budgetLineStatus({ actualAmount: 273_576, plannedAmount: 275_000 }, midPeriod);
  assert.equal(near.group, 'watch');
  assert.equal(near.label, 'Near limit');
  const ahead = budgetLineStatus({ actualAmount: 72_000, plannedAmount: 100_000 }, { ...midPeriod, elapsedRatio: 0.3 });
  assert.equal(ahead.group, 'watch');
  assert.equal(ahead.label, 'Ahead of pace');
  assert.equal(ahead.tone, 'warning');
});

test('a fully used plan is still not over', () => {
  const status = budgetLineStatus({ actualAmount: 160_000, plannedAmount: 160_000 }, midPeriod);
  assert.equal(status.group, 'watch');
  assert.equal(status.label, 'Near limit');
  assert.deepEqual(budgetLineCopy(status, rupiah), { value: 'Rp0 left', detail: 'Plan fully used' });
});

test('untracked or ended periods carry no pace mark or daily figure', () => {
  const untracked = budgetLineStatus({ actualAmount: 0, plannedAmount: 100_000 }, null);
  assert.equal(untracked.group, 'notStarted');
  assert.equal(untracked.paceMark, null);
  assert.deepEqual(budgetLineCopy(untracked, rupiah), { value: 'Rp100.000 left', detail: 'Left in the plan' });
  const ended = budgetLineStatus({ actualAmount: 50_000, plannedAmount: 100_000 }, { ...midPeriod, status: 'ended', elapsedRatio: 1 });
  assert.equal(ended.paceMark, null);
  assert.equal(ended.daysLeft, 0);
});

test('urgency order puts over first, then watch, on track and untouched, most used first inside a group', () => {
  const rows = [
    { name: 'idle', actualAmount: 0, plannedAmount: 100 },
    { name: 'fine', actualAmount: 30, plannedAmount: 100 },
    { name: 'over', actualAmount: 150, plannedAmount: 100 },
    { name: 'finer', actualAmount: 40, plannedAmount: 100 },
    { name: 'near', actualAmount: 90, plannedAmount: 100 },
  ].map((row) => ({ ...row, status: budgetLineStatus(row, midPeriod) }));
  rows.sort((a, b) => compareByUrgency(a.status, b.status));
  assert.deepEqual(rows.map((row) => row.name), ['over', 'near', 'finer', 'fine', 'idle']);
});
