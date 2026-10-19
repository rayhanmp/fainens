import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_FILTERS, activeFilterCount, draftMonths, filterDrafts, groupDrafts, needsCategory, sortDrafts, toDraftView } from './draft-list.ts';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const types = new Map([[1, 'asset'], [2, 'asset'], [50, 'expense'], [60, 'revenue'], [70, 'expense']]);
const names = {
  account: (id) => ({ 1: 'BNI', 2: 'GoPay' })[id] ?? '',
  category: (id) => ({ 7: 'Food & Dining', 8: 'Transportation' })[id] ?? '',
  tag: (id) => ({ 3: 'Commute', 4: 'Hangout' })[id] ?? '',
};

const drafts = [
  { id: 1, date: at(2026, 3, 1), description: 'Warteg Bahari', txType: 'simple_expense', categoryAllocations: [{ categoryId: 7 }], tags: [{ tagId: 4, name: 'Hangout' }],
    lines: [{ accountId: 50, debit: 32_000, credit: 0 }, { accountId: 1, debit: 0, credit: 32_000 }] },
  { id: 2, date: at(2026, 3, 3), description: 'Top up GoPay', txType: 'simple_transfer',
    lines: [{ accountId: 1, debit: 0, credit: 200_000 }, { accountId: 2, debit: 200_000, credit: 0 }] },
  { id: 3, date: at(2026, 3, 3), description: 'Transfer fee: Top up GoPay', txType: 'simple_expense', linkedTxId: 2,
    lines: [{ accountId: 70, debit: 1_000, credit: 0 }, { accountId: 1, debit: 0, credit: 1_000 }] },
  { id: 4, date: at(2026, 3, 25), description: 'Gaji Maret 2026', txType: 'salary_income',
    lines: [{ accountId: 1, debit: 7_554_552, credit: 0 }, { accountId: 60, debit: 0, credit: 7_554_552 }] },
  { id: 5, date: at(2026, 4, 2), description: 'GoRide to office', txType: 'simple_expense', place: 'Menara BCA', tags: [{ tagId: 3, name: 'Commute' }],
    lines: [{ accountId: 50, debit: 18_000, credit: 0 }, { accountId: 2, debit: 0, credit: 18_000 }] },
  { id: 6, date: at(2026, 4, 9), description: 'Freelance project X', txType: 'simple_income', notes: 'Invoice INV-031',
    lines: [{ accountId: 1, debit: 1_500_000, credit: 0 }, { accountId: 60, debit: 0, credit: 1_500_000 }] },
];
const views = drafts.map((row) => toDraftView(row, types));
const ids = (list) => list.map((view) => view.id);

test('each draft is classified with a signed amount and its wallets, sender first', () => {
  assert.deepEqual(views.map((view) => [view.kind, view.amount]), [
    ['expense', -32_000], ['transfer', 200_000], ['expense', -1_000], ['salary', 7_554_552], ['expense', -18_000], ['income', 1_500_000],
  ]);
  assert.deepEqual(views[1].walletIds, [1, 2]);
  assert.equal(views[2].isFee, true);
  assert.deepEqual(views.filter(needsCategory).map((view) => view.id), [5]);
});

test('filters combine: kind, account, uncategorized, tag, month and a search over names and amounts', () => {
  const run = (patch) => ids(filterDrafts(views, { ...EMPTY_FILTERS, ...patch }, names));
  assert.deepEqual(run({ kinds: ['income', 'salary'] }), [4, 6]);
  assert.deepEqual(run({ accountId: 2 }), [2, 5]);
  assert.deepEqual(run({ category: 'none' }), [5]);
  assert.deepEqual(run({ category: 7 }), [1]);
  assert.deepEqual(run({ tag: 3 }), [5]);
  assert.deepEqual(run({ tag: 'none', month: '2026-03' }), [2, 3, 4]);
  assert.deepEqual(run({ search: 'gopay' }), [2, 3, 5]);
  assert.deepEqual(run({ search: 'food 32.000' }), [1]);
  assert.deepEqual(run({ search: '18k' }), [5]);
  assert.deepEqual(run({ search: 'inv-031' }), [6]);
  assert.deepEqual(run({ search: 'menara' }), [5]);
  assert.equal(activeFilterCount({ ...EMPTY_FILTERS, search: ' ', kinds: ['expense'], tag: 'none' }), 2);
});

test('sorting by amount ignores the sign, and month groups total money in and out without transfers', () => {
  assert.deepEqual(ids(sortDrafts(views, 'amount-desc')), [4, 6, 2, 1, 5, 3]);
  assert.deepEqual(ids(sortDrafts(views, 'date-desc')), [6, 5, 4, 3, 2, 1]);
  assert.deepEqual(ids(sortDrafts(views, 'description')), [6, 4, 5, 2, 3, 1]);

  const groups = groupDrafts(sortDrafts(views, 'date-asc'), 'date-asc');
  assert.deepEqual(groups.map((group) => [group.label, group.rows.length, group.moneyIn, group.moneyOut]), [
    ['March 2026', 4, 7_554_552, 33_000],
    ['April 2026', 2, 1_500_000, 18_000],
  ]);
  assert.equal(groupDrafts(sortDrafts(views, 'amount-desc'), 'amount-desc').length, 1);
  assert.deepEqual(draftMonths(views).map((month) => [month.key, month.count]), [['2026-03', 4], ['2026-04', 2]]);
});
