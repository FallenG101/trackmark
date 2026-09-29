/** Deterministic metadata matcher. Confidence labels are rules, not probabilities. */
const patterns = [
  ['live', /\b(?:live|in concert|concert recording)\b/i],
  ['remix', /\b(?:remix|re-mix|mix)\b/i],
  ['acoustic', /\b(?:acoustic|unplugged)\b/i],
  ['demo', /\bdemo\b/i],
  ['alternate_take', /\b(?:alternate|alternative|alt\.?)[ -]take\b/i],
  ['edit', /\b(?:edit|edited|radio version|single version)\b/i],
  ['cover', /\b(?:cover|tribute|karaoke)\b/i],
  ['instrumental', /\binstrumental\b/i],
  ['re_recording', /\b(?:re-recorded|rerecorded|re-recording)\b/i],
  ['taylor_version', /\btaylor[’']?s version\b/i],
  ['remaster', /\bremaster(?:ed)?\b/i],
  ['explicit', /\bexplicit\b/i],
  ['clean', /\bclean\b/i],
];
const meaningful = new Set([
  'live',
  'remix',
  'acoustic',
  'demo',
  'alternate_take',
  'edit',
  'cover',
  'instrumental',
  're_recording',
  'taylor_version',
]);
export function normalizeTitle(value = '') {
  return String(value)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[’']/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
function annotations(title = '') {
  const brackets = [...String(title).matchAll(/[([]([^\])]+)[\])]/g)].map((match) => match[1]);
  const suffix = String(title)
    .split(/\s[-–—]\s/)
    .slice(1);
  return [...brackets, ...suffix];
}
export function versionLabels(track) {
  const album = track.album ?? '';
  const albumEvidence =
    /\b(?:live at|live in|live from|in concert|live recordings?|live sessions?)\b/i.test(album) ||
    album.toLowerCase() === 'live'
      ? album
      : album.replace(/\blive\b/gi, '');
  const text = [...annotations(track.title), albumEvidence].join(' ');
  return [
    ...new Set([
      ...(track.versionLabels ?? []),
      ...patterns.filter(([, pattern]) => pattern.test(text)).map(([name]) => name),
    ]),
  ].sort();
}
export function comparableTitle(title = '') {
  const known = (text) => patterns.some(([, pattern]) => pattern.test(text));
  let base = String(title).replace(/[([]([^\])]+)[\])]/g, (whole, label) =>
    known(label) ? ' ' : whole,
  );
  const parts = base.split(/\s[-–—]\s/);
  base = parts.filter((part, index) => index === 0 || !known(part)).join(' - ');
  return normalizeTitle(base);
}
function artistIdentity(a, b) {
  const firstA = a.artists?.[0],
    firstB = b.artists?.[0];
  if (!firstA || !firstB) return 'unknown';
  if (firstA.id && firstB.id) return firstA.id === firstB.id ? 'id' : 'different';
  const nameA = typeof firstA === 'string' ? firstA : firstA.name;
  const nameB = typeof firstB === 'string' ? firstB : firstB.name;
  return nameA && nameB && normalizeTitle(nameA) === normalizeTitle(nameB) ? 'name' : 'different';
}
export function compareTracks(a, b) {
  const evidence = [],
    uncertainty = [],
    conflicts = [];
  const aLabels = versionLabels(a),
    bLabels = versionLabels(b);
  const titleA = comparableTitle(a.title),
    titleB = comparableTitle(b.title);
  const titleMatches = titleA !== '' && titleA === titleB;
  const artist = artistIdentity(a, b);
  const delta =
    Number.isFinite(a.durationMs) && Number.isFinite(b.durationMs)
      ? Math.abs(a.durationMs - b.durationMs)
      : null;
  const isrcA = a.isrc?.trim().toUpperCase(),
    isrcB = b.isrc?.trim().toUpperCase();
  const sameIsrc = Boolean(isrcA && isrcB && isrcA === isrcB);
  const differentIsrc = Boolean(isrcA && isrcB && isrcA !== isrcB);
  if (titleMatches) evidence.push('Base titles match; version labels are checked separately.');
  else uncertainty.push('Base titles differ.');
  if (artist === 'id') evidence.push('Primary Spotify artist IDs match.');
  else if (artist === 'name')
    uncertainty.push('Artist names agree, but artist identity cannot be verified.');
  else uncertainty.push('Primary artist identity differs or is missing.');
  if (sameIsrc) evidence.push('ISRC matches.');
  else
    uncertainty.push(
      differentIsrc
        ? 'ISRC values differ; this may be a different recording.'
        : 'ISRC is missing for at least one track.',
    );
  if (delta !== null && delta <= 2000) evidence.push(`Durations differ by ${delta} ms.`);
  else
    uncertainty.push(delta === null ? 'Duration is missing.' : `Durations differ by ${delta} ms.`);
  for (const label of meaningful)
    if (aLabels.includes(label) !== bLabels.includes(label))
      conflicts.push(`version_label:${label}`);
  const result = (outcome, confidence) => ({
    outcome,
    confidence,
    evidence,
    uncertainty,
    conflicts,
    durationDeltaMs: delta,
  });
  if (aLabels.includes('live') || bLabels.includes('live')) {
    conflicts.push(
      aLabels.includes('live') !== bLabels.includes('live')
        ? 'live_vs_studio'
        : 'live_recording_excluded',
    );
    uncertainty.push('Live recordings are excluded from consistency changes.');
    return result('separate', 'not-applicable');
  }
  if (artist === 'different') return result('separate', 'not-applicable');
  for (const label of meaningful) {
    if (aLabels.includes(label) && bLabels.includes(label)) {
      const qualifiers = (track) =>
        annotations(track.title)
          .filter((text) => patterns.find(([name]) => name === label)?.[1].test(text))
          .map(normalizeTitle)
          .sort()
          .join('|');
      if (qualifiers(a) !== qualifiers(b)) conflicts.push(`version_label:${label}_detail`);
    }
  }
  if (conflicts.length) {
    uncertainty.push(
      `Meaningful recording labels differ: ${conflicts.map((label) => label.split(':')[1]).join(', ')}.`,
    );
    return result(titleMatches && ['id', 'name'].includes(artist) ? 'review' : 'separate', 'low');
  }
  // Same recording code is strong evidence, but does not override contradictory duration or credits.
  const creditsA = (a.artists ?? [])
    .map((artist) => artist.id)
    .filter(Boolean)
    .sort()
    .join('|');
  const creditsB = (b.artists ?? [])
    .map((artist) => artist.id)
    .filter(Boolean)
    .sort()
    .join('|');
  const creditConflict = creditsA !== creditsB;
  if (a.relinked || b.relinked)
    uncertainty.push(
      'Spotify returned relinked metadata; the original recording could not be verified.',
    );
  if (creditConflict) uncertainty.push('Artist credits differ.');
  if (
    titleMatches &&
    artist === 'id' &&
    delta !== null &&
    delta <= 2000 &&
    !creditConflict &&
    !differentIsrc &&
    !a.relinked &&
    !b.relinked &&
    (sameIsrc || !aLabels.some((label) => meaningful.has(label)))
  ) {
    return result('match', sameIsrc ? 'high' : 'medium');
  }
  if ((titleMatches || sameIsrc) && artist !== 'different') return result('review', 'low');
  return result('separate', 'not-applicable');
}
export function groupTracks(tracks) {
  const ordered = [...tracks].sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'));
  const buckets = new Map();
  for (const track of ordered) {
    const key = comparableTitle(track.title);
    if (!key || versionLabels(track).includes('live')) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(track);
  }
  const groups = [],
    reviewSuggestions = [];
  for (const candidates of buckets.values()) {
    const local = [];
    for (let i = 0; i < candidates.length; i++)
      for (let j = i + 1; j < candidates.length; j++) {
        const comparison = compareTracks(candidates[i], candidates[j]);
        if (comparison.outcome === 'review')
          reviewSuggestions.push({ trackIds: [candidates[i].id, candidates[j].id], comparison });
      }
    for (const track of candidates) {
      const target = local.find((group) =>
        group.every((member) => compareTracks(member, track).outcome === 'match'),
      );
      if (target) target.push(track);
      else local.push([track]);
    }
    groups.push(
      ...local
        .filter((group) => group.length > 1)
        .map((group) => ({
          tracks: group,
          comparisons: group.flatMap((track, i) =>
            group
              .slice(i + 1)
              .map((other) => ({ trackIds: [track.id, other.id], ...compareTracks(track, other) })),
          ),
        })),
    );
  }
  return { groups, reviewSuggestions };
}
