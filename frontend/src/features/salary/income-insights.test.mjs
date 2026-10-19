import assert from 'node:assert/strict';
import { test } from 'node:test';
import { incomeKind, monthlyIncomeSeries, payCycle, takeHomeBreakdown } from './income-insights.ts';

const at = (year, month, day) => new Date(year, month - 1, day, 10).getTime();

test('salary credits are recognised by name, in English or Indonesian', () => {
  assert.equal(incomeKind('Salary income - September 2026'), 'salary');
  assert.equal(incomeKind('Gaji Oktober'), 'salary');
  assert.equal(incomeKind('Freelance On-Frontier (Model Evaluation)'), 'other');
  assert.equal(incomeKind('Refund on Donation'), 'other');
});

test('the monthly series covers the last six months, oldest first, split by kind', () => {
  const rows = [
    { id: 1, date: at(2026, 9, 25), description: 'Salary income - September 2026', incomeCents: 7_554_552 },
    { id: 2, date: at(2026, 9, 16), description: 'Freelance', incomeCents: 2_633_753 },
    { id: 3, date: at(2026, 3, 1), description: 'Too old', incomeCents: 1 },
    { id: 4, date: at(2026, 8, 25), description: 'Gaji Agustus', incomeCents: 7_554_552 },
  ];
  const series = monthlyIncomeSeries(rows, at(2026, 10, 19));
  assert.deepEqual(series.map((month) => month.key), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.deepEqual(series[4], { key: '2026-09', label: 'Sep', salary: 7_554_552, other: 2_633_753, total: 10_188_305 });
  assert.equal(series[3].salary, 7_554_552);
  assert.equal(series[5].total, 0);
});

test('the pay cycle runs from the last payday to the next, counting days left', () => {
  const cycle = payCycle(25, at(2026, 10, 19));
  assert.equal(new Date(cycle.lastPayday).getDate(), 25);
  assert.equal(new Date(cycle.lastPayday).getMonth(), 8);
  assert.equal(new Date(cycle.nextPayday).getMonth(), 9);
  assert.equal(cycle.daysLeft, 6);
  assert.equal(cycle.isPayday, false);
  assert.ok(cycle.progress > 0.75 && cycle.progress < 0.85);
});

test('payday itself reads as day zero and a full cycle, and short months pull the day in', () => {
  const today = payCycle(25, at(2026, 10, 25));
  assert.equal(today.daysLeft, 0);
  assert.equal(today.isPayday, true);
  assert.equal(today.progress, 1);
  const feb = payCycle(31, at(2026, 2, 10));
  assert.equal(new Date(feb.nextPayday).getDate(), 28);
  assert.equal(new Date(feb.lastPayday).getDate(), 31);
});

test('take-home breakdown lists only the deductions that apply, as shares of gross', () => {
  const segments = takeHomeBreakdown({ grossMonthly: 8_000_000, estimatedNetMonthly: 7_554_552, pph21Monthly: 125_448, jhtMonthly: 160_000, jpMonthly: 80_000, bpjsKesehatanMonthly: 0 });
  assert.deepEqual(segments.map((segment) => segment.key), ['net', 'pph21', 'jht', 'jp']);
  assert.ok(Math.abs(segments[0].share - 0.944319) < 1e-6);
  assert.ok(Math.abs(segments.reduce((sum, segment) => sum + segment.share, 0) - 0.9894) < 1e-3);
});
