import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAY_MS, upcomingCommitments } from './commitments.ts';
import { attentionReadKey, attentionStripItems, buildAttentionItems, goalReminders, parseAttentionReadKeys, serializeAttentionReadKeys, ATTENTION_READ_STORAGE_LIMIT, ATTENTION_STRIP_LIMIT } from './attention.ts';

const NOW = Date.UTC(2026, 9, 17, 12);
const format = { amount: (cents) => `Rp${cents}`, date: (ms) => new Date(ms).toISOString().slice(0, 10) };
const period = { id: 20, name: 'October 2026', coverageStatus: 'complete', coverageReason: null };
const noCommitments = upcomingCommitments({ subscriptions: [], payLater: [], loans: [] }, NOW);

function input(overrides = {}) {
  return {
    now: NOW,
    pendingTransactionCount: 0,
    ledgerBalanced: true,
    currentPeriod: period,
    budgetRows: [],
    outlookCategories: [],
    unallocatedSpentCents: null,
    reconciliationSessions: [{ id: 7, asOfDate: NOW - 2 * DAY_MS, lifecycleStatus: 'active' }],
    loans: [],
    payLaterObligations: [],
    subscriptionRenewals: [],
    commitments: noCommitments,
    ...overrides,
  };
}

const ids = (items) => items.map((item) => item.id);

test('upcoming commitments cover the next 30 days in due-date order, including overdue items', () => {
  const commitments = upcomingCommitments({
    subscriptions: [
      { id: 1, name: 'Music', amount: 50, status: 'active', nextRenewalAt: NOW + 10 * DAY_MS },
      { id: 2, name: 'Paused', amount: 99, status: 'paused', nextRenewalAt: NOW + DAY_MS },
      { id: 3, name: 'Later', amount: 99, status: 'active', nextRenewalAt: NOW + 40 * DAY_MS },
    ],
    payLater: [
      { recognitionTxId: 4, description: 'Phone', outstandingCents: 300, dueDateMs: NOW - DAY_MS, status: 'overdue' },
      { recognitionTxId: 5, description: 'Paid off', outstandingCents: 0, dueDateMs: NOW + DAY_MS, status: 'paid' },
    ],
    loans: [
      { id: 6, direction: 'borrowed', status: 'active', remainingCents: 1000, dueDate: NOW + 5 * DAY_MS, isOverdue: false, contact: { name: 'Sam' } },
      { id: 7, direction: 'lent', status: 'active', remainingCents: 1000, dueDate: NOW + 5 * DAY_MS, isOverdue: false, contact: { name: 'Alex' } },
    ],
  }, NOW);
  assert.deepEqual(commitments.rows.map((row) => row.name), ['Phone', 'Sam', 'Music']);
  assert.equal(commitments.total, 1350);
  assert.equal(commitments.count, 3);
  assert.deepEqual([commitments.subscriptionTotal, commitments.payLaterTotal, commitments.loanTotal], [50, 300, 1000]);
});

test('a healthy position raises no notifications', () => {
  assert.deepEqual(buildAttentionItems(input(), format), []);
});

test('deleted files storage would not remove point to Settings > Data', () => {
  const [item] = buildAttentionItems(input({ stuckStorageFiles: 2 }), format);
  assert.deepEqual([item.tone, item.title, item.to, item.search], ['warning', '2 deleted files still in storage', '/settings', { tab: 'data' }]);
  assert.deepEqual(buildAttentionItems(input({ stuckStorageFiles: 0 }), format), []);
});

test('notifications wait for their data instead of raising false alarms', () => {
  assert.deepEqual(buildAttentionItems(input({ ledgerBalanced: null, reconciliationSessions: null }), format), []);
  assert.deepEqual(ids(buildAttentionItems(input({ ledgerBalanced: false, reconciliationSessions: [] }), format)), ['trial-balance', 'reconciliation:none']);
});

test('stale reconciliation is keyed by its session, so a new check re-notifies', () => {
  const [item] = buildAttentionItems(input({ reconciliationSessions: [{ id: 9, asOfDate: NOW - 45 * DAY_MS, lifecycleStatus: 'active' }] }), format);
  assert.equal(item.id, 'reconciliation:9');
  assert.equal(item.detail, 'Last checked 45 days ago.');
});

test('spending exactly on plan is not over budget', () => {
  const onPlan = [{ categoryName: 'Utilities', actualAmount: 160, plannedAmount: 160 }];
  assert.deepEqual(buildAttentionItems(input({ budgetRows: onPlan }), format), []);
  const over = [...onPlan, { categoryName: 'Food', actualAmount: 650, plannedAmount: 500 }, { categoryName: 'Fun', actualAmount: 120, plannedAmount: 100 }];
  const [item] = buildAttentionItems(input({ budgetRows: over }), format);
  assert.equal(item.id, 'budget-overrun:20');
  assert.equal(item.title, '2 categories are over budget');
  assert.equal(item.detail, 'Rp170 over plan, led by Food and Fun.');
});

test('budget risk only shows when nothing is already over, and never for untracked periods', () => {
  const outlookCategories = [{ categoryName: 'Food', riskStatus: 'at_risk' }];
  assert.deepEqual(ids(buildAttentionItems(input({ outlookCategories }), format)), ['budget-risk:20']);
  const untracked = { ...period, coverageStatus: 'skipped' };
  assert.deepEqual(ids(buildAttentionItems(input({ currentPeriod: untracked, outlookCategories, budgetRows: [{ categoryName: 'Food', actualAmount: 2, plannedAmount: 1 }] }), format)), ['coverage:20']);
});

test('coverage notices name the current period and use the stored reason', () => {
  const [item] = buildAttentionItems(input({ currentPeriod: { ...period, coverageStatus: 'partial', coverageReason: 'Bank import missing' } }), format);
  assert.deepEqual([item.tone, item.title, item.detail], ['warning', 'Partially captured · October 2026', 'Bank import missing']);
});

test('loans escalate from upcoming to due soon to overdue', () => {
  const loan = (dueInDays, isOverdue = false) => ({ id: 1, direction: 'borrowed', status: 'active', remainingCents: 500, dueDate: NOW + dueInDays * DAY_MS, isOverdue, contact: { name: 'Sam' } });
  const run = (loans) => {
    const commitments = upcomingCommitments({ subscriptions: [], payLater: [], loans }, NOW);
    return buildAttentionItems(input({ loans, commitments }), format)[0];
  };
  assert.equal(run([loan(20)]).id, 'loans-upcoming');
  assert.equal(run([loan(3)]).detail, 'Rp500 due next, starting 2026-10-20');
  assert.deepEqual([run([loan(-2, true)]).id, run([loan(-2, true)]).tone], ['loans', 'danger']);
});

test('items sort by severity and are capped at eight', () => {
  const items = buildAttentionItems(input({
    pendingTransactionCount: 1,
    ledgerBalanced: false,
    unallocatedSpentCents: 40,
    subscriptionRenewals: [{ dueAt: NOW - DAY_MS, amount: 10 }],
  }), format);
  assert.deepEqual(ids(items), ['trial-balance', 'subscriptions-overdue', 'pending-transactions', 'unallocated:20']);
  assert.equal(items[2].title, '1 pending transaction');
});

test('the inline strip shows the top unread danger and warning items, never info', () => {
  const items = buildAttentionItems(input({
    pendingTransactionCount: 1,
    ledgerBalanced: false,
    unallocatedSpentCents: 40,
    reconciliationSessions: [],
    subscriptionRenewals: [{ dueAt: NOW - DAY_MS, amount: 10 }],
  }), format);
  assert.deepEqual(ids(items), ['trial-balance', 'subscriptions-overdue', 'pending-transactions', 'reconciliation:none', 'unallocated:20']);
  assert.equal(ATTENTION_STRIP_LIMIT, 3);
  assert.deepEqual(ids(attentionStripItems(items)), ['trial-balance', 'subscriptions-overdue', 'pending-transactions']);
  // Read items drop out and the next warning takes their place; info items still never appear.
  assert.deepEqual(ids(attentionStripItems(items, (item) => item.id === 'subscriptions-overdue')), ['trial-balance', 'pending-transactions', 'reconciliation:none']);
  assert.deepEqual(attentionStripItems(items, () => true), []);
  assert.deepEqual(attentionStripItems(items, undefined, 1).map((item) => item.tone), ['danger']);
});

test('read keys ignore live details and migrate keys saved with them', () => {
  const item = { id: 'budget-overrun:20', title: '1 category is over budget', detail: 'Rp5 over plan' };
  assert.equal(attentionReadKey({ ...item, detail: 'Rp9 over plan' }), attentionReadKey(item));
  assert.deepEqual(parseAttentionReadKeys(JSON.stringify(['a|Title|Old detail', 'b|Title', 3])), ['a|Title', 'b|Title']);
  assert.deepEqual(parseAttentionReadKeys(null), []);
  assert.deepEqual(parseAttentionReadKeys('{}'), []);
  assert.throws(() => parseAttentionReadKeys('not json'));
});

test('stored read keys keep only the most recent entries', () => {
  const keys = Array.from({ length: ATTENTION_READ_STORAGE_LIMIT + 5 }, (_, index) => `k${index}|t`);
  const stored = JSON.parse(serializeAttentionReadKeys(keys));
  assert.equal(stored.length, ATTENTION_READ_STORAGE_LIMIT);
  assert.equal(stored[0], 'k5|t');
});

test('goals remind you of this month’s amounts, goals that won’t make their date, and short accounts', () => {
  const goal = { status: 'active', paused: false, setAsideThisMonth: 0, accountId: null, byDate: null, reachMonths: null };
  const reminders = goalReminders({
    unassigned: 3_000_000,
    accounts: [{ id: 1, name: 'Jago', balance: 2_000_000 }, { id: 2, name: 'BCA', balance: 50_000_000 }],
    goals: [
      // Needed in 4 months, gets there in 10: 6 months late.
      { ...goal, id: 1, name: 'Laptop', targetAmount: 20_000_000, setAside: 10_000_000, monthlyAmount: 1_000_000, byDate: Date.UTC(2027, 1, 20), reachMonths: 10 },
      { ...goal, id: 2, name: 'Fund', targetAmount: 10_000_000, setAside: 5_000_000, monthlyAmount: 1_000_000, setAsideThisMonth: 400_000, accountId: 1 },
      { ...goal, id: 3, name: 'Paused', paused: true, targetAmount: 9, setAside: 0, monthlyAmount: 5, byDate: Date.UTC(2026, 11, 1), reachMonths: null },
    ],
  }, NOW);
  assert.equal(reminders.due, 1_600_000);
  assert.deepEqual(reminders.late.map((item) => [item.name, item.months]), [['Laptop', 6]]);
  assert.deepEqual(reminders.shortAccounts.map((item) => [item.name, item.goalsHold]), [['Jago', 5_000_000]]);

  const items = buildAttentionItems(input({ goals: reminders }), format);
  assert.deepEqual(items.filter((item) => item.to === '/goals').map((item) => [item.tone, item.title]), [
    ['warning', 'Jago holds less than its goals'],
    ['warning', 'Laptop won’t make its date'],
    ['info', 'Rp1600000 to put into goals'],
  ]);
  // Nothing free, nothing to remind about putting in.
  assert.equal(buildAttentionItems(input({ goals: { ...reminders, free: 0 } }), format).some((item) => item.id.startsWith('goals-due')), false);
});

test('dated checklist items in goals’ notes are reminded of when due within three days or late', () => {
  const day = (offset) => new Date(new Date(NOW).setHours(12, 0, 0, 0) + offset * DAY_MS).getTime();
  const goals = { due: 0, free: 0, late: [], shortAccounts: [], tasks: [
    { goalId: 1, goalName: 'Japan', text: 'Apply for the visa', dueAt: day(-1) },
    { goalId: 1, goalName: 'Japan', text: 'Book the hotel', dueAt: day(1) },
    { goalId: 2, goalName: 'Laptop', text: 'Compare prices', dueAt: day(10) },
  ] };
  const items = buildAttentionItems(input({ goals }), format).filter((item) => item.id.startsWith('goal-task'));
  assert.deepEqual(items.map((item) => [item.tone, item.title]), [
    ['warning', 'Apply for the visa: was due'],
    ['info', 'Book the hotel: due tomorrow'],
  ]);
});

test('holidays remind you of cancellation, payment, passports, visas and packing', () => {
  const day = (offset) => new Date(new Date(NOW).setHours(12, 0, 0, 0) + offset * DAY_MS).getTime();
  const trip = { goalId: 3, goalName: 'Japan', count: 1, name: null, amount: null, short: false };
  const goals = { due: 0, free: 0, late: [], shortAccounts: [], kinds: [
    { ...trip, kind: 'cancel', at: day(2), name: 'Shinjuku hotel' },
    { ...trip, kind: 'unpaid', at: day(10), count: 2 },
    { ...trip, kind: 'passport', at: Date.UTC(2027, 5, 1), name: 'Sari' },
    { ...trip, kind: 'visa', at: day(10), name: 'Sari' },
    { ...trip, kind: 'packing', at: day(1), count: 12 },
  ] };
  const items = buildAttentionItems(input({ goals }), format).filter((item) => item.id.startsWith('goal-'));
  assert.deepEqual(items.map((item) => [item.tone, item.title]), [
    ['warning', 'Free cancellation for Shinjuku hotel ends in 2 days'],
    ['warning', '2 bookings not paid yet'],
    ['warning', 'Sari’s passport runs out 2027-06-01'],
    ['warning', 'Apply for Sari’s visa'],
  ]);
  // Four at most, so the bell isn't only about one trip.
  assert.equal(buildAttentionItems(input({ goals: { ...goals, kinds: goals.kinds.slice(4) } }), format).find((item) => item.id.startsWith('goal-packing')).title, '12 things not packed yet');
});

test('goals of each kind remind you of parts due, refills, THR, and what their kind asks', () => {
  const day = (offset) => new Date(new Date(NOW).setHours(12, 0, 0, 0) + offset * DAY_MS).getTime();
  const base = { count: 1, name: null, amount: null, short: false };
  const goals = { due: 0, free: 0, late: [], shortAccounts: [], kinds: [
    { ...base, kind: 'part-due', goalId: 1, goalName: 'Wedding', at: day(10), name: 'Venue deposit', amount: 25_000_000 },
    { ...base, kind: 'part-due', goalId: 2, goalName: 'School', at: day(25), name: 'Term 2', amount: 9_000_000, short: true },
    { ...base, kind: 'refill', goalId: 3, goalName: 'Fund', at: day(-5), name: 'Car repair', amount: 4_000_000 },
    { ...base, kind: 'thr', goalId: 4, goalName: 'Lebaran', at: day(-2), amount: 9_000_000 },
  ], types: [
    { kind: 'emergency-low', goalId: 3, goalName: 'Fund', months: 2.4 },
    { kind: 'yearly-due', goalId: 5, goalName: 'Vehicle tax', at: day(20), days: 20, short: 0 },
  ] };
  const items = buildAttentionItems(input({ goals }), format).filter((item) => item.id.startsWith('goal-'));
  assert.deepEqual(items.map((item) => [item.tone, item.title]), [
    ['warning', 'Term 2: due in 25 days'],
    ['warning', 'Fill Fund back up'],
    ['warning', 'Fund covers 2,4 months of spending'],
    ['info', 'Venue deposit: due in 10 days'],
    ['info', 'Put some THR into Lebaran'],
    ['info', 'Vehicle tax is due in 20 days'],
  ]);
  assert.equal(items.find((item) => item.title.startsWith('Term 2')).detail, 'Rp9000000 on School, by ' + new Date(day(25)).toISOString().slice(0, 10) + '. School holds less than that so far.');
});

test('the overview’s goals give their kind’s reminders', () => {
  const goal = { status: 'active', paused: false, setAsideThisMonth: 0, accountId: null, byDate: null, reachMonths: null, monthlyAmount: 0, typeData: {} };
  const reminders = goalReminders({ unassigned: 0, salary: 20_000_000, accounts: [], goals: [
    { ...goal, id: 1, name: 'Fund', goalType: 'emergency', targetAmount: 30_000_000, setAside: 10_000_000 },
    { ...goal, id: 2, name: 'House', goalType: 'house', targetAmount: 265_000_000, setAside: 0, typeData: { price: 1_000_000_000 } },
  ] }, NOW, 5_000_000);
  assert.deepEqual(reminders.types.map((item) => item.kind), ['emergency-low', 'kpr-limit']);
});
