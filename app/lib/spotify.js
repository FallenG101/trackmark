import { trackFromSpotify } from '../core/review.mjs';
const API = 'https://api.spotify.com/v1/';
export class SpotifyError extends Error {
  constructor(message, status, retryAfter) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
/** Only GET is exposed. OAuth token POSTs live separately in auth.js. */
export class SpotifyReader {
  constructor(auth, { fetcher = (...args) => globalThis.fetch(...args) } = {}) {
    this.auth = auth;
    this.fetcher = fetcher;
  }
  async get(path, signal) {
    const url = new URL(path, API);
    if (url.origin !== 'https://api.spotify.com' || !url.pathname.startsWith('/v1/'))
      throw new Error('Unexpected Spotify pagination URL.');
    const token = await this.auth.accessToken();
    const response = await this.fetcher(url.href, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) {
      const retryAfter = Number(response.headers.get('Retry-After')) || null;
      const message =
        response.status === 403
          ? 'Spotify did not permit this read. The playlist may not be owned by you or shared with you as a collaborator, or your account may not be allowed for this developer app.'
          : response.status === 429
            ? `Spotify rate limit reached. Try again in ${retryAfter ?? 'a few'} seconds.`
            : response.status === 401
              ? 'Spotify session was rejected. Disconnect and reconnect.'
              : `Spotify read failed (${response.status}).`;
      throw new SpotifyError(message, response.status, retryAfter);
    }
    return response.json();
  }
  async pages(path, signal) {
    const items = [],
      seen = new Set();
    let next = path;
    while (next) {
      if (seen.has(next))
        throw new Error('Spotify returned repeated pagination. Scan is incomplete.');
      seen.add(next);
      const page = await this.get(next, signal);
      if (!Array.isArray(page.items)) throw new Error('Spotify did not return playlist items.');
      items.push(...page.items);
      next = page.next;
    }
    return items;
  }
  playlists(signal) {
    return this.pages('me/playlists?limit=50', signal);
  }
  async scanPlaylist(playlist, signal, progress = () => {}) {
    const base = {
      id: playlist.id,
      name: playlist.name,
      spotifyUrl: playlist.external_urls?.spotify,
      placements: [],
      omissions: [],
      startedAt: new Date().toISOString(),
    };
    const before = await this.get(
      `playlists/${encodeURIComponent(playlist.id)}?fields=id,name,snapshot_id`,
      signal,
    );
    let next = `playlists/${encodeURIComponent(playlist.id)}/items?limit=50`,
      offset = 0;
    const seen = new Set();
    while (next) {
      if (seen.has(next)) throw new Error('Repeated pagination; playlist scan is incomplete.');
      seen.add(next);
      const page = await this.get(next, signal);
      if (!Array.isArray(page.items)) throw new Error('Playlist contents were inaccessible.');
      const start = Number.isInteger(page.offset) ? page.offset : offset;
      for (const [index, entry] of page.items.entries()) {
        const position = start + index + 1,
          item = entry.item ?? entry.track;
        if (!item?.id || item.type !== 'track' || entry.is_local || item.is_local) {
          base.omissions.push({
            position,
            reason: !item
              ? 'Unavailable item'
              : entry.is_local || item.is_local
                ? 'Local track'
                : item.type === 'episode'
                  ? 'Podcast episode'
                  : 'Unsupported item',
          });
        } else base.placements.push({ position, track: trackFromSpotify(item) });
      }
      offset = start + page.items.length;
      next = page.next;
      progress(offset, page.total);
      if (!next && Number.isFinite(page.total) && offset !== page.total)
        throw new Error('Playlist pagination ended before all entries were read.');
    }
    const after = await this.get(
      `playlists/${encodeURIComponent(playlist.id)}?fields=id,name,snapshot_id`,
      signal,
    );
    if (!before.snapshot_id || !after.snapshot_id)
      return {
        ...base,
        status: 'incomplete',
        error: 'Spotify did not provide snapshots to verify that the playlist stayed unchanged.',
      };
    if (before.snapshot_id !== after.snapshot_id)
      return {
        ...base,
        status: 'changed',
        error: 'Playlist changed during the scan. Rescan before reviewing it.',
      };
    return {
      ...base,
      name: after.name ?? base.name,
      status: 'scanned',
      snapshotId: after.snapshot_id,
      scannedAt: new Date().toISOString(),
    };
  }
  async scan(playlists, { signal, progress = () => {} } = {}) {
    const scan = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), playlists: [] };
    for (const playlist of playlists) {
      if (signal?.aborted) break;
      progress(playlist.name, 0, playlist.items?.total ?? playlist.tracks?.total ?? 0);
      try {
        scan.playlists.push(
          await this.scanPlaylist(playlist, signal, (count, total) =>
            progress(playlist.name, count, total),
          ),
        );
      } catch (error) {
        scan.playlists.push({
          id: playlist.id,
          name: playlist.name,
          spotifyUrl: playlist.external_urls?.spotify,
          status: error.name === 'AbortError' ? 'cancelled' : 'inaccessible',
          placements: [],
          omissions: [],
          error: error.message,
        });
        if (error.name === 'AbortError' || error.status === 429 || error.status === 401) break;
      }
    }
    for (const playlist of playlists)
      if (!scan.playlists.some((item) => item.id === playlist.id))
        scan.playlists.push({
          id: playlist.id,
          name: playlist.name,
          status: 'unscanned',
          placements: [],
          omissions: [],
        });
    scan.completedAt = new Date().toISOString();
    return scan;
  }
  async track(id, signal) {
    return trackFromSpotify(await this.get(`tracks/${encodeURIComponent(id)}`, signal));
  }
  async search(track, offset = 0, signal) {
    const clean = (text) => String(text ?? '').replace(/["\\]/g, ' ');
    const params = new URLSearchParams({
      q: `track:"${clean(track.title)}" artist:"${clean(track.artists?.[0]?.name)}"`,
      type: 'track',
      limit: '10',
      offset: String(offset),
    });
    const page = await this.get(`search?${params}`, signal);
    return {
      tracks: (page.tracks?.items ?? []).map(trackFromSpotify),
      next: page.tracks?.next,
      offset: offset + 10,
    };
  }
}
