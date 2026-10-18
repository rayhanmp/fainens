import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planRowsFor, riskCounts, rowTone } from './budget-rows.ts';

const category = (id, name, planned, actual, extra = {}) => ({
  categoryId: id, categoryName: name, plannedAmount: planned, actualAmount: actual,
  projectedAmount: null, projectedLowAmount: null, projectedHighAmount: null, scheduledRemainingAmount: 0, riskStatus: 'within_budget', ...extra,
});

test('row tone: over plan is danger, the outlook or pace can warn, no plan is neutral', () => {
  assert.equal(rowTone({ actual: 120, planned: 100, projected: null }, 0.5), 'danger');
  assert.equal(rowTone({ actual: 50, planned: 100, projected: 130 }, 0.5), 'warning');
  assert.equal(rowTone({ actual: 50, planned: 100, projected: null, risk: 'over_budget' }, 0.5), 'danger');
  assert.equal(rowTone({ actual: 50, planned: 100, projected: 90, risk: 'at_risk' }, 0.5), 'warning');
  assert.equal(rowTone({ actual: 80, planned: 100, projected: null }, 0.5), 'warning'); // far ahead of the calendar
  assert.equal(rowTone({ actual: 50, planned: 100, projected: null }, 0.5), 'ok');
  assert.equal(rowTone({ actual: 500, planned: 0, projected: null }, 0.5), 'ok');
});

test('outlook rows come first, ordered by risk then usage, and are capped', () => {
  const outlook = [
    category(1, 'Food', 100, 40),
    category(2, 'Gifts', 100, 120, { riskStatus: 'over_budget' }),
    category(3, 'Fun', 100, 10, { riskStatus: 'at_risk', projectedAmount: 95 }),
    category(4, 'Bills', 100, 90),
  ];
  const rows = planRowsFor(outlook, [], [], 0.5, 3);
  assert.deepEqual(rows.map((row) => [row.name, row.tone]), [['Gifts', 'danger'], ['Fun', 'warning'], ['Bills', 'warning']]);
  assert.equal(rows[1].projected, 95);
});

test('without an outlook, budget rows sort by usage and raw spending is the last resort', () => {
  const budget = [
    { categoryId: 1, categoryName: 'Food', plannedAmount: 100, actualAmount: 20, percentUsed: 20 },
    { categoryId: 2, categoryName: 'Rent', plannedAmount: 100, actualAmount: 70, percentUsed: 70 },
  ];
  assert.deepEqual(planRowsFor(null, budget, [], 0.9).map((row) => row.name), ['Rent', 'Food']);
  const spending = planRowsFor(null, [], [{ category: 'Coffee', spentCents: 500 }, { category: 'Nothing', spentCents: 0 }], 0.2);
  assert.deepEqual(spending.map((row) => [row.name, row.planned, row.tone]), [['Coffee', 0, 'ok']]);
});

test('risk counts cover the whole outlook', () => {
  const outlook = [
    category(1, 'A', 100, 120),
    category(2, 'B', 100, 10, { riskStatus: 'at_risk' }),
    category(3, 'C', 100, 10),
  ];
  assert.deepEqual(riskCounts(outlook, 0.3), { over: 1, atRisk: 1 });
});
