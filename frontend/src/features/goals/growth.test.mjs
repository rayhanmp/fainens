import assert from 'node:assert/strict';
import { test } from 'node:test';
import { goalGrowth } from './growth.ts';

const at = (year, month, day = 10) => new Date(year, month, day).getTime();
const goal = { setAside: 6_000_000, targetAmount: 10_000_000, monthlyAmount: 2_000_000, expectedReturn: 0, paused: false, byDate: null };

test('what it held after each move, on its day, then a projection that stops at the target', () => {
  const entries = [
    { amount: 5_000_000, createdAt: at(2026, 7) },
    { amount: 2_000_000, createdAt: at(2026, 8) },
    { amount: -1_000_000, createdAt: at(2026, 8, 20) },
  ];
  const points = goalGrowth(entries, goal, at(2026, 9, 21));
  assert.deepEqual(points.filter((point) => point.held !== undefined).map((point) => [point.time, point.held]), [
    [new Date(2026, 7, 1).getTime(), 0],
    [at(2026, 7), 5_000_000],
    [at(2026, 8), 7_000_000],
    [at(2026, 8, 20), 6_000_000],
    [at(2026, 9, 21), 6_000_000],
  ]);
  // Today carries both, so the lines meet.
  assert.deepEqual(points.find((point) => point.projected !== undefined && point.held !== undefined), { time: at(2026, 9, 21), held: 6_000_000, projected: 6_000_000 });
  assert.deepEqual(points.filter((point) => point.held === undefined).map((point) => point.projected), [8_000_000, 10_000_000]);
});

test('a reached goal has no projection, and a paused one stays flat', () => {
  assert.equal(goalGrowth([], { ...goal, setAside: 10_000_000 }, at(2026, 9)).length, 1);
  const paused = goalGrowth([], { ...goal, paused: true }, at(2026, 9));
  assert.equal(paused.length, 13);
  assert.ok(paused.every((point) => point.projected === 6_000_000));
});

test('what it earns is counted, and the projection reaches past the needed-by date', () => {
  const growing = goalGrowth([], { ...goal, monthlyAmount: 0, expectedReturn: 12, byDate: at(2028, 9) }, at(2026, 9));
  assert.ok(growing.at(-1).projected > 6_000_000);
  assert.equal(growing.length, 1 + 27);
});
