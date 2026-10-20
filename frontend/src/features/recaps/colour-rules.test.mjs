import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

// The recap's colour rules, enforced. Each theme has paper, ink, accent and a pop (with on-pop for text on
// it). The paper-side pairs must hold in every theme; the ink-side pairs fail in most themes, so those
// combinations are banned outright in the stylesheets rather than tuned theme by theme.

const here = new URL('.', import.meta.url);
const sheets = ['recaps.css', ...readdirSync(new URL('extra/', here)).filter(name => name.endsWith('.css')).map(name => `extra/${name}`)];
const read = path => readFileSync(new URL(path, here), 'utf8');

const channels = hex => [0, 2, 4].map(i => parseInt(hex.slice(1).padEnd(6, hex.slice(1)).slice(i, i + 2), 16) / 255);
const luminance = hex => channels(hex.length === 4 ? `#${[...hex.slice(1)].map(c => c + c).join('')}` : hex)
  .map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
  .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + .05) / (lo + .05); };

const themes = [...read('recaps.css').matchAll(/\.recap-theme-([\w-]+) \{([^}]*)\}/g)]
  .map(([, name, body]) => ({ name, ...Object.fromEntries([...body.matchAll(/--recap-([\w-]+): (#[0-9a-f]{3,6})/gi)].map(([, key, value]) => [key, value])) }))
  .filter(theme => theme.paper);

test('every theme keeps its own colours apart from the paper', () => {
  assert.ok(themes.length >= 10);
  for (const theme of themes) {
    for (const [a, b, min] of [['ink', 'paper', 4.5], ['accent', 'paper', 3], ['pop', 'paper', 3], ['on-pop', 'pop', 4.5]]) {
      const ratio = contrast(theme[a], theme[b]);
      assert.ok(ratio >= min, `${theme.name}: ${a} on ${b} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
    }
  }
});

// Fills and the text or marks drawn on them, as theme tokens. A rule that sets both is checked.
const token = value => value?.match(/^var\(--recap-(paper|ink|accent|pop|on-pop)\)$/)?.[1] ?? null;
const BANNED = [
  ['ink', 'accent', 'accent on an ink fill disappears on most themes'],
  ['ink', 'pop', 'pop on an ink fill disappears on most themes'],
  ['accent', 'ink', 'ink on an accent fill disappears on most themes'],
  ['pop', 'ink', 'text on a pop fill uses --recap-on-pop'],
  ['pop', 'paper', 'text on a pop fill uses --recap-on-pop'],
  ['pop', 'accent', 'pop and accent sit too close in lightness'],
  ['accent', 'pop', 'pop and accent sit too close in lightness'],
];

test('no stylesheet pairs a fill with a colour that disappears on it', () => {
  const problems = [];
  for (const sheet of sheets) {
    const css = read(sheet).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const value = name => body.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`))?.[1].trim();
      const fill = token(value('background') ?? value('background-color'));
      const ink = token(value('color'));
      if (!fill || !ink) continue;
      const ban = BANNED.find(([f, c]) => f === fill && c === ink);
      if (ban) problems.push(`${sheet} ${selector.trim()}: ${ban[2]}`);
      // Paper on accent only reaches 3:1 in some themes: enough for big type and icons, not for small text.
      const size = Number(value('font-size')?.match(/([\d.]+)cqw/)?.[1] ?? Infinity);
      if (fill === 'accent' && ink === 'paper' && size < 5) problems.push(`${sheet} ${selector.trim()}: small text on an accent fill; use pop with on-pop, or ink with paper`);
    }
  }
  assert.deepEqual(problems, []);
});
