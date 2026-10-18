import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TILE_AREA_OFFSET_SHARE, tileValues } from './budget-tile-fit.ts';

test('a soft floor grows small tiles but keeps their order and differences', () => {
  const values = tileValues([{ key: 'fashion', value: 540 }, { key: 'technology', value: 235 }, { key: 'gifts', value: 80 }, { key: 'zero', value: 0 }]);
  const offset = 855 * TILE_AREA_OFFSET_SHARE;
  const byKey = Object.fromEntries(values.map((item) => [item.key, item.value]));
  assert.equal(byKey.gifts, 80 + offset);
  assert.ok(byKey.gifts < byKey.technology && byKey.technology < byKey.fashion);
  assert.equal(byKey.technology - byKey.gifts, 235 - 80);
  assert.equal(byKey.zero, 0);
});

test('items keep their extra fields', () => {
  const [item] = tileValues([{ key: 'a', value: 5, label: 'Gifts' }]);
  assert.equal(item.label, 'Gifts');
});
