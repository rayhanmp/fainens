import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_BAG, guessCategory, starterList } from './packing.ts';

test('an item’s kind is guessed from its name, in English or Indonesian', () => {
  assert.equal(guessCategory('Passport copies'), 'documents');
  assert.equal(guessCategory('Kabel charger'), 'electronics');
  assert.equal(guessCategory('Obat flu'), 'medicine');
  assert.equal(guessCategory('Sikat gigi'), 'toiletries');
  assert.equal(guessCategory('Kaus kaki'), 'clothes');
  assert.equal(guessCategory('Snacks'), 'other');
});

test('a starter list fits the weather, the length of the trip and what you’ll do', () => {
  const list = starterList({ climate: 'cold', activities: ['snow'], days: 7, travellers: [{ id: 1 }, { id: 2 }], existing: [] });
  const find = (text, travellerId) => list.find((item) => item.text === text && item.travellerId === travellerId);
  // Socks for every day, up to eight; a few tops to wear again.
  assert.equal(find('Socks', 1).quantity, 8);
  assert.equal(find('Long-sleeved tops', 2).quantity, 5);
  assert.ok(find('Warm coat', 1));
  assert.ok(find('Snow boots', 2));
  assert.ok(!list.some((item) => item.text === 'Sandals'));
  // Shared things once, for the group, in the bag they usually go in.
  assert.equal(list.filter((item) => item.text === 'Plug adapter').length, 1);
  assert.equal(find('Plug adapter', null).bag, 'carry-on');
  assert.equal(find('Passport', 1).bag, DEFAULT_BAG.documents);
  assert.equal(find('Warm coat', 1).bag, null);
});

test('a short warm trip with a beach day, and nothing twice', () => {
  const list = starterList({ climate: 'warm', activities: ['beach'], days: 2, travellers: [], existing: [{ text: 'passport', travellerId: null }] });
  assert.equal(list.find((item) => item.text === 'Underwear').quantity, 3);
  assert.ok(list.some((item) => item.text === 'Swimwear' && item.quantity === 2));
  assert.ok(!list.some((item) => item.text === 'Passport'));
  assert.ok(list.every((item) => item.travellerId === null));
});
