import test from 'node:test';
import assert from 'node:assert/strict';
import { SpotifyReader } from '../app/lib/spotify.js';
const playlist = {
  id: 'p',
  name: 'Playlist',
  external_urls: { spotify: 'https://open.spotify.com/playlist/p' },
};
const track = {
  id: '1234567890123456789012',
  name: 'Song',
  type: 'track',
  artists: [{ id: 'artist', name: 'Artist' }],
  duration_ms: 180000,
};
const response = (data, status = 200) => ({
  ok: status === 200,
  status,
  headers: new Headers(),
  json: async () => data,
});
const auth = { accessToken: async () => 'test-token' };
function fixture(snapshots = ['s', 's']) {
  const calls = [];
  let snapshot = 0;
  const reader = new SpotifyReader(auth, {
    fetcher: async (url, options) => {
      calls.push({ url, options });
      const path = new URL(url).pathname;
      if (!path.endsWith('/items'))
        return response({ id: 'p', name: 'Playlist', snapshot_id: snapshots[snapshot++] });
      if (new URL(url).searchParams.get('offset'))
        return response({ offset: 2, total: 3, items: [{ track }], next: null });
      return response({
        offset: 0,
        total: 3,
        items: [{ item: track }, { item: null }],
        next: 'https://api.spotify.com/v1/playlists/p/items?offset=2',
      });
    },
  });
  return { reader, calls };
}
test('read-only scan handles both item shapes, pagination, omissions and exact positions', async () => {
  const { reader, calls } = fixture();
  const result = await reader.scanPlaylist(playlist);
  assert.equal(result.status, 'scanned');
  assert.deepEqual(
    result.placements.map((entry) => entry.position),
    [1, 3],
  );
  assert.deepEqual(result.omissions, [{ position: 2, reason: 'Unavailable item' }]);
  assert.ok(calls.every((call) => call.options.method === 'GET'));
});
test('a playlist changed during scan is excluded from matched results', async () => {
  const { reader } = fixture(['before', 'after']);
  const scan = await reader.scan([playlist]);
  assert.equal(scan.playlists[0].status, 'changed');
});
test('missing snapshot metadata never becomes a verified scan', async () => {
  const { reader } = fixture([undefined, undefined]);
  assert.equal((await reader.scanPlaylist(playlist)).status, 'incomplete');
});
test('rate-limited reads stop and leave remaining playlists unscanned without retry', async () => {
  let calls = 0;
  const reader = new SpotifyReader(auth, {
    fetcher: async () => {
      calls++;
      return response({}, 429);
    },
  });
  const scan = await reader.scan([playlist, { ...playlist, id: 'p2' }]);
  assert.equal(calls, 1);
  assert.equal(scan.playlists[0].status, 'inaccessible');
  assert.equal(scan.playlists[1].status, 'unscanned');
});
test('foreign pagination URLs cannot receive the access token', async () => {
  let calls = 0;
  const reader = new SpotifyReader(auth, {
    fetcher: async () => {
      calls++;
      return response({ items: [], next: 'https://evil.example/steal' });
    },
  });
  await assert.rejects(() => reader.pages('me/playlists'), /Unexpected/);
  assert.equal(calls, 1);
});
test('repeated pagination and premature page endings are errors', async () => {
  const reader = new SpotifyReader(auth, {
    fetcher: async (url) =>
      new URL(url).pathname.endsWith('/items')
        ? response({ offset: 0, total: 5, items: [{ item: track }], next: null })
        : response({ snapshot_id: 's' }),
  });
  await assert.rejects(() => reader.scanPlaylist(playlist), /before all entries/);
});
function cacheFixture() {
  let snapshot = 's',
    calls = 0;
  const reader = new SpotifyReader(auth, {
    fetcher: async (url, options) => {
      calls++;
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      return new URL(url).pathname.endsWith('/items')
        ? response({ offset: 0, total: 1, items: [{ item: track }], next: null })
        : response({ snapshot_id: snapshot, name: 'Playlist' });
    },
  });
  return {
    reader,
    calls: () => calls,
    change: () => {
      snapshot = 'changed';
    },
  };
}
test('unchanged cached entries require two fresh snapshot checks and preserve original metadata time', async () => {
  const { reader, calls } = cacheFixture();
  const first = await reader.scanPlaylist(playlist);
  const count = calls();
  const reused = await reader.scanPlaylist(playlist, undefined, undefined, { forceRefresh: false });
  assert.equal(calls() - count, 2);
  assert.equal(reused.reused, true);
  assert.equal(reused.scannedAt, first.scannedAt);
  reused.placements.length = 0;
  assert.equal(reader.playlistCache.get('p').placements.length, 1);
});
test('changed snapshots, forced reads and expired caches require full reads', async () => {
  const { reader, calls, change } = cacheFixture();
  await reader.scanPlaylist(playlist);
  change();
  let count = calls();
  assert.equal(
    (await reader.scanPlaylist(playlist, undefined, undefined, { forceRefresh: false })).reused,
    false,
  );
  assert.equal(calls() - count, 3);
  count = calls();
  await reader.scanPlaylist(playlist);
  assert.equal(calls() - count, 3);
  reader.playlistCache.get('p').scannedAt = '2000-01-01T00:00:00Z';
  count = calls();
  await reader.scanPlaylist(playlist, undefined, undefined, { forceRefresh: false });
  assert.equal(calls() - count, 3);
});
test('failed cache verification does not return stale entries and cooldown prevents further calls', async () => {
  const { reader } = cacheFixture();
  await reader.scanPlaylist(playlist);
  let calls = 0;
  reader.fetcher = async () => {
    calls++;
    return response({}, 429);
  };
  await assert.rejects(
    () => reader.scanPlaylist(playlist, undefined, undefined, { forceRefresh: false }),
    /rate limit/,
  );
  await assert.rejects(() => reader.get('me'), /cooldown/);
  assert.equal(calls, 1);
});
test('aborted scans issue no request and ambiguous page offsets cannot become successful scans', async () => {
  const { reader, calls } = cacheFixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => reader.scanPlaylist(playlist, controller.signal), {
    name: 'AbortError',
  });
  assert.equal(calls(), 0);
  reader.fetcher = async (url) =>
    new URL(url).pathname.endsWith('/items')
      ? response({ offset: 5, total: 6, items: [{ item: track }], next: null })
      : response({ snapshot_id: 's' });
  await assert.rejects(() => reader.scanPlaylist(playlist), /overlap or skip/);
});
test('owned listing fails closed on missing account identity and excludes unknown or foreign owners', async () => {
  const reader = new SpotifyReader(auth, {
    fetcher: async (url) =>
      response(
        new URL(url).pathname === '/v1/me'
          ? { id: 'owner' }
          : {
              items: [
                { id: 'own', owner: { id: 'owner' } },
                { id: 'other', owner: { id: 'other' } },
                { id: 'unknown' },
              ],
              next: null,
            },
      ),
  });
  const result = await reader.ownedPlaylists();
  assert.deepEqual(
    result.playlists.map((item) => item.id),
    ['own'],
  );
  assert.equal(result.excludedCount, 2);
  reader.fetcher = async (url) =>
    response(new URL(url).pathname === '/v1/me' ? {} : { items: [], next: null });
  await assert.rejects(() => reader.ownedPlaylists(), /identity/);
});
