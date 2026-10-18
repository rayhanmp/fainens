import assert from 'node:assert/strict';
import { test } from 'node:test';
import { monthTicks, paydayMarkers } from './net-worth-trend.ts';

const DAY = 24 * 60 * 60 * 1000;
const at = (year, month, day) => new Date(year, month, day, 23, 59).getTime();
const weekly = (from, weeks) => Array.from({ length: weeks }, (_, index) => {
  const asOfMs = from + index * 7 * DAY;
  return { label: `p${index}`, asOfMs };
});

test('month ticks mark the first point of each month and name the year in January', () => {
  const rows = weekly(at(2026, 10, 15), 17); // mid-November 2026 into early March 2027
  const ticks = monthTicks(rows);
  assert.deepEqual(ticks.map((tick) => tick.text), ["Nov '26", 'Dec', "Jan '27", 'Feb', 'Mar']);
  assert.equal(ticks[0].label, 'p0');
  assert.deepEqual(monthTicks([]), []);
});

test('month ticks within one year carry no year', () => {
  const ticks = monthTicks(weekly(at(2026, 7, 2), 10));
  assert.deepEqual(ticks.map((tick) => tick.text), ['Aug', 'Sep', 'Oct']);
});

test('payday markers land on the first point at or after each period start inside the series', () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({ label: `d${index}`, asOfMs: at(2026, 8, 19 + index) }));
  const periods = [
    { name: 'October', startDate: new Date(2026, 8, 25).getTime() },
    { name: 'September', startDate: new Date(2026, 7, 25).getTime() }, // before the series
    { name: 'November', startDate: new Date(2026, 9, 25).getTime() }, // after the series
  ];
  assert.deepEqual(paydayMarkers(rows, periods), [{ label: 'd6', name: 'October' }]);
});

test('payday markers skip the series start and collapse two paydays on one point', () => {
  const rows = weekly(at(2026, 0, 4), 4);
  const periods = [
    { name: 'Jan', startDate: at(2026, 0, 4) }, // the series start itself
    { name: 'A', startDate: new Date(2026, 0, 6).getTime() },
    { name: 'B', startDate: new Date(2026, 0, 8).getTime() }, // same weekly point as A
  ];
  assert.deepEqual(paydayMarkers(rows, periods), [{ label: 'p1', name: 'A' }]);
  assert.deepEqual(paydayMarkers(rows.slice(0, 1), periods), []);
});
