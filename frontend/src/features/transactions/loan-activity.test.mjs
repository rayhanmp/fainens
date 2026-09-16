import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loanPaymentState, transactionActivityAmount, compactLoanActivityLabel, splitBillActivityRows } from './loan-activity.ts';

const loan = { id: 1, contactName: 'Hilma', direction: 'lent', amountCents: 130900, remainingCents: 130900, status: 'active' };
const transaction = { txType: 'split_bill_lent', expenseCents: 130900, incomeCents: 0, debitCents: 654500, creditCents: 654500 };

test('splits the bill into personal expense and loan advance, preserving total cash', () => {
  const rows = splitBillActivityRows([{ ...transaction, id: 459 }]);
  assert.deepEqual(rows.map((row) => row.displayPart), ['expense', 'loan']);
  assert.deepEqual(rows.map(transactionActivityAmount), [-130900, -523600]);
  assert.equal(rows.reduce((sum, row) => sum + transactionActivityAmount(row), 0), -654500);
  assert.deepEqual(rows.map((row) => row.id), [459, 459]);
  assert.equal(transaction.displayPart, undefined);
});

test('Spending and Loans tabs select only their respective bill allocation', () => {
  assert.deepEqual(splitBillActivityRows([transaction], 'expense').map(transactionActivityAmount), [-130900]);
  assert.deepEqual(splitBillActivityRows([transaction], 'loan').map(transactionActivityAmount), [-523600]);
});

test('repayments remain separate and are not duplicated by split-bill projection', () => {
  const repayment = { ...transaction, txType: 'loan_payment', expenseCents: 0, creditCents: 130900, debitCents: 130900,
    loanActivity: { role: 'payment', loans: [loan], payment: { amountCents: 130900, status: 'posted' } } };
  const rows = splitBillActivityRows([repayment, transaction]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0], repayment);
  assert.equal(transactionActivityAmount(rows[0]), 130900);
});

test('does not create zero-value expense or loan rows', () => {
  assert.deepEqual(splitBillActivityRows([{ ...transaction, expenseCents: 0 }]).map((row) => row.displayPart), ['loan']);
  assert.deepEqual(splitBillActivityRows([{ ...transaction, expenseCents: 654500 }]).map((row) => row.displayPart), ['expense']);
  assert.deepEqual(splitBillActivityRows([{ ...transaction, expenseCents: 0, creditCents: 0 }]), []);
});

test('split bill list label summarizes mixed repayments without individual details', () => {
  assert.equal(compactLoanActivityLabel({ ...transaction, loanActivity: { role: 'origin', loans: [
    { ...loan, status: 'repaid', remainingCents: 0 }, loan, loan, { ...loan, status: 'repaid', remainingCents: 0 },
  ] } }), 'Split bill · 2/4 paid');
});

test('compact labels distinguish unpaid, partially paid and fully paid bills', () => {
  for (const [entry, expected] of [
    [loan, 'Split bill · Unpaid'],
    [{ ...loan, remainingCents: 30900 }, 'Split bill · Partially paid'],
    [{ ...loan, remainingCents: 0, status: 'repaid' }, 'Split bill · Paid'],
  ]) assert.equal(compactLoanActivityLabel({ ...transaction, loanActivity: { role: 'origin', loans: [entry] } }), expected);
});

test('repayment rows use the same short status label, including reversals', () => {
  const repayment = { txType: 'loan_payment', loanActivity: { role: 'payment', loans: [loan], payment: { amountCents: 100000, status: 'posted' } } };
  assert.equal(compactLoanActivityLabel(repayment), 'Repayment · Unpaid');
  assert.equal(compactLoanActivityLabel({ ...repayment, loanActivity: { ...repayment.loanActivity, loans: [{ ...loan, remainingCents: 30900 }] } }), 'Repayment · Partially paid');
  assert.equal(compactLoanActivityLabel({ ...repayment, loanActivity: { ...repayment.loanActivity, payment: { amountCents: 100000, status: 'reversed' } } }), 'Repayment reversed');
});

test('compact labels do not mislabel cancelled, defaulted or written-off balances', () => {
  assert.equal(compactLoanActivityLabel({ ...transaction, loanActivity: { role: 'origin', loans: [loan, { ...loan, status: 'cancelled' }] } }), 'Split bill · Mixed status');
  assert.equal(compactLoanActivityLabel({ txType: 'loan_lending', loanActivity: { role: 'origin', loans: [{ ...loan, status: 'written_off', remainingCents: 0 }] } }), 'Loan · Written off');
  assert.equal(compactLoanActivityLabel({ txType: 'loan_payment' }), 'Repayment');
});

test('split bill shows the full wallet outflow without changing its personal expense', () => {
  assert.equal(transactionActivityAmount(transaction), -654500);
  assert.equal(transaction.expenseCents, 130900);
});

test('loan creation shows outgoing lending and incoming borrowing', () => {
  for (const [direction, expected] of [['lent', -654500], ['borrowed', 654500]]) {
    assert.equal(transactionActivityAmount({ ...transaction, txType: 'loan_lending', expenseCents: 0,
      loanActivity: { role: 'origin', loans: [{ ...loan, direction }] } }), expected);
  }
});

test('partial repayment shows actual incoming cash, not the original debt amount', () => {
  assert.equal(transactionActivityAmount({ ...transaction, txType: 'loan_payment', expenseCents: 0,
    loanActivity: { role: 'payment', loans: [{ ...loan, remainingCents: 30900 }], payment: { amountCents: 100000, status: 'posted' } } }), 100000);
});

test('borrowed-loan repayment shows outgoing cash', () => {
  assert.equal(transactionActivityAmount({ ...transaction, txType: 'loan_payment', expenseCents: 0,
    loanActivity: { role: 'payment', loans: [{ ...loan, direction: 'borrowed' }], payment: { amountCents: 100000, status: 'posted' } } }), -100000);
});

test('full repayment stays visible after the loan becomes paid', () => {
  const paidLoan = { ...loan, remainingCents: 0, status: 'repaid' };
  assert.equal(loanPaymentState(paidLoan), 'Paid');
  assert.equal(transactionActivityAmount({ ...transaction, txType: 'loan_payment', expenseCents: 0,
    loanActivity: { role: 'payment', loans: [paidLoan], payment: { amountCents: 130900, status: 'posted' } } }), 130900);
});

test('payment labels distinguish unpaid, partial and paid loans', () => {
  assert.equal(loanPaymentState(loan), 'Unpaid');
  assert.equal(loanPaymentState({ ...loan, remainingCents: 30900 }), 'Partially paid');
  assert.equal(loanPaymentState({ ...loan, remainingCents: 0 }), 'Paid');
});

test('cancelled and written-off loans are not mislabelled paid', () => {
  assert.equal(loanPaymentState({ ...loan, status: 'cancelled', remainingCents: 0 }), 'Cancelled');
  assert.equal(loanPaymentState({ ...loan, status: 'written_off', remainingCents: 0 }), 'Written off');
  assert.equal(loanPaymentState({ ...loan, status: 'defaulted' }), 'Defaulted');
});

test('ordinary expenses and income keep their signed reporting amounts', () => {
  assert.equal(transactionActivityAmount({ ...transaction, txType: 'simple_expense' }), -130900);
  assert.equal(transactionActivityAmount({ ...transaction, txType: 'simple_income', expenseCents: 0, incomeCents: 200000 }), 200000);
});
