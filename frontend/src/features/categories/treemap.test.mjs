import assert from 'node:assert/strict';
import { test } from 'node:test';
import { squarify } from './treemap.ts';

test('tiles fill the box and each area follows its value', () => {
  const values = [600, 300, 200, 100, 50];
  const rects = squarify(values, 160, 90);
  const total = values.reduce((sum, value) => sum + value, 0);
  const area = (rect) => rect.w * rect.h;
  assert.equal(rects.length, values.length);
  assert.ok(Math.abs(rects.reduce((sum, rect) => sum + area(rect), 0) - 160 * 90) < 1e-6);
  rects.forEach((rect, index) => assert.ok(Math.abs(area(rect) - (values[index] / total) * 160 * 90) < 1e-6));
  for (const rect of rects) {
    assert.ok(rect.x >= -1e-9 && rect.y >= -1e-9 && rect.x + rect.w <= 160 + 1e-9 && rect.y + rect.h <= 90 + 1e-9);
  }
});

test('nothing to lay out gives empty tiles', () => {
  assert.deepEqual(squarify([0, 0], 10, 10), [{ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 0, h: 0 }]);
});
