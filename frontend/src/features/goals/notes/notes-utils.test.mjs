import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checklistCount, fromIsoDate, isoDate, parseAmounts, parseDateInput, readableMarkdown, sumAmounts } from './notes-utils.ts';

test('amounts written the Indonesian way are read and added up', () => {
  assert.deepEqual(parseAmounts('Hotel Rp1.400.000 a night, food Rp 250rb, JR Pass 3,5 jt, souvenirs 500k'), [1_400_000, 250_000, 3_500_000, 500_000]);
  assert.deepEqual(parseAmounts('4 nights from 14 Mar 2027, room 1203'), []);
  assert.equal(sumAmounts('Rp1,4 juta + Rp600.000'), 2_000_000);
  assert.equal(sumAmounts('Rp 2 miliar'), 2_000_000_000);
});

test('checklist items are counted, ticked ones apart', () => {
  assert.deepEqual(checklistCount('- [x] Flights\n- [ ] Visa\n  - [X] Photo\n* [ ] Pack\n- not a task'), { done: 2, total: 4 });
});

test('a typed date is read, the next one when no year is given', () => {
  const now = new Date(2026, 9, 21);
  assert.equal(isoDate(parseDateInput('today', now)), '2026-10-21');
  assert.equal(isoDate(parseDateInput('besok', now)), '2026-10-22');
  assert.equal(isoDate(parseDateInput('in 3 days', now)), '2026-10-24');
  assert.equal(isoDate(parseDateInput('14 mar', now)), '2027-03-14');
  assert.equal(isoDate(parseDateInput('dec 1', now)), '2026-12-01');
  assert.equal(isoDate(parseDateInput('17 agustus', now)), '2027-08-17');
  assert.equal(isoDate(parseDateInput('25/12', now)), '2026-12-25');
  assert.equal(isoDate(parseDateInput('1/2/28', now)), '2028-02-01');
  assert.equal(isoDate(parseDateInput('2027-03-14', now)), '2027-03-14');
  assert.equal(parseDateInput('31 feb', now), null);
  assert.equal(parseDateInput('soon', now), null);
  assert.equal(isoDate(fromIsoDate('2027-03-14')), '2027-03-14');
});

test('notes read as plain markdown, their own tags turned into words, links and pictures', () => {
  const stored = 'Book <span data-goal-ref="part:3">Flights</span> by <span data-date="2027-01-10">10 Jan 2027</span> <mark data-color="#fef08a" style="background-color: #fef08a">soon</mark>\n\n<div data-link-card="" data-href="https://example.com/a?b=1&amp;c=2" data-title="Ryokan &quot;Sakura&quot;"><a href="https://example.com/a">x</a></div>\n\n<img src="/api/goal-attachments/4/file" alt="map" data-size="small">';
  assert.equal(readableMarkdown(stored), 'Book Flights by 10 Jan 2027 soon\n\n[Ryokan "Sakura"](https://example.com/a?b=1&c=2)\n\n![map](/api/goal-attachments/4/file)');
});
