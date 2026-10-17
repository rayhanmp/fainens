import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adjacentPeriodId, relativeDay, swipeStep } from './navigation.ts';

const periods = [{ id: 30 }, { id: 20 }, { id: 10 }];

test('stepping moves through newest-first periods and stops at the ends', () => {
  assert.equal(adjacentPeriodId(periods, '20', 'older'), '10');
  assert.equal(adjacentPeriodId(periods, '20', 'newer'), '30');
  assert.equal(adjacentPeriodId(periods, '30', 'newer'), null);
  assert.equal(adjacentPeriodId(periods, '10', 'older'), null);
  assert.equal(adjacentPeriodId(periods, '99', 'older'), null);
});

test('only a clear horizontal swipe changes period', () => {
  assert.equal(swipeStep(-80, 10), 'newer');
  assert.equal(swipeStep(80, -10), 'older');
  assert.equal(swipeStep(30, 0), null);
  assert.equal(swipeStep(-80, 70), null);
});

test('relative day labels follow local calendar days', () => {
  const now = new Date(2026, 9, 17, 0, 30).getTime();
  assert.equal(relativeDay(new Date(2026, 9, 17, 0, 5).getTime(), now), 'Today');
  assert.equal(relativeDay(new Date(2026, 9, 16, 23, 59).getTime(), now), 'Yesterday');
  assert.equal(relativeDay(new Date(2026, 9, 15, 12).getTime(), now), null);
  assert.equal(relativeDay(new Date(2026, 9, 18, 9).getTime(), now), null);
});
