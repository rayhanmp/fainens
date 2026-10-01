import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountViewStorageKey, parseAccountViewPreferences } from './view-preferences.ts';

test('missing, corrupt, or obsolete preferences open the grouped list', () => {
  for (const raw of [null, '', '{bad', 'null', '42', '[]', '{"view":"old"}']) {
    assert.deepEqual(parseAccountViewPreferences(raw), { view: 'list', showPinned: true, pinnedAccountIds: [] });
  }
});

test('restores layouts and only valid, unique account IDs in saved order', () => {
  for (const view of ['list', 'grid']) {
    assert.deepEqual(parseAccountViewPreferences(JSON.stringify({
      view, pinnedAccountIds: [7, 2, 7, '3', null, -1, 0, 1.5, 9007199254740992],
    })), { view, showPinned: true, pinnedAccountIds: [7, 2] });
  }
});

test('a bad view does not discard valid pins', () => {
  assert.deepEqual(parseAccountViewPreferences('{"view":"old","pinnedAccountIds":[4]}'), {
    view: 'list', showPinned: true, pinnedAccountIds: [4],
  });
});

test('remembers hidden pins and migrates the former pinned layout to the list', () => {
  assert.deepEqual(parseAccountViewPreferences('{"view":"list","showPinned":false,"pinnedAccountIds":[3]}'), {
    view: 'list', showPinned: false, pinnedAccountIds: [3],
  });
  assert.deepEqual(parseAccountViewPreferences('{"view":"pinned","pinnedAccountIds":[3]}'), {
    view: 'list', showPinned: true, pinnedAccountIds: [3],
  });
});

test('preferences have separate storage keys for separate users', () => {
  assert.notEqual(accountViewStorageKey('ray@example.com'), accountViewStorageKey('other@example.com'));
  assert.equal(accountViewStorageKey('ray@example.com'), accountViewStorageKey('ray@example.com'));
});
