import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateRetirementProjection, jpAccessAge, jpAgeForYear } from './retirement.ts';

const base = {
  workerType: 'pu',
  currentAge: 30,
  retirementAge: 60,
  monthlyWage: 8_000_000,
  currentJhtBalance: 0,
  currentPersonalSavings: 0,
  monthlyPersonalContribution: 0,
  existingJpYears: 0,
  salaryGrowthRate: 0,
  inflationRate: 3,
  jhtReturnRate: 5,
  personalReturnRate: 6,
  postRetirementReturn: 6.25,
  payoutUntilAge: 90,
  targetMonthlySpending: 10_000_000,
  currentYear: 2026,
  jpWageCap: 10_547_400,
};
const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} vs ${expected}`);

test('JP age follows PP 45/2015: 59 in 2025–2027, one more every three years, 65 from 2043', () => {
  assert.deepEqual([2025, 2027, 2028, 2031, 2040, 2042, 2043, 2060].map(jpAgeForYear), [59, 59, 60, 61, 64, 64, 65, 65]);
  // Someone 55 in 2026 is 61 in 2032, when the JP age is also 61.
  assert.equal(jpAccessAge(55, 2026), 61);
  assert.equal(jpAccessAge(30, 2026), 65);
});

test('JHT grows as 5.7% of the wage compounding at its return', () => {
  const projection = calculateRetirementProjection(base);
  const i = 1.05 ** (1 / 12) - 1;
  const n = 30 * 12;
  close(projection.projectedJht, 8_000_000 * 0.057 * ((1 + i) ** n - 1) / i);
  close(projection.jhtMonthlyEmployee, 160_000);
  close(projection.jhtMonthlyEmployer, 296_000);
  close(projection.jpMonthlyEmployee + projection.jpMonthlyEmployer, 240_000);
});

test('JP pays 1% a year of service times the average capped wage, within the published limits', () => {
  const projection = calculateRetirementProjection({ ...base, retirementAge: 65 });
  // 35 years to 65 under the cap at a flat wage.
  close(projection.jpIncomeWhenPaid, Math.min(4_932_300, 0.01 * 35 * 8_000_000));
  const capped = calculateRetirementProjection({ ...base, retirementAge: 65, monthlyWage: 30_000_000 });
  close(capped.jpAverageWage, 10_547_400);
  const short = calculateRetirementProjection({ ...base, currentAge: 52, retirementAge: 62 });
  assert.equal(short.jpIncomeWhenPaid, 0, 'fewer than 15 years pays no monthly JP');
  // Retiring before the JP age leaves JP out of income at retirement but keeps the estimate.
  const early = calculateRetirementProjection(base);
  assert.equal(early.jpAvailable, false);
  assert.equal(early.estimatedJpIncome, 0);
  assert.ok(early.jpIncomeWhenPaid > 0);
});

test('saving the suggested extra closes the gap', () => {
  const projection = calculateRetirementProjection(base);
  assert.ok(projection.monthlyGap > 0);
  const topped = calculateRetirementProjection({ ...base, monthlyPersonalContribution: projection.requiredAdditionalSaving });
  close(topped.monthlyGap, 0, 1e-6);
});

test('the pay-out rises with inflation and empties the savings exactly at the chosen age', () => {
  const projection = calculateRetirementProjection({ ...base, currentPersonalSavings: 500_000_000, retirementAge: 65 });
  const i = 1.0625 ** (1 / 12) - 1;
  const g = 1.03 ** (1 / 12) - 1;
  let balance = projection.projectedPersonalSavings;
  let payment = projection.personalIncome;
  for (let month = 1; month <= (90 - 65) * 12; month++) {
    balance = balance * (1 + i) - payment;
    payment *= 1 + g;
  }
  close(balance / projection.projectedPersonalSavings, 0, 1e-9);
  assert.equal(projection.drawdown.length, 26);
  close(projection.drawdown.at(-1).assets / projection.availableAssetsAtRetirement, 0, 1e-6);
  // JHT and your savings are both paid out; JP comes on top.
  close(projection.estimatedMonthlyIncome, projection.jhtIncome + projection.personalIncome + projection.estimatedJpIncome);
});

test('the money has to last past retirement', () => {
  assert.throws(() => calculateRetirementProjection({ ...base, payoutUntilAge: 60 }));
});

test('the target grows with inflation to retirement', () => {
  const projection = calculateRetirementProjection(base);
  close(projection.projectedRetirementSpending, 10_000_000 * 1.03 ** 30);
  close(projection.inflationFactor, 1.03 ** 30);
});
