import assert from 'node:assert/strict';
import { test } from 'node:test';
import { incomeKind, monthlyIncomeSeries, otherIncomeByTreatment, payCycle, progressivePPh, takeHomeBreakdown, taxOutlook, withRollingAverage, yearToDateCurve } from './income-insights.ts';

test('progressive PPh fills the brackets in order and reports each slice', () => {
  assert.deepEqual(progressivePPh(0), { tax: 0, slices: [] });
  assert.equal(progressivePPh(60_000_000).tax, 3_000_000);
  const { tax, slices } = progressivePPh(100_000_000);
  assert.equal(tax, 3_000_000 + 6_000_000);
  assert.deepEqual(slices.map((slice) => [slice.rate, slice.amount]), [[0.05, 60_000_000], [0.15, 40_000_000]]);
});

test('other income raises the annual bill beyond what the employer withheld', () => {
  const base = { wageMonths: 11, monthlyBruto: 8_363_200, monthlyPension: 240_000, monthlyWithheld: 125_448, ptkpAnnual: 54_000_000 };
  const wageOnly = taxOutlook({ ...base, otherIncome: 0, otherTaxableShare: 1 });
  assert.equal(wageOnly.wageBruto, 91_995_200);
  assert.equal(wageOnly.biayaJabatan, 4_599_760);
  assert.equal(wageOnly.pkp, Math.floor((91_995_200 - 4_599_760 - 2_640_000 - 54_000_000) / 1000) * 1000);
  assert.equal(wageOnly.withheld, 125_448 * 11);
  const withSide = taxOutlook({ ...base, otherIncome: 40_000_000, otherTaxableShare: 1 });
  assert.equal(withSide.pkp, wageOnly.pkp + 40_000_000);
  assert.ok(withSide.balance > wageOnly.balance);
  const norma = taxOutlook({ ...base, otherIncome: 40_000_000, otherTaxableShare: 0.5 });
  assert.equal(norma.otherTaxable, 20_000_000);
  assert.ok(norma.annualTax < withSide.annualTax);
});

test('the year-to-date curve accumulates actuals up to this month against a salary-only line', () => {
  const series = [
    { key: '2026-01', label: 'Jan', salary: 100, other: 0, total: 100 },
    { key: '2026-02', label: 'Feb', salary: 100, other: 50, total: 150 },
    { key: '2025-12', label: 'Dec', salary: 999, other: 0, total: 999 },
  ];
  const curve = yearToDateCurve(series, new Date(2026, 2, 10).getTime(), 100);
  assert.equal(curve.length, 12);
  assert.deepEqual(curve.slice(0, 4).map((point) => point.actual), [100, 250, 250, null]);
  assert.deepEqual(curve.slice(0, 3).map((point) => point.expected), [100, 200, 300]);
  assert.equal(curve[11].expected, 1200);
});

test('both lines start at the first salary month, so a job begun in February is not measured from January', () => {
  const series = [
    { key: '2026-01', label: 'Jan', salary: 0, other: 30, total: 30 },
    { key: '2026-02', label: 'Feb', salary: 100, other: 0, total: 100 },
    { key: '2026-03', label: 'Mar', salary: 100, other: 20, total: 120 },
  ];
  const curve = yearToDateCurve(series, new Date(2026, 2, 10).getTime(), 100);
  assert.deepEqual(curve[0], { label: 'Jan', actual: null, expected: null });
  assert.deepEqual(curve.slice(1, 4).map((point) => point.actual), [100, 220, null]);
  assert.deepEqual(curve.slice(1, 4).map((point) => point.expected), [100, 200, 300]);
  assert.equal(curve[11].expected, 1100);
});

test('the rolling average trails three months and waits for a second month', () => {
  const series = [100, 200, 300, 400].map((total, index) => ({ key: String(index), label: '', salary: total, other: 0, total }));
  assert.deepEqual(withRollingAverage(series).map((month) => month.rolling), [null, 150, 200, 300]);
});

const at = (year, month, day) => new Date(year, month - 1, day, 10).getTime();

test('salary is what the profile posted, or a hand-entered credit named as salary without a side-income marker', () => {
  assert.equal(incomeKind({ description: 'Anything', txType: 'salary_income' }), 'salary');
  assert.equal(incomeKind({ description: 'Salary income - September 2026', txType: 'manual' }), 'salary');
  assert.equal(incomeKind({ description: 'Gaji Oktober' }), 'salary');
  assert.equal(incomeKind({ description: 'Income salary - September 2026 (Freelance)', txType: 'manual' }), 'other');
  assert.equal(incomeKind({ description: 'Freelance On-Frontier (Model Evaluation)' }), 'other');
  assert.equal(incomeKind({ description: 'Refund on Donation' }), 'other');
  assert.equal(incomeKind({ description: 'Salary bonus' }), 'other');
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

test('only other income marked taxable adds to PKP; the wage is left out', () => {
  const totals = otherIncomeByTreatment([
    { description: 'Salary income - March 2026', txType: 'salary_income', incomeCents: 7_600_000, taxTreatment: 'taxable' },
    { description: 'Freelance July', txType: 'simple_income', incomeCents: 6_720_000, taxTreatment: 'taxable' },
    { description: 'THR Nenek', txType: 'simple_income', incomeCents: 500_000, taxTreatment: 'exempt' },
    { description: 'Interest BNI', txType: 'simple_income', incomeCents: 4_482, taxTreatment: 'final' },
  ]);
  assert.deepEqual(totals, { taxable: 6_720_000, final: 4_482, exempt: 500_000 });
});
