import assert from 'node:assert/strict';
import { test } from 'node:test';
import { personalActivityKind, reallocationCashAmount, reallocationPreview } from './reallocation.ts';

const incoming = { id: 1, date: 1, description: 'Returned donation', reallocationEligibleRole: 'incoming', expenseCents: 0, incomeCents: 500000 };
const outgoing = { id: 2, date: 2, description: 'Replacement donation', reallocationEligibleRole: 'outgoing', expenseCents: 600000, incomeCents: 0 };

test('preview is independent of which entry opens the dialog and counts only the top-up', () => {
  const expected = { matchedAmount: 500000, newSpending: 100000, incomingRemainder: 0 };
  assert.deepEqual(reallocationPreview(incoming, outgoing), expected);
  assert.deepEqual(reallocationPreview(outgoing, incoming), expected);
  assert.deepEqual(reallocationPreview({ ...incoming, incomeCents: 0, expenseCents: -500000 }, outgoing), expected);
});

test('fully excluded entries have no personal income/spending kind while partial entries retain one', () => {
  assert.equal(personalActivityKind({ ...incoming, personalIncomeCents: 0 }), 'other');
  assert.equal(personalActivityKind({ ...outgoing, personalExpenseCents: 0 }), 'other');
  assert.equal(personalActivityKind({ ...outgoing, personalExpenseCents: 100000 }), 'expense');
  assert.equal(personalActivityKind(outgoing), 'expense');
});

test('paired rows keep their full cash amounts and directions', () => {
  const base = { id: 1, counterpartTransactionId: 2, counterpartDescription: 'Other', amount: 500000, reason: 'Historical' };
  assert.equal(reallocationCashAmount({ ...incoming, reallocation: { ...base, role: 'incoming' } }), 500000);
  assert.equal(reallocationCashAmount({ ...outgoing, reallocation: { ...base, role: 'outgoing' } }), -600000);
  assert.equal(reallocationCashAmount(outgoing), null);
});
