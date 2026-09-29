import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareTracks,
  groupTracks,
  normalizeTitle,
  versionLabels,
} from '../app/core/matching.mjs';

const track = (id, overrides = {}) => ({
  id,
  title: 'Midnight Rain',
  artists: [{ id: 'artist-1', name: 'A. Singer' }],
  durationMs: 174000,
  isrc: 'USAAA2400001',
  album: 'Example Album',
  ...overrides,
});

test('normalizes punctuation and Unicode without removing version language', () => {
  assert.equal(normalizeTitle('  Don’t Stop! '), 'dont stop');
  assert.deepEqual(versionLabels(track('a', { title: 'Song (Live Acoustic)' })), [
    'acoustic',
    'live',
  ]);
});

test('matches a different Spotify ID when recording evidence agrees', () => {
  const result = compareTracks(track('spotify-a'), track('spotify-b', { album: 'Greatest Hits' }));
  assert.equal(result.outcome, 'match');
  assert.equal(result.confidence, 'high');
});

test('matches reissues, compilations, and remasters without choosing among them', () => {
  for (const album of [
    'Remastered 2024',
    'Career-spanning Compilation',
    '25th Anniversary Edition',
  ]) {
    assert.equal(compareTracks(track('a'), track('b', { album })).outcome, 'match');
  }
});

test('flags Taylor’s Version and original recording for review rather than auto-matching', () => {
  const result = compareTracks(
    track('original'),
    track('tv', {
      title: "Midnight Rain (Taylor's Version)",
      isrc: 'USBBB2400002',
    }),
  );
  assert.equal(result.outcome, 'review');
});

test('allows explicit and clean release variants to match when recording evidence agrees', () => {
  const result = compareTracks(
    track('explicit', { title: 'Midnight Rain (Explicit)' }),
    track('clean', {
      title: 'Midnight Rain (Clean)',
    }),
  );
  assert.equal(result.outcome, 'match');
});

test('matches harmless title punctuation variation', () => {
  const result = compareTracks(
    track('a', { title: 'Don’t Stop!' }),
    track('b', { title: 'Dont Stop' }),
  );
  assert.equal(result.outcome, 'match');
});

test('keeps live performances out of a studio replacement match', () => {
  const result = compareTracks(track('studio'), track('live', { title: 'Midnight Rain (Live)' }));
  assert.equal(result.outcome, 'separate');
  assert.ok(result.conflicts.includes('live_vs_studio'));
});

test('keeps live performances out of consistency groups, including other live recordings', () => {
  const result = compareTracks(
    track('live-a', { title: 'Midnight Rain (Live at Venue A)' }),
    track('live-b', {
      title: 'Midnight Rain (Live at Venue B)',
      isrc: 'USBBB2400002',
    }),
  );
  assert.equal(result.outcome, 'separate');
  assert.ok(result.conflicts.includes('live_recording_excluded'));
});

test('keeps covers, remixes, acoustic versions, demos, and alternate takes cautious', () => {
  for (const label of ['Cover', 'Remix', 'Acoustic', 'Demo', 'Alternate Take']) {
    const result = compareTracks(
      track('base'),
      track(label, { title: `Midnight Rain (${label})`, isrc: 'USBBB2400002' }),
    );
    assert.notEqual(result.outcome, 'match', `${label} should not be an automatic match`);
  }
});

test('does not match similar titles by different artists or different recordings', () => {
  const differentArtist = compareTracks(
    track('a'),
    track('b', { artists: [{ id: 'artist-2', name: 'Other Artist' }] }),
  );
  const differentRecording = compareTracks(
    track('a'),
    track('c', { durationMs: 205000, isrc: 'USCCC2400003' }),
  );
  assert.equal(differentArtist.outcome, 'separate');
  assert.notEqual(differentRecording.outcome, 'match');
});

test('uncertain duration with otherwise matching identity becomes review-only', () => {
  const result = compareTracks(
    track('a', { durationMs: undefined, isrc: undefined }),
    track('b', { durationMs: undefined, isrc: undefined }),
  );
  assert.equal(result.outcome, 'review');
  assert.equal(result.confidence, 'low');
});

test('complete-link grouping does not chain through a weak comparison', () => {
  const a = track('a', { isrc: 'USAAA2400001' });
  const b = track('b', { isrc: 'USAAA2400001' });
  const c = track('c', { isrc: 'USCCC2400003', durationMs: 181000 });
  const result = groupTracks([a, b, c]);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(
    result.groups[0].tracks.map((item) => item.id),
    ['a', 'b'],
  );
  assert.ok(result.reviewSuggestions.some((suggestion) => suggestion.trackIds.includes('c')));
});

test('preserves non-Latin titles and does not merge unrelated Unicode titles', () => {
  assert.equal(normalizeTitle('夜に駆ける'), '夜に駆ける');
  assert.equal(
    compareTracks(
      track('a', { title: '夜に駆ける' }),
      track('b', { title: '春の歌', isrc: 'USDDD2400004' }),
    ).outcome,
    'separate',
  );
});
test('shared featured artists do not establish primary artist identity', () => {
  const a = track('a', {
    artists: [
      { id: 'primary-a', name: 'First' },
      { id: 'guest', name: 'Guest' },
    ],
  });
  const b = track('b', {
    artists: [
      { id: 'primary-b', name: 'Second' },
      { id: 'guest', name: 'Guest' },
    ],
  });
  assert.equal(compareTracks(a, b).outcome, 'separate');
});
test('different Spotify artist IDs are not overridden by identical names', () => {
  assert.equal(
    compareTracks(track('a'), track('b', { artists: [{ id: 'other', name: 'A. Singer' }] }))
      .outcome,
    'separate',
  );
});
test('a matching ISRC does not override a contradictory duration', () => {
  assert.equal(compareTracks(track('a'), track('b', { durationMs: 220000 })).outcome, 'review');
});
test('suffix remasters are compared while meaningful edit labels remain evidence', () => {
  assert.equal(
    compareTracks(track('a'), track('b', { title: 'Midnight Rain - 2024 Remaster' })).outcome,
    'match',
  );
  assert.equal(
    compareTracks(track('a'), track('b', { title: 'Midnight Rain - Radio Edit' })).outcome,
    'review',
  );
});
test('words in a base title do not automatically indicate a live performance', () => {
  const a = track('a', { title: 'Live and Let Die', album: 'Live Through This' });
  assert.ok(!versionLabels(a).includes('live'));
  assert.equal(compareTracks(a, { ...a, id: 'b' }).outcome, 'match');
});
test('remixes with different labels cannot be merged through similar durations', () => {
  assert.equal(
    compareTracks(
      track('a', { title: 'Midnight Rain (Artist A Remix)', isrc: undefined }),
      track('b', { title: 'Midnight Rain (Artist B Remix)', isrc: undefined }),
    ).outcome,
    'review',
  );
});
test('matching artist names without IDs remain uncertain', () => {
  const artist = [{ name: 'A. Singer' }];
  assert.equal(
    compareTracks(track('a', { artists: artist }), track('b', { artists: artist })).outcome,
    'review',
  );
});
test('group membership requires all pairs to match and is independent of input order', () => {
  const a = track('a', { isrc: undefined, durationMs: 174000 });
  const b = track('b', { isrc: undefined, durationMs: 175500 });
  const c = track('c', { isrc: undefined, durationMs: 177000 });
  const forward = groupTracks([a, b, c]),
    reverse = groupTracks([c, b, a]);
  assert.deepEqual(forward, reverse);
  assert.deepEqual(
    forward.groups[0].tracks.map((track) => track.id),
    ['a', 'b'],
  );
});
