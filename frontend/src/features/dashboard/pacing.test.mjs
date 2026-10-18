import assert from 'node:assert/strict';
import { test } from 'node:test';
import { budgetUsedRatio, formatPercent, paceTone, periodPacing } from './pacing.ts';

// Local-time dates, matching how the dashboard reads period boundaries.
const at = (year, month, day, hour = 0) => new Date(year, month - 1, day, hour).getTime();
const october = { startDate: at(2026, 10, 1), endDate: at(2026, 10, 31) };

test('day count is inclusive of both ends and follows the calendar', () => {
  const pacing = periodPacing(october, at(2026, 10, 17, 12));
  assert.deepEqual([pacing.dayIndex, pacing.totalDays, pacing.status], [17, 31, 'active']);
  assert.equal(periodPacing(october, at(2026, 10, 1, 0)).dayIndex, 1);
  assert.equal(periodPacing(october, at(2026, 10, 31, 23)).dayIndex, 31);
  assert.equal(periodPacing({ startDate: at(2026, 2, 1), endDate: at(2026, 2, 28) }, at(2026, 2, 10)).totalDays, 28);
});

test('elapsed time counts to the end of the last day, so the final day is not already complete', () => {
  const midMonth = periodPacing(october, at(2026, 10, 16, 12));
  assert.equal(midMonth.elapsedRatio, 0.5);
  const lastMorning = periodPacing(october, at(2026, 10, 31, 0));
  assert.ok(lastMorning.elapsedRatio < 1 && lastMorning.elapsedRatio > 0.96);
});

test('before the period starts and after it ends the pacing is clamped', () => {
  assert.deepEqual(periodPacing(october, at(2026, 9, 30, 23)), { dayIndex: 0, totalDays: 31, elapsedRatio: 0, status: 'upcoming' });
  assert.deepEqual(periodPacing(october, at(2026, 11, 1, 0)), { dayIndex: 31, totalDays: 31, elapsedRatio: 1, status: 'ended' });
});

test('a period whose end is before its start still counts as one day', () => {
  const pacing = periodPacing({ startDate: at(2026, 10, 5), endDate: at(2026, 10, 1) }, at(2026, 10, 5, 6));
  assert.deepEqual([pacing.dayIndex, pacing.totalDays, pacing.status], [1, 1, 'active']);
});

test('budget share needs a plan to measure against', () => {
  assert.equal(budgetUsedRatio(50, 200), 0.25);
  assert.equal(budgetUsedRatio(300, 200), 1.5);
  assert.equal(budgetUsedRatio(-20, 200), 0);
  assert.equal(budgetUsedRatio(50, 0), null);
});

test('pace tone flags spending that outruns the calendar', () => {
  assert.equal(paceTone(0.4, 0.5), 'ok');
  assert.equal(paceTone(0.58, 0.5), 'ok');
  assert.equal(paceTone(0.65, 0.5), 'warning');
  assert.equal(paceTone(1.01, 0.9), 'danger');
});

test('percentages round and never read as negative', () => {
  assert.equal(formatPercent(0.504), '50%');
  assert.equal(formatPercent(1.5), '150%');
  assert.equal(formatPercent(-0.2), '0%');
});
