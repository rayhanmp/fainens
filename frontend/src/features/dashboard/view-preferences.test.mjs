import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyDashboardPreset, dashboardPreset, dashboardSectionIds, dashboardSectionRows, dashboardSectionSize, dashboardSectionWidth, dashboardViewStorageKey, mergeDashboardViewChange, moveDashboardSection, parseDashboardViewPreferences, resetDashboardLayout, resizeDashboardSection, selectedDashboardPreset, usesOriginalDashboardSections } from './view-preferences.ts';

test('missing or corrupt preferences restore the original dashboard', () => {
  for (const raw of [null, '', '{bad', 'null', '42', '[]']) {
    assert.deepEqual(parseDashboardViewPreferences(raw), dashboardPreset('original'));
  }
});

test('partial preferences keep the user order and add missing sections safely', () => {
  const parsed = parseDashboardViewPreferences(JSON.stringify({
    mainMetric: 'cash', sectionOrder: ['activity', 'old', 'activity', null, 'payments'],
    hiddenSections: ['pulse', 'pulse', 'old'], compact: true,
  }));
  assert.deepEqual(parsed, {
    mainMetric: 'cash', sectionOrder: ['activity', 'payments', 'budget', 'netWorth', 'spending', 'pulse'],
    hiddenSections: ['pulse'], sectionSizes: {}, pulseMetrics: ['cashFlow', 'savingsRate', 'burn', 'runway'],
  });
});

test('saved pulse metrics survive storage and presets, and bad entries fall back to defaults', () => {
  const custom = { ...dashboardPreset('original'), pulseMetrics: ['netWorth', 'daysLeft', 'income', 'debt'] };
  assert.deepEqual(parseDashboardViewPreferences(JSON.stringify(custom)).pulseMetrics, ['netWorth', 'daysLeft', 'income', 'debt']);
  assert.deepEqual(applyDashboardPreset(custom, 'overview').pulseMetrics, custom.pulseMetrics);
  assert.equal(selectedDashboardPreset(custom), 'original');
  assert.deepEqual(parseDashboardViewPreferences(JSON.stringify({ pulseMetrics: ['runway', 'runway', 'bogus', 7] })).pulseMetrics, ['runway', 'cashFlow']);
  assert.deepEqual(parseDashboardViewPreferences(JSON.stringify({ pulseMetrics: 'cashFlow' })).pulseMetrics, ['cashFlow', 'savingsRate', 'burn', 'runway']);
});

test('legacy compact preferences are discarded while preserving the saved layout', () => {
  const custom = resizeDashboardSection(moveDashboardSection(dashboardPreset('everyday'), 'activity', 'budget'), 'activity', 'full');
  const migrated = parseDashboardViewPreferences(JSON.stringify({ ...custom, compact: true }));
  assert.deepEqual(migrated, custom);
  assert.equal('compact' in migrated, false);
  const minimal = parseDashboardViewPreferences(JSON.stringify({ ...dashboardPreset('minimal'), compact: true }));
  assert.equal(selectedDashboardPreset(minimal), 'minimal');
});

test('old preferences migrate without changing the original card widths', () => {
  const old = dashboardPreset('original');
  delete old.sectionSizes;
  const migrated = parseDashboardViewPreferences(JSON.stringify(old));
  assert.equal(selectedDashboardPreset(migrated), 'original');
  assert.equal(dashboardSectionSize(migrated, 'netWorth'), 'wide');
  assert.equal(dashboardSectionSize(migrated, 'pulse'), 'full');
});

test('stored widths accept grid sizes and ignore unknown or invalid values', () => {
  const parsed = parseDashboardViewPreferences(JSON.stringify({ sectionSizes: {
    netWorth: 'full', spending: 'wide', budget: 'wide', pulse: 'huge', activity: 2, unknown: 'full',
  } }));
  assert.deepEqual(parsed.sectionSizes, { netWorth: 'full', spending: 'wide' });
  for (const value of [null, [], 'full']) {
    assert.deepEqual(parseDashboardViewPreferences(JSON.stringify({ sectionSizes: value })).sectionSizes, {});
  }
});

test('resizing survives storage and returning to the default restores its preset', () => {
  const original = dashboardPreset('original');
  const resized = resizeDashboardSection(original, 'netWorth', 'full');
  assert.equal(selectedDashboardPreset(resized), 'custom');
  assert.equal(dashboardSectionSize(parseDashboardViewPreferences(JSON.stringify(resized)), 'netWorth'), 'full');
  assert.deepEqual(original.sectionSizes, {});
  assert.equal(selectedDashboardPreset(resizeDashboardSection(resized, 'netWorth', 'wide')), 'original');
});

test('resize previews match the resulting grid, including the neighbour changing width', () => {
  const original = dashboardPreset('original');
  assert.deepEqual(dashboardSectionRows(original), [['pulse'], ['netWorth', 'spending'], ['budget', 'activity']]);
  assert.equal(dashboardSectionWidth(original, 'netWorth', 1100, 20), 720);
  assert.equal(dashboardSectionWidth(original, 'spending', 1100, 20), 360);
  const small = resizeDashboardSection(original, 'netWorth', 'small');
  assert.equal(dashboardSectionWidth(small, 'netWorth', 1100, 20), 540);
  assert.equal(dashboardSectionWidth(small, 'spending', 1100, 20), 540);
  const full = resizeDashboardSection(original, 'netWorth', 'full');
  assert.equal(dashboardSectionWidth(full, 'netWorth', 1100, 20), 1100);
  assert.deepEqual(dashboardSectionRows(full), [['pulse'], ['netWorth'], ['spending', 'budget'], ['activity']]);
  const narrowPulse = resizeDashboardSection(original, 'pulse', 'small');
  assert.equal(dashboardSectionWidth(narrowPulse, 'pulse', 1100, 20), 360);
  assert.equal(dashboardSectionWidth(dashboardPreset('minimal'), 'activity', 1100, 20), 1100);
});

test('moving visible sections retains hidden sections and other preferences', () => {
  const original = dashboardPreset('everyday');
  const moved = moveDashboardSection(original, 'activity', 'budget');
  assert.deepEqual(moved.sectionOrder, ['activity', 'budget', 'payments', 'netWorth', 'spending', 'pulse']);
  assert.deepEqual(moved.hiddenSections, original.hiddenSections);
  assert.equal(moved.mainMetric, original.mainMetric);
  assert.equal(moveDashboardSection(original, 'budget', 'pulse'), original);
  assert.equal(moveDashboardSection(original, 'budget', 'budget'), original);
  assert.deepEqual(moveDashboardSection(moved, 'activity', 'payments').sectionOrder, ['budget', 'payments', 'activity', 'netWorth', 'spending', 'pulse']);
});

test('layout reset restores order and widths while keeping metric and visibility', () => {
  const custom = resizeDashboardSection(moveDashboardSection(dashboardPreset('everyday'), 'activity', 'budget'), 'activity', 'full');
  const reset = resetDashboardLayout(custom);
  assert.deepEqual(reset.sectionOrder, dashboardPreset('original').sectionOrder);
  assert.deepEqual(reset.sectionSizes, {});
  assert.deepEqual(reset.hiddenSections, custom.hiddenSections);
  assert.equal(reset.mainMetric, custom.mainMetric);
});

test('invalid fields do not discard valid choices', () => {
  const parsed = parseDashboardViewPreferences('{"mainMetric":"old","compact":"yes","hiddenSections":[]}');
  assert.equal(parsed.mainMetric, 'cash');
  assert.equal('compact' in parsed, false);
  assert.deepEqual(parsed.hiddenSections, []);
});

test('a saved all-hidden dashboard still shows recent activity', () => {
  const parsed = parseDashboardViewPreferences(JSON.stringify({ hiddenSections: dashboardSectionIds }));
  assert.equal(parsed.hiddenSections.length, dashboardSectionIds.length - 1);
  assert.equal(parsed.hiddenSections.includes('activity'), false);
});

test('presets round-trip and independently own their mutable arrays', () => {
  for (const preset of ['original', 'everyday', 'overview', 'minimal']) {
    const preferences = dashboardPreset(preset);
    assert.equal(selectedDashboardPreset(parseDashboardViewPreferences(JSON.stringify(preferences))), preset);
    preferences.sectionOrder.reverse();
    assert.equal(selectedDashboardPreset(dashboardPreset(preset)), preset);
    assert.equal(selectedDashboardPreset(preferences), 'custom');
  }
});

test('preferences have separate storage keys per user', () => {
  assert.notEqual(dashboardViewStorageKey('ray@example.com'), dashboardViewStorageKey('other@example.com'));
  assert.equal(dashboardViewStorageKey('ray@example.com'), dashboardViewStorageKey('ray@example.com'));
});

test('changing the mobile balance preserves the original desktop sections', () => {
  const original = dashboardPreset('original');
  const mobile = { ...original, hiddenSections: original.sectionOrder.filter(id => id !== 'activity') };
  const next = mergeDashboardViewChange(original, mobile, { ...mobile, mainMetric: 'budget' });
  assert.equal(next.mainMetric, 'budget');
  assert.deepEqual(next.hiddenSections, ['payments']);
  assert.deepEqual(next.sectionOrder, original.sectionOrder);
});

test('explicit section choices and new presets apply from the mobile menu', () => {
  const original = dashboardPreset('original');
  const mobile = { ...original, hiddenSections: original.sectionOrder.filter(id => id !== 'activity') };
  const next = { ...mobile, hiddenSections: mobile.hiddenSections.filter(id => id !== 'budget') };
  assert.deepEqual(mergeDashboardViewChange(original, mobile, next), next);
  assert.deepEqual(mergeDashboardViewChange(original, mobile, dashboardPreset('minimal')), dashboardPreset('minimal'));
});

test('only the original panel arrangement counts as original sections', () => {
  const original = dashboardPreset('original');
  assert.equal(usesOriginalDashboardSections(original), true);
  assert.equal(usesOriginalDashboardSections({ ...original, mainMetric: 'netWorth', sectionSizes: { budget: 'full' } }), true);
  const reordered = moveDashboardSection(original, 'activity', 'pulse');
  assert.deepEqual(reordered.hiddenSections, ['payments']);
  assert.equal(usesOriginalDashboardSections(reordered), false);
  assert.equal(usesOriginalDashboardSections(dashboardPreset('overview')), false);
});
