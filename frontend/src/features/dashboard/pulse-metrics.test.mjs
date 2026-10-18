import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addPulseMetric, choosePulseMetric, defaultPulseMetrics, monthlySubscriptionCost, movePulseMetric, normalizePulseMetrics, pulseMetricGroups, pulseMetricIds, pulseMetricValue, removePulseMetric, spentThroughDay } from './pulse-metrics.ts';

const format = { amount: (cents) => `Rp${cents}`, decimal: (value) => value.toFixed(1) };
const base = {
  isTracked: true, incomeCents: 10_000, spentCents: 4_000, transactionCount: 12,
  topCategory: { name: 'Food', spentCents: 1_500 }, burnRate: 3_000, runway: { isUnbounded: false, runwayMonths: 11.5 },
  netWorth: 50_000, liabilities: 2_000, upcoming: { total: 900, count: 3 },
  budget: { planned: 8_000, actual: 4_000, dailyBudget: 400, daysRemaining: 10 },
  pacing: { dayIndex: 20, totalDays: 30, elapsedRatio: 0.65, status: 'active' },
  isAnalyticsLoading: false, isPeriodLoading: false,
};

test('every metric appears in exactly one picker group', () => {
  const grouped = pulseMetricGroups.flatMap((group) => group.ids);
  assert.equal(grouped.length, pulseMetricIds.length);
  assert.deepEqual([...grouped].sort(), [...pulseMetricIds].sort());
});

test('choosing a metric already shown swaps the two slots', () => {
  assert.deepEqual(choosePulseMetric(defaultPulseMetrics, 0, 'runway'), ['runway', 'savingsRate', 'burn', 'cashFlow']);
  assert.deepEqual(choosePulseMetric(defaultPulseMetrics, 1, 'netWorth'), ['cashFlow', 'netWorth', 'burn', 'runway']);
  assert.deepEqual(choosePulseMetric(defaultPulseMetrics, 2, 'burn'), defaultPulseMetrics);
});

test('normalizing keeps two to six distinct known metrics', () => {
  assert.deepEqual(normalizePulseMetrics(undefined), defaultPulseMetrics);
  assert.deepEqual(normalizePulseMetrics(['income', 'income']), ['income', 'cashFlow']);
  assert.deepEqual(normalizePulseMetrics(['netWorth', 'debt', 'income']), ['netWorth', 'debt', 'income']);
  assert.deepEqual(normalizePulseMetrics(['a', 'netWorth', 'debt', 'income', 'spending', 'runway', 'burn', 'upcoming']), ['netWorth', 'debt', 'income', 'spending', 'runway', 'burn']);
});

test('tiles can be added, removed and reordered within the limits', () => {
  assert.deepEqual(addPulseMetric(defaultPulseMetrics, 'netWorth'), [...defaultPulseMetrics, 'netWorth']);
  assert.deepEqual(addPulseMetric(defaultPulseMetrics, 'burn'), defaultPulseMetrics);
  const full = ['cashFlow', 'savingsRate', 'burn', 'runway', 'income', 'spending'];
  assert.deepEqual(addPulseMetric(full, 'netWorth'), full);
  assert.deepEqual(removePulseMetric(defaultPulseMetrics, 1), ['cashFlow', 'burn', 'runway']);
  assert.deepEqual(removePulseMetric(['cashFlow', 'burn'], 0), ['cashFlow', 'burn']);
  assert.deepEqual(movePulseMetric(defaultPulseMetrics, 3, 0), ['runway', 'cashFlow', 'savingsRate', 'burn']);
  assert.deepEqual(movePulseMetric(defaultPulseMetrics, 0, 2), ['savingsRate', 'burn', 'cashFlow', 'runway']);
  assert.deepEqual(movePulseMetric(defaultPulseMetrics, 0, 9), defaultPulseMetrics);
});

test('spending is compared with the same point of the previous period', () => {
  const start = Date.UTC(2026, 8, 25);
  const rows = [{ date: start + 1 * 86_400_000, expenseCents: 1_000 }, { date: start + 5 * 86_400_000, expenseCents: 2_000 }, { date: start + 25 * 86_400_000, expenseCents: 9_000 }, { date: start, expenseCents: -500 }];
  assert.equal(spentThroughDay(rows, start, 20), 3_000);
  const more = pulseMetricValue('spendVsLast', { ...base, previousPeriod: { name: 'September', spentToDateCents: 3_200, dayIndex: 20 } }, format);
  assert.deepEqual([more.value, more.tone, more.detail], ['+25.0%', 'negative', 'vs Rp3200']);
  assert.equal(pulseMetricValue('spendVsLast', { ...base, previousPeriod: { name: 'September', spentToDateCents: 5_000, dayIndex: 20 } }, format).tone, 'positive');
  assert.equal(pulseMetricValue('spendVsLast', { ...base, previousPeriod: 'none' }, format).value, '—');
  assert.equal(pulseMetricValue('spendVsLast', { ...base, previousPeriod: null }, format).value, 'Loading…');
});

test('follow-up metrics read clearly when there is nothing to show', () => {
  assert.deepEqual(monthlySubscriptionCost([{ amount: 120_000, billingCycle: 'annual', status: 'active' }, { amount: 50_000, billingCycle: 'monthly', status: 'active' }, { amount: 99_000, billingCycle: 'monthly', status: 'paused' }]), { monthlyCents: 60_000, count: 2 });
  assert.equal(pulseMetricValue('owedToYou', { ...base, owedToYou: { total: 0, count: 0 } }, format).value, 'Nothing owed');
  assert.equal(pulseMetricValue('reimbursementsDue', { ...base, reimbursements: { total: 0, count: 0 } }, format).value, 'All paid');
  assert.equal(pulseMetricValue('pendingReview', { ...base, pendingCount: 0 }, format).value, 'All clear');
  assert.equal(pulseMetricValue('pendingReview', { ...base, pendingCount: 3 }, format).detail, 'items to review');
  assert.equal(pulseMetricValue('netWorthChange', { ...base, netWorthChange: { amount: -500, percent: -2 } }, format).value, '−Rp500');
});

test('period metrics compute from tracked facts', () => {
  assert.deepEqual(pulseMetricValue('cashFlow', base, format), { value: '+Rp6000', tone: 'positive', hint: 'Rp10000 income minus Rp4000 spending.' });
  assert.equal(pulseMetricValue('savingsRate', base, format).value, '60.0%');
  assert.equal(pulseMetricValue('dailySpend', base, format).value, 'Rp200');
  assert.equal(pulseMetricValue('budgetUsed', base, format).value, '50.0%');
  assert.equal(pulseMetricValue('daysLeft', base, format).value, '10 days');
  assert.deepEqual([pulseMetricValue('topCategory', base, format).value, pulseMetricValue('topCategory', base, format).detail], ['Food', 'Rp1500']);
});

test('untracked periods and missing budgets say so instead of showing zero', () => {
  const untracked = { ...base, isTracked: false, budget: null };
  for (const id of ['cashFlow', 'income', 'spending', 'dailySpend', 'topCategory']) assert.equal(pulseMetricValue(id, untracked, format).value, 'Not tracked');
  assert.equal(pulseMetricValue('budgetUsed', untracked, format).value, 'No budget');
  assert.equal(pulseMetricValue('safePace', { ...base, budget: { ...base.budget, planned: 0 } }, format).value, 'No budget');
});

test('overspending and negative cash flow are flagged', () => {
  const over = { ...base, spentCents: 12_000, budget: { ...base.budget, actual: 9_000 } };
  assert.equal(pulseMetricValue('cashFlow', over, format).tone, 'negative');
  assert.equal(pulseMetricValue('savingsRate', over, format).tone, 'negative');
  assert.equal(pulseMetricValue('budgetUsed', over, format).tone, 'negative');
});

test('loading values never render as zero', () => {
  const loading = { ...base, burnRate: null, netWorth: null, runway: null, isAnalyticsLoading: true, isPeriodLoading: true, upcoming: null };
  for (const id of ['burn', 'netWorth', 'runway', 'cashFlow', 'upcoming']) assert.equal(pulseMetricValue(id, loading, format).value, 'Loading…');
});
