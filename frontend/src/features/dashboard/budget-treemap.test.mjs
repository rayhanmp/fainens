import assert from 'node:assert/strict';
import { test } from 'node:test';
import { squarify } from './budget-treemap.ts';

const close = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;

test('tiles cover the whole area in proportion to their values and stay inside the bounds', () => {
  const items = [{ key: 'a', value: 6 }, { key: 'b', value: 6 }, { key: 'c', value: 4 }, { key: 'd', value: 3 }, { key: 'e', value: 2 }, { key: 'f', value: 2 }, { key: 'g', value: 1 }];
  const tiles = squarify(items, 600, 400);
  assert.equal(tiles.length, items.length);
  const total = tiles.reduce((acc, tile) => acc + tile.width * tile.height, 0);
  assert.ok(close(total, 600 * 400, 1e-3));
  for (const tile of tiles) {
    const item = items.find((candidate) => candidate.key === tile.key);
    assert.ok(close(tile.width * tile.height, (item.value / 24) * 600 * 400, 1e-3), `${tile.key} area`);
    assert.ok(tile.x >= -1e-6 && tile.y >= -1e-6 && tile.x + tile.width <= 600 + 1e-6 && tile.y + tile.height <= 400 + 1e-6, `${tile.key} bounds`);
    assert.ok(tile.width > 0 && tile.height > 0);
  }
});

test('tiles never overlap', () => {
  const tiles = squarify(Array.from({ length: 9 }, (_, index) => ({ key: `k${index}`, value: index + 1 })), 300, 300);
  for (const a of tiles) {
    for (const b of tiles) {
      if (a === b) continue;
      const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      assert.ok(overlap <= 1e-6 || overlapY <= 1e-6, `${a.key} overlaps ${b.key}`);
    }
  }
});

test('rows stay reasonably square and the layout drops empty values', () => {
  const tiles = squarify([{ key: 'big', value: 10 }, { key: 'none', value: 0 }, { key: 'neg', value: -3 }, { key: 'small', value: 1 }], 400, 200);
  assert.deepEqual(tiles.map((tile) => tile.key).sort(), ['big', 'small']);
  for (const tile of tiles) assert.ok(Math.max(tile.width / tile.height, tile.height / tile.width) < 6, `${tile.key} too thin`);
  assert.deepEqual(squarify([], 100, 100), []);
  assert.deepEqual(squarify([{ key: 'a', value: 1 }], 0, 100), []);
});
