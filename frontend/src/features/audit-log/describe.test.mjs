import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionLabel, auditAmount, auditChanges, auditKind, auditName, auditReason, entityLabel } from './describe.ts';

const format = {
  amount: (value) => `Rp${value}`,
  date: (ms) => new Date(ms).toISOString().slice(0, 10),
  dateTime: (ms) => new Date(ms).toISOString().slice(0, 16),
  category: (id) => ({ 7: 'Fashion', 12: 'Food' })[id] ?? null,
  account: (id) => ({ 3: 'BNI', 4: 'Food expense' })[id] ?? null,
  period: (id) => ({ 13: 'April 2026' })[id] ?? null,
  tag: (id) => ({ 19: 'Trip', 11: 'Work' })[id] ?? null,
};

const entry = (overrides) => ({ id: 1, entityType: 'transaction', entityId: 9, action: 'update', beforeSnapshot: null, afterSnapshot: null, createdAt: 0, ...overrides });
const rows = (changes) => changes.map((change) => [change.label, change.before, change.after]);

test('a transaction edit shows the fields that changed, with names and money', () => {
  const tx = { id: 9, description: 'Sherchle', categoryId: 12, periodId: 13, status: 'posted', createdAt: 'x' };
  const line = (accountId, debit, credit) => ({ id: accountId, transactionId: 9, accountId, debit, credit });
  const changed = entry({
    beforeSnapshot: { transaction: tx, lines: [line(4, 30000, 0), line(3, 0, 30000)] },
    afterSnapshot: { transaction: { ...tx, categoryId: 7, description: 'Sherchle bag' }, lines: [line(4, 35000, 0), line(3, 0, 35000)] },
  });
  assert.deepEqual(rows(auditChanges(changed, format)), [
    ['Description', 'Sherchle', 'Sherchle bag'],
    ['Category', 'Food', 'Fashion'],
    ['Amount', 'Rp30000', 'Rp35000'],
  ]);
  assert.equal(auditName(changed), 'Sherchle bag');
  assert.equal(auditAmount(changed), 35000);
});

test('a workflow step reads as words, with its stored reason kept apart', () => {
  const period = { id: 13, name: 'April 2026', startDate: Date.UTC(2026, 2, 25), status: 'open', coverageStatus: 'complete', closedAt: null };
  const closed = entry({ entityType: 'salary_period', action: 'close', beforeSnapshot: period, afterSnapshot: { ...period, status: 'closed', closedAt: '2026-10-19T12:29:02.969Z', reason: 'batch 8 posted' } });
  assert.deepEqual(rows(auditChanges(closed, format)), [['Status', 'Open', 'Closed'], ['Closed', '—', '2026-10-19T12:29']]);
  assert.equal(auditReason(closed), 'batch 8 posted');
  assert.deepEqual([entityLabel('salary_period'), actionLabel('close'), auditKind('close')], ['Period', 'Closed', 'step']);
  assert.deepEqual([actionLabel('some_new_step'), entityLabel('new_thing')], ['Some new step', 'New thing']);
});

test('an add lists what was recorded, skipping empty and bookkeeping fields', () => {
  const added = entry({ entityType: 'loan', action: 'create', afterSnapshot: { loan: { id: 15, direction: 'lent', amountCents: 17100, dueDate: null, description: 'Bakmi share', walletAccountId: 3 }, transactionId: 1476 } });
  assert.deepEqual(rows(auditChanges(added, format)), [
    ['Direction', '—', 'Lent'],
    ['Amount', '—', 'Rp17100'],
    ['Description', '—', 'Bakmi share'],
    ['Wallet', '—', 'BNI'],
  ]);
  assert.equal(auditKind('create'), 'added');
});

test('a removal lists what the record held before it went', () => {
  const removed = entry({ entityType: 'category', action: 'delete', beforeSnapshot: { id: 7, name: 'Fashion', color: '#6C757D' } });
  const changes = auditChanges(removed, format);
  assert.deepEqual(rows(changes), [['Name', 'Fashion', '—'], ['Colour', '#6C757D', '—']]);
  assert.deepEqual(changes[1].color, { before: '#6C757D', after: null });
  assert.equal(auditKind('delete'), 'removed');
  assert.equal(auditName(removed), 'Fashion');
});

test('tags read as their names', () => {
  const tagged = entry({ beforeSnapshot: { tags: [{ tagId: 19 }] }, afterSnapshot: { tags: [{ tagId: 19 }, { tagId: 11 }] } });
  assert.deepEqual(rows(auditChanges(tagged, format)), [['Tags', 'Trip', 'Trip, Work']]);
  const cleared = entry({ beforeSnapshot: { tags: [{ tagId: 7 }] }, afterSnapshot: { tags: [] } });
  assert.deepEqual(rows(auditChanges(cleared, format)), [['Tags', 'Tag #7', '—']]);
});

test('unknown ids fall back to the kind and number', () => {
  const moved = entry({ beforeSnapshot: { categoryId: 99 }, afterSnapshot: { categoryId: null } });
  assert.deepEqual(rows(auditChanges(moved, format)), [['Category', 'Category #99', '—']]);
  assert.equal(auditName(moved), null);
});
