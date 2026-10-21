import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KNOWN_PLACES, guessClimate, guessText, normalsFor, suggestPlaces } from './climate.ts';

const noon = (year, month, day) => new Date(year, month, day, 12).getTime();

test('a place is found however it’s typed, by other names or by its country', () => {
  assert.equal(normalsFor('Tokyo')?.name, 'Tokyo');
  assert.equal(normalsFor('Kyoto, Japan')?.name, 'Kyoto');
  assert.equal(normalsFor('Ubud')?.name, 'Bali');
  assert.equal(normalsFor('Mecca')?.name, 'Makkah');
  assert.equal(normalsFor('Ho Chi Minh')?.name, 'Ho Chi Minh City');
  assert.equal(normalsFor('Switzerland')?.name, 'Zurich');
  assert.equal(normalsFor('Atlantis'), null);
});

test('the weather is guessed from the places and the months the trip touches', () => {
  const tokyo = guessClimate(['Tokyo'], noon(2026, 10, 12), noon(2026, 10, 21));
  assert.deepEqual(tokyo, { climate: 'mixed', low: 9, high: 17, places: ['Tokyo'], months: 'Nov' });
  assert.equal(guessText(tokyo), 'usually 9–17°C in Nov');
  assert.equal(guessClimate(['Seoul'], noon(2026, 11, 28), noon(2027, 0, 3))?.climate, 'cold');
  assert.equal(guessClimate(['Seoul'], noon(2026, 11, 28), noon(2027, 0, 3))?.months, 'Dec–Jan');
  assert.equal(guessClimate(['Bangkok', 'Phuket'], noon(2026, 6, 1), noon(2026, 6, 8))?.climate, 'warm');
  // One place much colder than the other: pack for both.
  assert.equal(guessClimate(['Sapporo', 'Bangkok'], noon(2027, 0, 5), noon(2027, 0, 15))?.climate, 'mixed');
  assert.equal(guessClimate(['Atlantis'], noon(2026, 10, 12), null), null);
  assert.equal(guessClimate(['Tokyo'], null, null), null);
});

test('places are suggested by name first, then by country, leaving out ones already added', () => {
  assert.deepEqual(suggestPlaces('ky').map((place) => place.name).slice(0, 1), ['Kyoto']);
  assert.ok(suggestPlaces('japan').every((place) => place.country === 'Japan'));
  assert.ok(!suggestPlaces('', ['Tokyo']).some((place) => place.name === 'Tokyo'));
  assert.deepEqual(suggestPlaces('atlantis'), []);
});

test('every place has twelve months, with lows below highs, and a name of its own', () => {
  assert.equal(new Set(KNOWN_PLACES.map((place) => place.name)).size, KNOWN_PLACES.length);
  for (const { name, high, low } of KNOWN_PLACES) {
    assert.equal(high.length, 12, name);
    assert.equal(low.length, 12, name);
    high.forEach((value, month) => assert.ok(low[month] < value, `${name} ${month}`));
  }
});
