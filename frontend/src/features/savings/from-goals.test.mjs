import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planFromGoals } from './from-goals.ts';
import { goalOutlooks, MAX_POTS, unallocated } from './plan.ts';

const goal = (id, patch = {}) => ({ id, name: `Goal ${id}`, targetAmount: 10_000_000, byDate: null, kind: 'spend', monthlyAmount: 0, status: 'active', setAside: 0, ...patch });

test('each real goal is its own pot, with the free money in one more', () => {
  const now = new Date(2026, 9, 21);
  const plan = planFromGoals({
    goals: [
      goal(10, { name: 'Emergency fund', targetAmount: 30_000_000, kind: 'keep', monthlyAmount: 1_000_000, setAside: 24_000_000 }),
      goal(11, { name: 'Laptop', targetAmount: 20_000_000, byDate: new Date(2027, 9, 31).getTime(), monthlyAmount: 2_000_000, setAside: 5_000_000 }),
      goal(12, { status: 'done', monthlyAmount: 9 }),
    ],
    unassigned: 16_841_001,
  }, 5_000_000, now);
  assert.deepEqual(plan.pots.map((pot) => [pot.id, pot.name, pot.start, pot.monthly]), [
    ['goal-pot-10', 'Emergency fund', 24_000_000, 1_000_000],
    ['goal-pot-11', 'Laptop', 5_000_000, 2_000_000],
    ['unassigned', 'Free money', 16_841_001, 2_000_000],
  ]);
  assert.deepEqual(plan.goals.map((item) => [item.id, item.potId, item.saved, item.spend, item.byMonth]), [
    ['goal-10', 'goal-pot-10', 24_000_000, false, null],
    ['goal-11', 'goal-pot-11', 5_000_000, true, 12],
  ]);
  // A goal's money is all in its own pot, nothing more.
  assert.equal(unallocated(plan, plan.pots[0]), 0);
  assert.equal(goalOutlooks(plan, null).length, 2);
});

test('goals past the room a plan has share one pot', () => {
  const plan = planFromGoals({ goals: [1, 2, 3, 4, 5, 6, 7].map((id) => goal(id, { setAside: 1_000_000 })), unassigned: 0 }, 0);
  assert.equal(plan.pots.length, MAX_POTS);
  assert.deepEqual(plan.pots.at(-2), { ...plan.pots.at(-2), id: 'other-goals', start: 3_000_000 });
  assert.deepEqual(plan.goals.slice(4).map((item) => item.potId), ['other-goals', 'other-goals', 'other-goals']);
});

test('saving less than the goals’ monthly amounts leaves nothing for the free pot', () => {
  const plan = planFromGoals({ goals: [goal(1, { monthlyAmount: 3_000_000 })], unassigned: -5 }, 1_000_000);
  assert.deepEqual(plan.pots.at(-1), { ...plan.pots.at(-1), start: 0, monthly: 0 });
});
