import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reviewScan,
  duplicateMatches,
  differingPlacements,
  parseTrackId,
  trackFromSpotify,
} from '../app/core/review.mjs';
import { compareTracks } from '../app/core/matching.mjs';
import { demoScan, demoCatalog } from '../app/lib/demo.js';

test('review preserves every placement, same-ID consistency, live exclusions and uncertainty', () => {
  const scan = demoScan(),
    result = reviewScan(scan);
  const group = result.groups.find((group) => group.tracks[0].title === 'Paper Satellites');
  assert.equal(group.tracks.length, 3);
  assert.equal(group.tracks.flatMap((track) => track.locations).length, 3);
  assert.equal(
    result.groups.find((group) => group.tracks[0].title === 'Harbor Lights').tracks.length,
    1,
  );
  assert.equal(result.liveExcluded, 1);
  assert.equal(result.uncertain.length, 0);
  assert.equal(result.distinctVersionsExcluded, 1);
  assert.ok(
    !result.tracks.some((track) =>
      track.locations.some((location) => location.playlistId === 'demo-shared'),
    ),
  );
});
test('a choice changes only differing placements and leaves repeated chosen entries alone', () => {
  const group = reviewScan(demoScan()).groups.find((group) => group.tracks.length > 1);
  const target = group.tracks[0];
  const changes = differingPlacements(group, target.id);
  assert.equal(changes.length, 2);
  assert.ok(changes.every((change) => change.from.id !== target.id));
  assert.deepEqual(differingPlacements(group, null), []);
});
test('duplicate check recognizes alternate IDs and reports destination freshness', () => {
  const playlist = demoScan().playlists[0];
  const result = duplicateMatches(demoCatalog[2], playlist);
  assert.equal(result.checked, true);
  assert.equal(result.matches.length, 2);
  assert.equal(result.checkedAt, playlist.scannedAt);
  assert.equal(
    duplicateMatches(demoCatalog[0], { status: 'inaccessible', placements: [] }).checked,
    false,
  );
});
test('duplicate check can warn about an identical live ID without offering consistency replacements', () => {
  const playlist = demoScan().playlists[0],
    live = playlist.placements.find((entry) => entry.position === 30).track;
  const result = duplicateMatches(live, playlist);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].exact, true);
});
test('track parsing rejects foreign hosts, albums and malformed IDs', () => {
  const id = '1234567890123456789012';
  assert.equal(parseTrackId(`spotify:track:${id}`), id);
  assert.equal(parseTrackId(`https://open.spotify.com/intl-fr/track/${id}?si=test`), id);
  for (const value of [
    `https://evil.example/track/${id}`,
    `spotify:album:${id}`,
    'spotify:track:short',
  ])
    assert.equal(parseTrackId(value), null);
});
test('Spotify metadata adaptation handles missing fields without inventing explicit status', () => {
  const track = trackFromSpotify({ id: 'a', name: 'Song', type: 'track' });
  assert.equal(track.isrc, undefined);
  assert.equal(track.explicit, undefined);
  assert.equal(track.durationMs, undefined);
});

test('distinct labeled versions do not appear as related recording suggestions', () => {
  const result = reviewScan(demoScan());
  assert.equal(result.uncertain.length, 0);
  assert.equal(result.uncertainSongs.length, 0);
  assert.ok(
    !result.groups.some((group) =>
      group.tracks.some((track) => track.title.includes('Re-recorded')),
    ),
  );
  assert.equal(result.groups.find((group) => group.tracks.length > 1).tracks.length, 3);
});
test('relinked source IDs are retained and different original IDs do not become an automatic match', () => {
  const first = trackFromSpotify({
    id: 'returned',
    name: 'Song',
    duration_ms: 100000,
    external_ids: { isrc: 'code' },
    artists: [{ id: 'a', name: 'Artist' }],
    linked_from: { id: 'original' },
  });
  assert.equal(first.id, 'original');
  assert.equal(first.returnedId, 'returned');
  assert.equal(first.relinked, true);
  assert.equal(
    compareTracks(first, { ...first, id: 'other-original', relinked: false }).outcome,
    'review',
  );
});
