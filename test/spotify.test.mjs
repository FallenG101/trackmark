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
