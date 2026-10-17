import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAY_MS, upcomingCommitments } from './commitments.ts';
import { attentionReadKey, buildAttentionItems, parseAttentionReadKeys, serializeAttentionReadKeys, ATTENTION_READ_STORAGE_LIMIT } from './attention.ts';

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
