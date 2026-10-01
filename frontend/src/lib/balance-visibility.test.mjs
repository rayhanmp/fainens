import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HIDDEN_BALANCE, formatPrivateAmount, maskCurrencyAmounts } from './balance-visibility.ts';

test('hidden amounts never render the raw formatter, including zero and negative values', () => {
  for (const value of [0, 1, -125000, 47447402]) {
    assert.equal(formatPrivateAmount(value, true, () => { throw new Error('Raw amount was exposed'); }), HIDDEN_BALANCE);
  }
});

test('showing amounts retains the original amount and currency formatting', () => {
  const formatter = (value, currency) => `${currency} ${value}`;
  assert.equal(formatPrivateAmount(-125000, false, formatter), 'Rp -125000');
  assert.equal(formatPrivateAmount(47447402, false, formatter, 'IDR'), 'IDR 47447402');
});

test('redacts all currency amounts in notification and forecast copy', () => {
  assert.equal(maskCurrencyAmounts('Rp 47.447.402 cash, Rp 0 debt, IDR 250000 due.'), `${HIDDEN_BALANCE} cash, ${HIDDEN_BALANCE} debt, ${HIDDEN_BALANCE} due.`);
  assert.equal(maskCurrencyAmounts('Rp 100.000–Rp 250.000 by 25 Sept.'), `${HIDDEN_BALANCE}–${HIDDEN_BALANCE} by 25 Sept.`);
});

test('masks signed and abbreviated amounts while preserving dates and counts', () => {
  assert.equal(maskCurrencyAmounts('-Rp 25.000, Rp -1.500, Rp 2.5M for 3 loans in 7 days.'), `-${HIDDEN_BALANCE}, ${HIDDEN_BALANCE}, ${HIDDEN_BALANCE} for 3 loans in 7 days.`);
  assert.equal(maskCurrencyAmounts('11 of 11 accounts checked · 25 Sept · 20% used'), '11 of 11 accounts checked · 25 Sept · 20% used');
});
