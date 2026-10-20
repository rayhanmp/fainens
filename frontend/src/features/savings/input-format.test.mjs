import assert from 'node:assert/strict';
import { test } from 'node:test';
import { monthInputValue, parseMoneyText, parseMonthInput } from './input-format.ts';

test('money shortcuts', () => {
  assert.equal(parseMoneyText('12.500.000'), 12_500_000);
  assert.equal(parseMoneyText('5jt'), 5_000_000);
  assert.equal(parseMoneyText('1,5 jt'), 1_500_000);
  assert.equal(parseMoneyText('1.5m'), 1_500_000);
  assert.equal(parseMoneyText('500rb'), 500_000);
  assert.equal(parseMoneyText('25K'), 25_000);
  assert.equal(parseMoneyText('1.500rb'), 1_500_000);
  assert.equal(parseMoneyText('2 miliar'), 2_000_000_000);
  assert.equal(parseMoneyText(''), 0);
  assert.equal(parseMoneyText('lots'), null);
});

test('month inputs round-trip', () => {
  assert.equal(monthInputValue(new Date(2031, 0, 15)), '2031-01');
  assert.equal(parseMonthInput('2031-01').getMonth(), 0);
  assert.equal(parseMonthInput('Jan 2031'), null);
});
