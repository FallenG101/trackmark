import { trackFromSpotify } from '../core/review.mjs?v=20260929-4';
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
    this.queue = Promise.resolve();
    this.nextRequestAt = 0;
    this.cooldownUntil = 0;
    this.playlistCache = new Map();
    this.searchCache = new Map();
    this.accountId = null;
    this.cacheGeneration = 0;
  }
  clearCaches() {
    this.cacheGeneration++;
    this.playlistCache.clear();
    this.searchCache.clear();
    this.accountId = null;
  }
  get(path, signal) {
    const request = this.queue.then(() => this.request(path, signal));
    this.queue = request.then(
      () => {},
      () => {},
    );
    return request;
  }
  async request(path, signal) {
    signal?.throwIfAborted();
    if (Date.now() < this.cooldownUntil)
      throw new SpotifyError(
        `Spotify rate-limit cooldown is active. Try again in ${Math.ceil((this.cooldownUntil - Date.now()) / 1000)} seconds.`,
        429,
        Math.ceil((this.cooldownUntil - Date.now()) / 1000),
      );
    const delay = Math.max(0, this.nextRequestAt - Date.now());
    if (delay)
      await new Promise((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          reject(signal.reason ?? new DOMException('Scan cancelled.', 'AbortError'));
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', abort);
          resolve();
        }, delay);
        signal?.addEventListener('abort', abort, { once: true });
      });
    signal?.throwIfAborted();
    const url = new URL(path, API);
    if (url.origin !== 'https://api.spotify.com' || !url.pathname.startsWith('/v1/'))
      throw new Error('Unexpected Spotify pagination URL.');
    const token = await this.auth.accessToken();
    this.nextRequestAt = Date.now() + 350;
    const response = await this.fetcher(url.href, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) {
      const retryAfter = Number(response.headers.get('Retry-After')) || null;
      if (response.status === 429) this.cooldownUntil = Date.now() + (retryAfter ?? 30) * 1000;
      const message =
        response.status === 403
          ? 'Spotify did not permit this read. The playlist may not be owned by you or shared with you as a collaborator, or your account may not be allowed for this developer app.'
          : response.status === 429
            ? `Spotify rate limit reached. Try again in ${retryAfter ?? 30} seconds.`
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
  async ownedPlaylists(signal) {
    const [profile, listed] = await Promise.all([this.get('me', signal), this.playlists(signal)]);
    if (typeof profile.id !== 'string' || !profile.id)
      throw new Error(
        'Spotify account identity could not be verified. No playlists can be selected.',
      );
    if (profile.id !== this.accountId) this.clearCaches();
    this.accountId = profile.id;
    const playlists = listed.filter((playlist) => playlist?.owner?.id === profile.id);
    return { playlists, excludedCount: listed.length - playlists.length };
  }
  async scanPlaylist(playlist, signal, progress = () => {}, { forceRefresh = true } = {}) {
    const generation = this.cacheGeneration;
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
    const cached = this.playlistCache.get(playlist.id);
    // Snapshots verify placements, not metadata changes. Limit reuse to ten minutes.
    if (
      !forceRefresh &&
      cached &&
      !cached.omissions.length &&
      before.snapshot_id &&
      cached.snapshotId === before.snapshot_id &&
      Date.now() - Date.parse(cached.scannedAt) < 600000
    ) {
      const after = await this.get(
        `playlists/${encodeURIComponent(playlist.id)}?fields=id,name,snapshot_id`,
        signal,
      );
      if (after.snapshot_id === before.snapshot_id) {
        return {
          ...structuredClone(cached),
          name: after.name ?? cached.name,
          spotifyUrl: playlist.external_urls?.spotify ?? cached.spotifyUrl,
          snapshotCheckedAt: new Date().toISOString(),
          reused: true,
        };
      }
    }
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
    const result = {
      ...base,
      name: after.name ?? base.name,
      status: 'scanned',
      snapshotId: after.snapshot_id,
      scannedAt: new Date().toISOString(),
      snapshotCheckedAt: new Date().toISOString(),
      reused: false,
    };
    if (generation === this.cacheGeneration) {
      this.playlistCache.delete(playlist.id);
      this.playlistCache.set(playlist.id, structuredClone(result));
      if (this.playlistCache.size > 100)
        this.playlistCache.delete(this.playlistCache.keys().next().value);
    }
    return result;
  }
  async scan(playlists, { signal, progress = () => {}, forceRefresh = false } = {}) {
    const scan = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), playlists: [] };
    for (const playlist of playlists) {
      if (signal?.aborted) break;
      progress(playlist.name, 0, playlist.items?.total ?? playlist.tracks?.total ?? 0);
      try {
        scan.playlists.push(
          await this.scanPlaylist(
            playlist,
            signal,
            (count, total) => progress(playlist.name, count, total),
            { forceRefresh },
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
    const generation = this.cacheGeneration;
    const clean = (text) => String(text ?? '').replace(/["\\]/g, ' ');
    const params = new URLSearchParams({
      q: `track:"${clean(track.title)}" artist:"${clean(track.artists?.[0]?.name)}"`,
      type: 'track',
      limit: '10',
      offset: String(offset),
    });
    const key = params.toString();
    const cached = this.searchCache.get(key);
    if (cached && Date.now() - cached.at < 600000)
      return { ...structuredClone(cached.result), reused: true };
    const page = await this.get(`search?${params}`, signal);
    const result = {
      tracks: (page.tracks?.items ?? []).map(trackFromSpotify),
      next: page.tracks?.next,
      offset: offset + 10,
      searchedAt: new Date().toISOString(),
      reused: false,
    };
    if (generation === this.cacheGeneration)
      this.searchCache.set(key, { at: Date.now(), result: structuredClone(result) });
    if (this.searchCache.size > 100) this.searchCache.delete(this.searchCache.keys().next().value);
    return result;
  }
}
