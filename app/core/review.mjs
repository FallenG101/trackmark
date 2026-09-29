import { compareTracks, comparableTitle, groupTracks, versionLabels } from './matching.mjs';
export function trackFromSpotify(track) {
  return {
    id: track.linked_from?.id ?? track.id,
    returnedId: track.id,
    relinked: Boolean(track.linked_from?.id),
    title: track.name,
    artists: track.artists ?? [],
    durationMs: track.duration_ms,
    isrc: track.external_ids?.isrc,
    album: track.album?.name ?? 'Unknown release',
    releaseDate: track.album?.release_date ?? '',
    explicit: track.explicit,
    spotifyUrl: track.external_urls?.spotify ?? `https://open.spotify.com/track/${track.id}`,
    albumUrl: track.album?.external_urls?.spotify,
    uri: track.uri,
    playable: track.is_playable ?? null,
    locations: [],
  };
}
export function reviewScan(scan) {
  const versions = new Map();
  for (const playlist of scan.playlists)
    if (playlist.status === 'scanned')
      for (const placement of playlist.placements) {
        const track = placement.track;
        if (!versions.has(track.id)) versions.set(track.id, { ...track, locations: [] });
        versions.get(track.id).locations.push({
          playlistId: playlist.id,
          playlist: playlist.name,
          playlistUrl: playlist.spotifyUrl,
          position: placement.position,
        });
      }
  const tracks = [...versions.values()],
    result = groupTracks(tracks),
    used = new Set();
  const groups = result.groups.map((group) => {
    group.tracks.forEach((track) => used.add(track.id));
    return {
      id: group.tracks
        .map((track) => track.id)
        .sort()
        .join('|'),
      tracks: group.tracks,
      comparisons: group.comparisons,
    };
  });
  for (const track of tracks)
    if (
      !used.has(track.id) &&
      !versionLabels(track).includes('live') &&
      new Set(track.locations.map((location) => location.playlistId)).size > 1
    ) {
      groups.push({ id: track.id, tracks: [track], comparisons: [] });
    }
  const uncertain = result.reviewSuggestions.map((item) => ({
    ...item,
    tracks: item.trackIds.map((id) => versions.get(id)),
  }));
  // Presentation bundles collect evidence under a song heading without declaring membership.
  const bundles = new Map();
  for (const pair of uncertain) {
    const first = pair.tracks[0];
    const key = `${comparableTitle(first.title)}|${first.artists[0]?.id ?? first.artists[0]?.name ?? ''}`;
    if (!bundles.has(key)) bundles.set(key, { tracks: new Map(), comparisons: [] });
    const bundle = bundles.get(key);
    pair.tracks.forEach((track) => bundle.tracks.set(track.id, track));
    bundle.comparisons.push({ ...pair.comparison, trackIds: pair.trackIds });
  }
  const uncertainSongs = [...bundles.values()].map((bundle) => ({
    tracks: [...bundle.tracks.values()],
    comparisons: bundle.comparisons,
    trackIds: [...bundle.tracks.keys()].sort(),
  }));
  return {
    groups: groups
      .filter(
        (group) =>
          new Set(
            group.tracks.flatMap((track) => track.locations.map((location) => location.playlistId)),
          ).size > 1,
      )
      .sort((a, b) => a.tracks[0].title.localeCompare(b.tracks[0].title)),
    uncertain,
    uncertainSongs,
    tracks,
    liveExcluded: tracks.filter((track) => versionLabels(track).includes('live')).length,
  };
}
export function differingPlacements(group, chosenId) {
  if (!chosenId || !group.tracks.some((track) => track.id === chosenId)) return [];
  return group.tracks
    .filter((track) => track.id !== chosenId)
    .flatMap((track) => track.locations.map((location) => ({ ...location, from: track })));
}
export function duplicateMatches(candidate, playlist) {
  if (playlist.status !== 'scanned') return { checked: false, matches: [] };
  const matches = playlist.placements.flatMap((placement) => {
    const comparison = compareTracks(candidate, placement.track);
    const exact = candidate.id === placement.track.id;
    return exact || comparison.outcome !== 'separate' ? [{ ...placement, comparison, exact }] : [];
  });
  return { checked: true, matches, checkedAt: playlist.scannedAt };
}
export function parseTrackId(input) {
  const value = input.trim();
  const uri = value.match(/^spotify:track:([a-zA-Z0-9]{22})$/);
  if (uri) return uri[1];
  try {
    const url = new URL(value);
    if (url.hostname === 'open.spotify.com')
      return url.pathname.match(/^\/(?:intl-[^/]+\/)?track\/([a-zA-Z0-9]{22})\/?$/)?.[1] ?? null;
  } catch {
    /* Not a track URL. */
  }
  return null;
}
