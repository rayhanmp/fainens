import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cycleLabel, displayStatus, monthlyEquivalent, nextRenewal, previousRenewal, upcomingRenewals } from './schedule.ts';

const noon = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
const day = (ms) => new Date(ms).toDateString();

test('a month-end billing day returns to the 31st after February', () => {
  const schedule = { billingCycle: 'monthly', intervalCount: 1, billingDay: 31 };
  const feb = nextRenewal(noon(2027, 1, 31), schedule);
  assert.equal(day(feb), day(noon(2027, 2, 28)));
  assert.equal(day(nextRenewal(feb, schedule)), day(noon(2027, 3, 31)));
  assert.equal(day(previousRenewal(noon(2027, 3, 31), schedule)), day(noon(2027, 2, 28)));
});

test('custom intervals step whole units', () => {
  assert.equal(day(nextRenewal(noon(2026, 10, 1), { billingCycle: 'weekly', intervalCount: 2 })), day(noon(2026, 10, 15)));
  assert.equal(day(nextRenewal(noon(2026, 10, 1), { billingCycle: 'daily', intervalCount: 10 })), day(noon(2026, 10, 11)));
  assert.equal(day(nextRenewal(noon(2026, 10, 20), { billingCycle: 'monthly', intervalCount: 3, billingDay: 20 })), day(noon(2027, 1, 20)));
  assert.equal(day(nextRenewal(noon(2024, 2, 29), { billingCycle: 'annual', intervalCount: 1, billingDay: 29 })), day(noon(2025, 2, 28)));
});

test('cost per month spreads every cycle evenly', () => {
  assert.equal(monthlyEquivalent(120_000, { billingCycle: 'annual' }), 10_000);
  assert.equal(monthlyEquivalent(30_000, { billingCycle: 'monthly', intervalCount: 3 }), 10_000);
  assert.equal(Math.round(monthlyEquivalent(12_000, { billingCycle: 'weekly' })), 52_000);
});

test('cycle labels name the interval', () => {
  assert.equal(cycleLabel({ billingCycle: 'monthly' }), 'Monthly');
  assert.equal(cycleLabel({ billingCycle: 'monthly', intervalCount: 6 }), 'Every 6 months');
  assert.equal(cycleLabel({ billingCycle: 'weekly', intervalCount: 2 }), 'Every 2 weeks');
});

test('a cancelled subscription stops renewing after its last day', () => {
  const subscription = { id: 1, status: 'cancelled', amount: 1, billingCycle: 'monthly', billingDay: 5, nextRenewalAt: noon(2026, 11, 5), endsAt: noon(2026, 12, 10), trialEndsAt: null };
  assert.deepEqual(upcomingRenewals(subscription, noon(2026, 11, 1), noon(2027, 3, 1)).map(day), [day(noon(2026, 11, 5)), day(noon(2026, 12, 5))]);
  assert.equal(displayStatus(subscription, new Set(), noon(2026, 11, 1)), 'ending');
  assert.equal(displayStatus({ ...subscription, endsAt: noon(2026, 11, 1) }, new Set(), noon(2026, 11, 2)), 'ended');
});
