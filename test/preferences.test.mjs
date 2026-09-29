import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Preferences,
  resolvePreference,
  plannedPlacements,
  songKey,
} from '../app/core/preferences.mjs';
import { reviewScan } from '../app/core/review.mjs';
import { demoScan, demoCatalog } from '../app/lib/demo.js';
function fixture() {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const group = reviewScan(demoScan()).groups.find((group) => group.tracks.length > 1);
  return { values, storage, group, preferences: new Preferences(storage) };
}
test('there is no preferred version until explicitly saved; saved choice resolves immediately and survives a new store', () => {
  const { preferences, storage, group } = fixture();
  assert.equal(preferences.get('account', group), null);
  const target = group.tracks[1];
  preferences.save('account', group, target);
  assert.equal(
    resolvePreference(group, preferences.get('account', group), group.tracks).target.id,
    target.id,
  );
  assert.equal(new Preferences(storage).get('account', group).trackId, target.id);
});
test('preferences are scoped by account and demo; forgetting removes only the requested preference', () => {
  const { preferences, group } = fixture();
  preferences.save('account-a', group, group.tracks[0]);
  assert.equal(preferences.get('account-b', group), null);
  assert.equal(preferences.get('sample', group), null);
  preferences.save('account-b', group, group.tracks[1]);
  preferences.remove('account-a', group);
  assert.equal(preferences.get('account-a', group), null);
  assert.equal(preferences.get('account-b', group).trackId, group.tracks[1].id);
});
test('changed group membership does not lose a song preference, and missing exact IDs never pick a substitute', () => {
  const { preferences, group } = fixture();
  preferences.save('account', group, group.tracks[0]);
  const changed = { ...group, tracks: [group.tracks[1], group.tracks[2]] };
  assert.equal(songKey(group), songKey(changed));
  assert.equal(
    resolvePreference(changed, preferences.get('account', changed), changed.tracks).status,
    'missing',
  );
});
test('unavailable, relinked, excluded, different-artist and contradictory candidates are blocked', () => {
  const { preferences, group } = fixture();
  const target = group.tracks[0];
  for (const extra of [
    { playable: false },
    { relinked: true },
    { title: 'Paper Satellites (Acoustic)' },
    { artists: [{ id: 'other', name: 'Other' }] },
    { durationMs: 999999 },
  ]) {
    const candidate = { ...target, ...extra };
    assert.throws(() => preferences.save('account', group, candidate));
    assert.equal(
      resolvePreference(group, { trackId: candidate.id }, [candidate]).status,
      'blocked',
    );
  }
});
test('catalog targets can be remembered only after validation against every scanned track', () => {
  const { preferences, group } = fixture();
  preferences.save('account', group, demoCatalog[3]);
  assert.equal(
    resolvePreference(group, preferences.get('account', group), [...group.tracks, demoCatalog[3]])
      .status,
    'ready',
  );
});
test('corrupt storage never selects a default; storage failures are reported', () => {
  const { storage, group, values } = fixture();
  values.set('trackmark.songPreferences.v1', '{bad');
  assert.equal(new Preferences(storage).get('account', group), null);
  const broken = new Preferences({
    getItem: () => null,
    setItem: () => {
      throw new Error('blocked');
    },
  });
  assert.throws(() => broken.save('account', group, group.tracks[0]), /blocked/);
});
test('review plans preserve repeats and positions, exclude chosen placements, and never mutate input', () => {
  const { group } = fixture();
  group.tracks[1].locations.push({ ...group.tracks[1].locations[0], position: 99 });
  const before = structuredClone(group);
  const changes = plannedPlacements(group, group.tracks[0]);
  assert.equal(changes.length, 3);
  assert.equal(changes.filter((item) => item.fromTrackId === group.tracks[1].id).length, 2);
  assert.ok(changes.some((item) => item.position === 99));
  assert.ok(
    changes.every(
      (item) => item.toTrackId === group.tracks[0].id && item.fromTrackId !== group.tracks[0].id,
    ),
  );
  assert.deepEqual(group, before);
  assert.throws(() => plannedPlacements(group, null));
});
test('overlapping, invalid and missing placements stop plan preparation', () => {
  const { group } = fixture();
  for (const locations of [
    [],
    [{ playlistId: 'p', position: 0 }],
    [group.tracks[0].locations[0]],
  ]) {
    const broken = structuredClone(group);
    broken.tracks[1].locations = locations;
    assert.throws(() => plannedPlacements(broken, broken.tracks[0]));
  }
});
