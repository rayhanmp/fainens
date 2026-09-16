import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSavedSplitShares, parseSavedSplitItems, splitBillOutstandingAmount, splitLoanStatusLabel } from './split-bill-detail.ts';

test('reads a saved split without inventing tax/item details', () => {
  const shares = parseSavedSplitShares(JSON.stringify([
    { personId: 0, personName: 'Personal share', total: 130900 },
    { personId: 42, personName: 'Hilma', total: 130900 },
  ]));
  assert.equal(shares.length, 2);
  assert.equal(shares[1].personId, 42);
  assert.equal(shares[1].taxShare, undefined);
  assert.deepEqual(shares[1].assignedItems, []);
});

test('preserves saved tax and assigned items, rejects unsafe optional amounts', () => {
  const [share] = parseSavedSplitShares(JSON.stringify([{ personId: 42, personName: 'Hilma', total: 130900,
    subtotal: 119000, taxShare: 11900, serviceShare: 'not a number', assignedItems: [
      { name: 'Grill', quantity: 1, totalPrice: 119000 }, { name: 'Invalid', quantity: 1, totalPrice: -1 },
    ],
  }]));
  assert.equal(share.taxShare, 11900);
  assert.equal(share.serviceShare, undefined);
  assert.deepEqual(share.assignedItems, [{ name: 'Grill', quantity: 1, totalPrice: 119000 }]);
});

test('missing, malformed and invalid saved results do not crash details', () => {
  for (const json of [null, '', '{broken', '{}', '[null,{},42]', '[{"personId":1,"personName":"Hilma","total":-1}]']) {
    assert.deepEqual(parseSavedSplitShares(json), []);
    assert.deepEqual(parseSavedSplitItems(json), []);
  }
});

test('validates receipt items before showing amounts', () => {
  assert.deepEqual(parseSavedSplitItems('[{"name":"Grill","quantity":5,"totalPrice":595000},{"name":"Invalid","quantity":0,"totalPrice":1}]'),
    [{ name: 'Grill', quantity: 5, totalPrice: 595000 }]);
});

test('outstanding totals include partial repayments but exclude closed loans', () => {
  assert.equal(splitBillOutstandingAmount([
    { status: 'active', remainingCents: 30900 }, { status: 'defaulted', remainingCents: 130900 },
    { status: 'repaid', remainingCents: 0 }, { status: 'cancelled', remainingCents: 130900 },
    { status: 'written_off', remainingCents: 130900 },
  ]), 161800);
  assert.equal(splitBillOutstandingAmount([]), 0);
});

test('closed loans are not shown as outstanding', () => {
  for (const status of ['repaid', 'cancelled', 'written_off', 'defaulted']) {
    assert.notEqual(splitLoanStatusLabel(status), 'Outstanding');
  }
});
