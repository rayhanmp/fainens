import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transactionDisplayAmounts } from './display-amounts.ts';

test('split bill reports only the personal expense, retaining the full payment', () => {
  const amounts = transactionDisplayAmounts([
    { accountType: 'expense', debit: 130900, credit: 0 },
    ...Array.from({ length: 4 }, () => ({ accountType: 'asset', debit: 130900, credit: 0 })),
    { accountType: 'asset', debit: 0, credit: 654500 },
  ]);
  assert.equal(amounts.expenseCents, 130900);
  assert.equal(amounts.totalPaidCents, 654500);
  assert.equal(amounts.totalPaidCents - amounts.expenseCents, 523600);
});

test('ordinary expense stays unchanged', () => {
  const amounts = transactionDisplayAmounts([
    { accountType: 'expense', debit: 50000, credit: 0 },
    { accountType: 'asset', debit: 0, credit: 50000 },
  ]);
  assert.equal(amounts.expenseCents, 50000);
});

test('loan principal repayments are neither new income nor new expense', () => {
  for (const lines of [
    [{ accountType: 'asset', debit: 100000, credit: 0 }, { accountType: 'asset', debit: 0, credit: 100000 }],
    [{ accountType: 'liability', debit: 100000, credit: 0 }, { accountType: 'asset', debit: 0, credit: 100000 }],
  ]) {
    const amounts = transactionDisplayAmounts(lines);
    assert.equal(amounts.expenseCents, 0);
    assert.equal(amounts.incomeCents, 0);
    assert.equal(amounts.journalAmount, 100000);
  }
});

test('sums multiple expense lines and nets expense credits', () => {
  const amounts = transactionDisplayAmounts([
    { accountType: 'expense', debit: 100000, credit: 0 },
    { accountType: 'expense', debit: 20000, credit: 5000 },
    { accountType: 'asset', debit: 0, credit: 115000 },
  ]);
  assert.equal(amounts.expenseCents, 115000);
});

test('income is the net revenue effect, not the wallet amount', () => {
  const amounts = transactionDisplayAmounts([
    { accountType: 'revenue', debit: 10000, credit: 200000 },
    { accountType: 'asset', debit: 250000, credit: 0 },
  ]);
  assert.equal(amounts.incomeCents, 190000);
});

test('transfers retain their journal amount without becoming expenses', () => {
  assert.deepEqual(transactionDisplayAmounts([
    { accountType: 'asset', debit: 50000, credit: 0 },
    { accountType: 'asset', debit: 0, credit: 50000 },
  ]), { expenseCents: 0, incomeCents: 0, totalPaidCents: 50000, journalAmount: 50000 });
});

test('fully advanced bills have zero personal expense', () => {
  const amounts = transactionDisplayAmounts([
    { accountType: 'asset', debit: 654500, credit: 0 },
    { accountType: 'asset', debit: 0, credit: 654500 },
  ]);
  assert.equal(amounts.expenseCents, 0);
});

test('empty journals return finite zero amounts', () => {
  assert.deepEqual(transactionDisplayAmounts([]), {
    expenseCents: 0, incomeCents: 0, totalPaidCents: 0, journalAmount: 0,
  });
});
