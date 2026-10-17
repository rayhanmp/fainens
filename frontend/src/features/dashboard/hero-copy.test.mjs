import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fallbackName, heroCopy, percentChange, timeOfDayGreeting } from './hero-copy.ts';

const formatAmount = (cents) => `Rp${cents}`;
const base = { budgetOverrun: null, periodName: 'October 2026', periodEnded: false, netWorthChangePercent: null, upcomingCommitmentTotal: 0 };
const copy = (overrides) => heroCopy({ ...base, ...overrides }, formatAmount);

test('a budget overrun leads, in the past tense once the period has ended', () => {
  assert.deepEqual(copy({ budgetOverrun: -250, netWorthChangePercent: 20 }), {
    headline: 'Your budget needs attention.',
    message: 'Rp250 over the October 2026 budget. Review the categories driving the overrun.',
  });
  assert.deepEqual(copy({ budgetOverrun: -250, periodName: 'September 2026', periodEnded: true }), {
    headline: 'September 2026 ran over budget.',
    message: 'It finished Rp250 over plan. Check which categories drove it before setting your next budget.',
  });
});

test('without net worth history the copy falls back to commitments', () => {
  assert.equal(copy({}).headline, 'Your position is taking shape.');
  assert.deepEqual(copy({ upcomingCommitmentTotal: 900 }), {
    headline: 'Your next moves are visible.',
    message: 'Rp900 in commitments are due within the next 30 days. Keep them in your plan.',
  });
});

test('net worth change picks the headline tier', () => {
  assert.equal(copy({ netWorthChangePercent: 10 }).headline, 'Strong momentum is building.');
  assert.equal(copy({ netWorthChangePercent: 2 }).headline, 'Progress is moving in the right direction.');
  assert.equal(copy({ netWorthChangePercent: -2 }).headline, 'A small reset can help.');
  assert.equal(copy({ netWorthChangePercent: -6 }).headline, 'Let’s protect your runway.');
  assert.equal(copy({ netWorthChangePercent: 0 }).headline, 'You’re holding steady.');
  assert.equal(copy({ netWorthChangePercent: 0, upcomingCommitmentTotal: 5 }).headline, 'Your next commitments are in view.');
});

test('net worth messages report the change and any commitments', () => {
  assert.equal(copy({ netWorthChangePercent: 30.06 }).message, 'Your net worth increased by 30,1% in the last 30 days. Keep building momentum.');
  assert.equal(copy({ netWorthChangePercent: 30.06, upcomingCommitmentTotal: 5 }).message, 'Your net worth increased by 30,1% in the last 30 days. Upcoming commitments total Rp5.');
  assert.equal(copy({ netWorthChangePercent: -4 }).message, 'Your net worth decreased by 4,0% in the last 30 days. Review the trend and plan your next move.');
});

test('percent change needs a non-zero starting point', () => {
  assert.equal(percentChange(100, 130), 30);
  assert.equal(percentChange(-100, -50), 50);
  assert.equal(percentChange(0, 10), null);
  assert.equal(percentChange(undefined, 10), null);
});

test('greeting and fallback name', () => {
  assert.deepEqual([timeOfDayGreeting(9), timeOfDayGreeting(12), timeOfDayGreeting(18)], ['Good morning', 'Good afternoon', 'Good evening']);
  assert.equal(fallbackName('ray.han_mp@example.com'), 'Ray Han Mp');
  assert.equal(fallbackName('demo@example.com'), 'there');
  assert.equal(fallbackName(undefined), 'there');
});
