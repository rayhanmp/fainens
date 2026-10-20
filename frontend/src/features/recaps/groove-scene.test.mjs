import assert from 'node:assert/strict';
import { test } from 'node:test';
import { grooveScene, PERSONA_THEME_PACKS, SOUND_PACKS } from './motion.ts';

test('the music follows the story', () => {
  assert.deepEqual(grooveScene({ id: 'intro' }, false), { energy: 1, mood: 'bright' });
  assert.deepEqual(grooveScene({ id: 'categories' }, false), { energy: 2, mood: 'bright' });
  assert.deepEqual(grooveScene({ id: 'persona', persona: { key: 'weekend' } }, false), { energy: 3, mood: 'bright', pack: 'disco' });
  assert.equal(grooveScene({ id: 'interlude', variant: 'ejected' }, false).energy, 0);
});

test('a game waiting for an answer hushes everything to the keys', () => {
  assert.deepEqual(grooveScene({ id: 'persona', persona: { key: 'monk' } }, true), { energy: 0, mood: 'dark' });
});

test('the chords turn minor only where the figures do', () => {
  assert.equal(grooveScene({ id: 'overview', net: -1 }, false).mood, 'dark');
  assert.equal(grooveScene({ id: 'overview', net: 5 }, false).mood, 'bright');
  assert.equal(grooveScene({ id: 'budget', remaining: -10 }, false).mood, 'dark');
  assert.equal(grooveScene({ id: 'comparison', change: 40 }, false).mood, 'bright');
});

test('every personality theme is a pack the engine has', () => {
  for (const pack of Object.values(PERSONA_THEME_PACKS)) assert.ok(SOUND_PACKS.includes(pack), pack);
});
