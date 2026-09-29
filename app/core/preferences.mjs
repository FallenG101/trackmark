import { compareTracks, comparableTitle, consistencyExclusions } from './matching.mjs?v=20260929-4';

export function songKey(group) {
  const keys = group.tracks.map((track) => {
    const artist = track.artists?.[0]?.id;
    const title = comparableTitle(track.title);
    return artist && title ? JSON.stringify([artist, title]) : null;
  });
  return keys.length && keys[0] && keys.every((key) => key === keys[0]) ? keys[0] : null;
}
export function validTarget(group, target) {
  return Boolean(
    target?.id &&
    target.playable !== false &&
    !target.relinked &&
    !consistencyExclusions(target).length &&
    group.tracks.length &&
    group.tracks.every(
      (member) =>
        !consistencyExclusions(member).length &&
        (member.id === target.id || compareTracks(member, target).outcome === 'match'),
    ),
  );
}
export function resolvePreference(group, preference, candidates) {
  if (!preference) return { status: 'none' };
  const target = candidates.find((track) => track.id === preference.trackId);
  if (!target)
    return {
      status: 'missing',
      message:
        'Saved version is not among the verified options. Find more releases to check for it; no substitute has been selected.',
    };
  if (!validTarget(group, target))
    return {
      status: 'blocked',
      message:
        'Saved version is unavailable, relinked, excluded or does not match every scanned version. Choose manually.',
    };
  return { status: 'ready', target };
}
export class Preferences {
  constructor(storage, key = 'trackmark.songPreferences.v1') {
    this.storage = storage;
    this.key = key;
  }
  read() {
    try {
      const data = JSON.parse(this.storage.getItem(this.key) ?? '{}');
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch {
      return {};
    }
  }
  get(scope, group) {
    const key = songKey(group);
    const value = key && scope ? this.read()[scope]?.[key] : null;
    return value && typeof value.trackId === 'string' ? value : null;
  }
  save(scope, group, target) {
    const key = songKey(group);
    if (!scope || !key || !validTarget(group, target))
      throw new Error('This version cannot be saved safely for this song.');
    const data = this.read();
    const songs = { ...(data[scope] ?? {}) };
    songs[key] = {
      trackId: target.id,
      title: target.title,
      album: target.album,
      savedAt: new Date().toISOString(),
    };
    data[scope] = songs;
    this.storage.setItem(this.key, JSON.stringify(data));
  }
  remove(scope, group) {
    const data = this.read();
    if (data[scope]) delete data[scope][songKey(group)];
    this.storage.setItem(this.key, JSON.stringify(data));
  }
  clear(scope) {
    const data = this.read();
    delete data[scope];
    this.storage.setItem(this.key, JSON.stringify(data));
  }
}

/** A local review plan only. This function cannot call Spotify or mutate its inputs. */
export function plannedPlacements(group, target) {
  if (!validTarget(group, target))
    throw new Error('Chosen version is not verified against this group.');
  const seen = new Set();
  for (const track of group.tracks) {
    if (!track.locations?.length)
      throw new Error('Playlist placements are missing. Rescan before preparing a plan.');
    for (const placement of track.locations) {
      const key = JSON.stringify([placement.playlistId, placement.position]);
      if (
        !placement.playlistId ||
        !Number.isInteger(placement.position) ||
        placement.position < 1 ||
        seen.has(key)
      )
        throw new Error(
          'Playlist placements are incomplete or ambiguous. Rescan before preparing a plan.',
        );
      seen.add(key);
    }
  }
  return group.tracks
    .filter((track) => track.id !== target.id)
    .flatMap((track) =>
      (track.locations ?? []).map((placement) => ({
        ...placement,
        fromTrackId: track.id,
        toTrackId: target.id,
      })),
    );
}
