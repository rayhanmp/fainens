import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BANKS, categoryFlavour, dayFlavour, FLAVOUR_MARKS } from './flavour.ts';

test('category names, English or Indonesian, land in the right family', () => {
  const cases = {
    'Food & Dining': 'food', 'Makan Siang': 'food', 'Kopi': 'coffee', 'Coffee shops': 'coffee', 'Groceries': 'groceries', 'Belanja Bulanan': 'groceries',
    'Transportation': 'transport', 'Bensin': 'transport', 'Parkir & Tol': 'transport', 'Travel': 'travel', 'Housing & Rent': 'housing', 'Kos': 'housing',
    'Utilities': 'utilities', 'Listrik': 'utilities', 'Healthcare': 'health', 'Entertainment': 'entertainment', 'Subscriptions': 'subscriptions',
    'Shopping': 'shopping', 'Fashion': 'fashion', 'Skincare': 'beauty', 'Education': 'education', 'Hobbies': 'hobbies', 'Savings': 'savings',
    'Bank & Transfer Fees': 'fees', 'Gifts': 'gifts', 'Zakat': 'gifts', 'Pet supplies': 'pets',
  };
  for (const [name, family] of Object.entries(cases)) assert.equal(categoryFlavour(name), family, name);
  for (const name of ['Others', 'Miscellaneous', '', null]) assert.equal(categoryFlavour(name), null, String(name));
});

test('weekdays fold into four moods', () => {
  assert.equal(dayFlavour('Monday'), 'monday');
  assert.equal(dayFlavour('Wednesday'), 'midweek');
  assert.equal(dayFlavour('Friday'), 'friday');
  assert.equal(dayFlavour('Sunday'), 'weekend');
  assert.equal(dayFlavour(null), null);
});

test('every family can fill each of its lines and has a mark', () => {
  for (const [family, bank] of Object.entries(BANKS)) {
    assert.ok(FLAVOUR_MARKS[family], family);
    for (const line of bank.lead) assert.match(line('Kopi', 42), /Kopi.*42%|42%.*Kopi/, family);
    for (const line of bank.star) assert.match(line('Kopi'), /Kopi/, family);
    assert.ok(bank.thing && bank.playlist && bank.eyebrows.length >= 2, family);
  }
});
