import { SpotifyAuth } from './lib/auth.js?v=20260929-4';
import { SpotifyReader } from './lib/spotify.js?v=20260929-7';
import { demoScan, demoCatalog, demoTrackId } from './lib/demo.js';
import {
  reviewScan,
  differingPlacements,
  duplicateMatches,
  parseTrackId,
} from './core/review.mjs?v=20260929-4';
import { compareTracks, versionLabels } from './core/matching.mjs?v=20260929-4';
const callbackUrl = new URL(location.href);
const $ = (selector) => document.querySelector(selector);
const html = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
const safeUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'open.spotify.com' ? url.href : null;
  } catch {
    return null;
  }
};
const link = (url, text) =>
  safeUrl(url)
    ? `<a href="${html(safeUrl(url))}" target="_blank" rel="noreferrer">${html(text)} ↗</a>`
    : html(text);
const date = (value) => (value ? new Date(value).toLocaleString() : 'Not scanned');
const duration = (ms) =>
  Number.isFinite(ms)
    ? `${Math.floor(Math.round(ms / 1000) / 60)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}`
    : 'Unknown duration';
const siteRedirect = new URL('./', location.href);
siteRedirect.search = '';
siteRedirect.hash = '';
let config = {
  clientId: '',
  redirectUri: location.protocol === 'file:' ? 'http://127.0.0.1:4173/' : siteRedirect.href,
};
try {
  const localConfig = (await import('./config.local.js')).default;
  config = {
    ...config,
    ...localConfig,
    // A local loopback redirect must not override the hosted site's address.
    redirectUri:
      location.protocol === 'https:'
        ? siteRedirect.href
        : localConfig.redirectUri || config.redirectUri,
  };
} catch {
  /* Local configuration is optional for the demo. */
}
const CLIENT_ID_KEY = 'trackmark.spotify.clientId';
const fileClientId = config.clientId;
try {
  const savedId = localStorage.getItem(CLIENT_ID_KEY);
  if (savedId && /^[a-zA-Z0-9]{32}$/.test(savedId)) config.clientId = savedId;
} catch {
  /* File configuration remains available when browser storage is blocked. */
}
$('#client-id').value = config.clientId;
const auth = new SpotifyAuth(config),
  spotify = new SpotifyReader(auth);
let epoch = 0;
let playlists = [],
  scan = null,
  review = null,
  selected = new Set(),
  choices = new Map(),
  pages = new Map(),
  catalogs = new Map(),
  dismissed = new Set(),
  groupPage = 0,
  controller = null,
  loading = false;
function notice(message, error = false) {
  $('#notice').textContent = message;
  $('#notice').classList.toggle('error', error);
  $('#notice').hidden = !message;
}
function navigate(view) {
  if (!['review', 'playlists', 'duplicates', 'settings'].includes(view)) view = 'review';
  document
    .querySelectorAll('.view')
    .forEach((section) => (section.hidden = section.id !== `${view}-view`));
  document.querySelectorAll('.nav-item').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $('#view-name').textContent = {
    review: 'Song review',
    playlists: 'Playlists',
    duplicates: 'Duplicate check',
    settings: 'Setup & privacy',
  }[view];
  history.replaceState(null, '', `#${view}`);
}
function updateConnection() {
  const connected = auth.connected();
  $('#connect').hidden = connected;
  $('#disconnect').hidden = !connected;
  $('#connection-state').textContent = connected ? 'Spotify connected' : 'Spotify not connected';
  $('#config-status').textContent = config.clientId
    ? 'Client ID configured locally.'
    : 'Client ID has not been configured. The sample library works without one.';
  $('#redirect-uri').textContent = config.redirectUri;
  $('#load-playlists').disabled = !connected || loading;
  $('#client-id').disabled = connected || loading;
  $('#client-id-form button[type="submit"]').disabled = connected || loading;
  $('#forget-client-id').disabled = connected || loading;
}
function artists(track) {
  return track.artists
    .map((artist) =>
      link(
        artist.external_urls?.spotify ??
          (artist.id && !scan?.demo ? `https://open.spotify.com/artist/${artist.id}` : null),
        artist.name ?? 'Unknown artist',
      ),
    )
    .join(', ');
}
function locations(track) {
  return track.locations?.length
    ? `<div class="locations">${track.locations.map((location) => `<span class="location-chip">${link(location.playlistUrl, location.playlist)} · entry #${location.position}</span>`).join('')}</div>`
    : '<span class="location-empty">Not found in scanned playlists</span>';
}
function spotifyIdentity(track) {
  return `<span class="meta-line">Spotify track ID: ${html(track.id)}</span>${track.relinked ? `<span class="meta-line">Returned Spotify ID: ${html(track.returnedId ?? 'unavailable')} (relinked)</span>` : ''}<span class="meta-line">Exact duration: ${Number.isFinite(track.durationMs) ? `${track.durationMs} ms` : 'unavailable'}</span>`;
}
function trackDetails(track, showLocations = true) {
  return `<div class="track-detail"><strong>${link(track.spotifyUrl, track.title)}</strong><p>${artists(track)} · ${link(track.albumUrl, track.album)} · ${html(track.releaseDate || 'Unknown date')}</p><p>${duration(track.durationMs)} · ${track.explicit === true ? 'Explicit' : track.explicit === false ? 'Not marked explicit (may be clean or unknown)' : 'Explicit status unknown'} · ISRC ${html(track.isrc ?? 'unavailable')}${track.relinked ? ' · Relinked Spotify metadata' : ''}</p>${spotifyIdentity(track)}${showLocations ? locations(track) : ''}</div>`;
}
function evidence(comparisons) {
  const good = [...new Set(comparisons.flatMap((item) => item.evidence))],
    uncertain = [...new Set(comparisons.flatMap((item) => item.uncertainty))];
  return `<details class="evidence-panel"><summary>Why these tracks may belong together</summary><div class="evidence-list">${good.map((text) => `<span class="evidence-good">✓ ${html(text)}</span>`).join('')}${uncertain.map((text) => `<span class="evidence-unknown">? ${html(text)}</span>`).join('')}</div>${comparisons.map((item) => `<div class="evidence-detail"><p>Pair: ${html(item.trackIds?.map((id) => review?.tracks.find((track) => track.id === id)?.album ?? id).join(' / ') ?? 'Compared tracks')} · ${html(item.confidence)} confidence</p><p>${html([...item.evidence, ...item.uncertainty].join(' '))}</p></div>`).join('')}<p class="catalog-note">Confidence describes these metadata rules; it is not a probability or a guarantee.</p></details>`;
}
function versionOption(track, group) {
  const chosen = choices.get(group.id) === track.id;
  return `<label class="version-option ${chosen ? 'selected' : ''}"><input type="radio" name="version-${html(group.id)}" data-choice="${html(group.id)}" value="${html(track.id)}" ${chosen ? 'checked' : ''} ${track.playable === false ? 'disabled' : ''}><span><span class="version-title">${html(track.title)}</span><span class="version-subtitle">${link(track.albumUrl, track.album)}</span>${locations(track)}</span><span class="version-meta">${versionLabels(
    track,
  )
    .map((label) => `<span class="meta-tag">${html(label.replaceAll('_', ' '))}</span>`)
    .join(
      '',
    )}<span class="meta-line">${html(track.releaseDate || 'Unknown date')} · ${duration(track.durationMs)}</span><span class="meta-line">${track.explicit === true ? 'Explicit' : track.explicit === false ? 'Not marked explicit' : 'Explicit status unknown'}</span><span class="meta-line">ISRC ${html(track.isrc ?? 'unavailable')}</span>${spotifyIdentity(track)}<span class="spotify-link">${link(track.spotifyUrl, scan.demo ? 'Sample data · no Spotify link' : 'Open in Spotify')}</span>${track.playable === false ? '<span class="evidence-unknown">Unavailable in your market</span>' : ''}${
    !track.locations?.length
      ? `<details class="version-evidence"><summary>Candidate match evidence</summary>${group.tracks
          .map((member) => {
            const comparison = compareTracks(member, track);
            return `<p>Compared with ${html(member.album)}: ${html([...comparison.evidence, ...comparison.uncertainty].join(' '))}</p>`;
          })
          .join('')}</details>`
      : ''
  }</span></label>`;
}
function preview(group) {
  const chosen = choices.get(group.id);
  if (chosen === 'leave')
    return '<div class="change-preview"><strong>Leave everything as it is</strong><p>This group has an explicit leave-unchanged decision.</p></div>';
  if (!chosen)
    return '<div class="change-preview"><strong>No version chosen</strong><p>Choose an option to see exactly which scanned playlist entries differ.</p></div>';
  const tracks = [...group.tracks, ...(catalogs.get(group.id)?.tracks ?? [])],
    target = tracks.find((track) => track.id === chosen);
  const changes = group.tracks
    .filter((track) => track.id !== chosen)
    .flatMap((track) => track.locations.map((location) => ({ ...location, from: track })));
  return `<div class="change-preview"><strong>Chosen: ${html(target?.album ?? 'Unknown release')} · ${changes.length} ${changes.length === 1 ? 'entry differs' : 'entries differ'}</strong><p>This is a review plan. Spotify has not been changed.</p>${changes.length ? `<ul>${changes.map((change) => `<li><strong>${html(change.playlist)}</strong>, entry #${change.position} <span>· ${html(change.from.album)} → ${html(target?.album)}</span></li>`).join('')}</ul>` : '<p>Every placement in this group already uses this Spotify track ID.</p>'}</div>`;
}
function groupCard(group) {
  const first = group.tracks[0],
    confidence = group.comparisons.some((item) => item.confidence === 'medium') ? 'medium' : 'high',
    playlistCount = new Set(
      group.tracks.flatMap((track) => track.locations.map((location) => location.playlistId)),
    ).size;
  if (group.tracks.length === 1)
    return `<article class="song-card"><div class="song-header"><div class="song-avatar" aria-hidden="true">✓</div><div class="song-title-group"><div class="song-label">ALREADY CONSISTENT</div><h2>${html(first.title)}</h2><p>${artists(first)} · Same Spotify track in ${playlistCount} scanned playlists</p></div></div><details class="evidence-panel"><summary>View release and playlist entries</summary>${trackDetails(first)}<p class="muted">No differing version was found in these scanned playlists. No replacement choice is needed. This does not establish consistency in unscanned playlists.</p></details>${relatedPanel(group)}</article>`;
  const catalog = catalogs.get(group.id),
    all = [
      ...[...group.tracks].sort(
        (a, b) => a.album.localeCompare(b.album) || a.id.localeCompare(b.id),
      ),
      ...(catalog?.tracks ?? []),
    ],
    page = pages.get(group.id) ?? 0,
    pageCount = Math.ceil(all.length / 5),
    visible = all.slice(page * 5, page * 5 + 5);
  return `<article class="song-card"><div class="song-header"><div class="song-avatar" aria-hidden="true">♪</div><div class="song-title-group"><div class="song-label">${group.tracks.length > 1 ? 'POSSIBLE SONG MATCH' : 'SAME SPOTIFY TRACK'} <span class="pill ${confidence === 'medium' ? 'warn' : ''}">${confidence} confidence</span></div><h2>${html(first.title)}</h2><p>${artists(first)} · ${group.tracks.length} scanned ${group.tracks.length === 1 ? 'version' : 'versions'} · ${playlistCount} ${playlistCount === 1 ? 'playlist' : 'playlists'}</p></div><div class="consistency"><strong>${group.tracks.length > 1 ? 'Multiple versions' : 'Consistent'}</strong><small>${playlistCount > 1 ? 'Across scanned playlists' : 'Within one scanned playlist'}</small></div></div>${group.comparisons.length ? evidence(group.comparisons) : '<div class="evidence-panel">Identical Spotify track ID in every placement shown. This does not establish consistency in unscanned playlists.</div>'}<div class="versions-header"><div><h3>Choose a version</h3><p>Different Spotify IDs can share the same release metadata and recording. No option is preselected. Scanned entries are shown first, in release name order.</p></div><button class="button compact" data-catalog="${html(group.id)}" ${catalog?.loading || catalog?.exhausted ? 'disabled' : ''}>${catalog?.loading ? 'Searching…' : catalog?.exhausted ? 'Catalog search complete' : 'Find more releases'}</button></div><div class="version-list">${visible.map((track) => versionOption(track, group)).join('')}</div><div class="version-pages"><span>${all.length} options · page ${page + 1} of ${pageCount}</span><div class="button-row"><button class="button compact" data-version-page="${html(group.id)}" data-delta="-1" ${page === 0 ? 'disabled' : ''}>Previous</button><button class="button compact" data-version-page="${html(group.id)}" data-delta="1" ${page + 1 >= pageCount ? 'disabled' : ''}>Next 5</button></div></div>${catalog?.note ? `<p class="catalog-note">${html(catalog.note)}</p>` : ''}${preview(group)}${relatedPanel(group)}<div class="song-footer"><button class="button compact" data-leave="${html(group.id)}">Leave everything as it is</button><span>Choices affect this review only.</span></div></article>`;
}
function relatedSuggestions(group) {
  return review.uncertainSongs.filter(
    (item) =>
      !dismissed.has(item.trackIds.join('|')) &&
      item.trackIds.some((id) => group.tracks.some((track) => track.id === id)),
  );
}
function relatedPanel(group) {
  return relatedSuggestions(group)
    .map((item) => {
      const others = item.tracks.filter(
        (track) => !group.tracks.some((member) => member.id === track.id),
      );
      return `<details class="evidence-panel related-panel"><summary>${others.length} related ${others.length === 1 ? 'recording' : 'recordings'} kept separate · needs review</summary><p class="muted">These recordings are not included in this group's consistency choice. No membership was inferred through a chain of uncertain matches.</p>${others.map(trackDetails).join('')}${evidence(item.comparisons)}<button class="button compact" data-dismiss="${html(item.trackIds.join('|'))}">Keep these separate</button></details>`;
    })
    .join('');
}
function uncertainCard(item) {
  const key = item.trackIds.join('|');
  return `<article class="song-card uncertain-card"><div class="song-header"><div class="song-avatar" aria-hidden="true">?</div><div class="song-title-group"><div class="song-label">NOT GROUPED <span class="pill warn">Needs review</span></div><h2>${html(item.tracks[0].title)}</h2><p>Evidence is insufficient for consistency changes. Each comparison remains separate.</p></div></div>${evidence(item.comparisons)}<div class="pair-list" style="margin-top:12px">${item.tracks.map(trackDetails).join('')}</div><div class="song-footer"><button class="button compact" data-dismiss="${html(key)}">Keep these separate</button><span>No replacement choice is available for these uncertain recordings.</span></div></article>`;
}
function scanLimitations() {
  const rows = scan.playlists
    .filter((playlist) => playlist.status !== 'scanned' || playlist.omissions.length)
    .map(
      (playlist) =>
        `<li><strong>${html(playlist.name)}</strong>: ${html(playlist.error ?? (playlist.status !== 'scanned' ? playlist.status : `${playlist.omissions.length} entries could not be matched`))}${
          playlist.omissions.length
            ? `<ul>${playlist.omissions
                .slice(0, 50)
                .map((item) => `<li>Entry #${item.position}: ${html(item.reason)}</li>`)
                .join(
                  '',
                )}</ul>${playlist.omissions.length > 50 ? '<p>First 50 unchecked entries shown; export includes all omissions.</p>' : ''}`
            : ''
        }</li>`,
    )
    .join('');
  return rows
    ? `<details class="scan-limitations"><summary>What could not be checked</summary><ul>${rows}</ul></details>`
    : '';
}
function renderReview() {
  const summary = $('#scan-summary');
  $('#data-badge').textContent = scan?.demo ? 'SAMPLE DATA' : scan ? 'SCAN RESULTS' : 'NO SCAN';
  $('#data-badge').classList.toggle('demo', Boolean(scan?.demo));
  $('#export').disabled = !scan;
  if (!scan) {
    summary.innerHTML = '';
    $('#groups').innerHTML =
      '<div class="empty-state"><h2>Start with the playlists you care about</h2><p>Connect Spotify and select playlists, or try the sample library to explore the review flow.</p></div>';
    $('#result-count').textContent = '0 songs';
    $('#review-detail').textContent = '';
    $('#group-pagination').innerHTML = '';
    return;
  }
  const scanned = scan.playlists.filter((playlist) => playlist.status === 'scanned'),
    omissions = scanned.reduce((count, playlist) => count + playlist.omissions.length, 0);
  summary.innerHTML = `<div class="scan-summary"><div class="scan-summary-heading"><strong>${scan.demo ? 'Sample library · no Spotify scan' : `${scanned.length} playlists scanned`}</strong><span class="pill">Read only</span></div><p>${scan.demo ? 'Synthetic metadata for exploring the app.' : `Scan finished ${date(scan.completedAt)}. These are snapshots, not live Spotify state.`}</p><p>${omissions} unsupported or unavailable entries could not be matched · ${review.liveExcluded} live recordings and ${review.distinctVersionsExcluded} other distinct versions excluded from grouping and replacement suggestions (acoustic, remixes, demos, edits, covers, alternate takes and re-recordings).</p><div class="coverage-items">${scan.playlists.map((playlist) => `<span class="coverage-item" title="${html(playlist.error ?? playlist.omissions.map((item) => `#${item.position}: ${item.reason}`).join('; '))}"><span class="coverage-mark ${playlist.status === 'scanned' ? '' : 'warn'}">${playlist.status === 'scanned' ? '✓' : '!'}</span>${link(playlist.spotifyUrl, playlist.name)} <small>${html(playlist.status)}${playlist.scannedAt ? ` · entries read ${date(playlist.scannedAt)}` : ''}${playlist.reused ? ` · reused; snapshot checked ${date(playlist.snapshotCheckedAt)}` : ''}${playlist.omissions.length ? ` · ${playlist.omissions.length} unchecked entries` : ''}</small></span>`).join('')}</div><p>Consistency applies only to the entries read in these scanned playlists. ${playlists.filter((playlist) => !scan.playlists.some((item) => item.id === playlist.id)).length} listed playlists were not selected.</p>${scanLimitations()}</div>`;
  const filter = $('#song-filter').value,
    query = $('#song-search').value.trim().toLowerCase();
  const items = [
    ...review.groups.map((group) => ({ kind: 'group', group })),
    ...review.uncertainSongs
      .filter(
        (item) =>
          !dismissed.has(item.trackIds.join('|')) &&
          (filter === 'uncertain' ||
            !review.groups.some((group) =>
              item.trackIds.some((id) => group.tracks.some((track) => track.id === id)),
            )),
      )
      .map((item) => ({ kind: 'uncertain', item })),
  ].filter((entry) => {
    const tracks = entry.kind === 'group' ? entry.group.tracks : entry.item.tracks;
    const matches = tracks.some((track) =>
      `${track.title} ${track.artists.map((artist) => artist.name).join(' ')}`
        .toLowerCase()
        .includes(query),
    );
    return (
      matches &&
      (filter === 'all' ||
        (filter === 'uncertain' && entry.kind === 'uncertain') ||
        (filter === 'consistent' && entry.kind === 'group' && tracks.length === 1) ||
        (filter === 'inconsistent' && entry.kind === 'group' && tracks.length > 1))
    );
  });
  $('#result-count').textContent =
    `${review.groups.filter((group) => group.tracks.length > 1).length} songs with multiple versions · ${review.groups.filter((group) => group.tracks.length === 1).length} already consistent`;
  $('#review-detail').textContent =
    `· ${review.uncertainSongs.filter((item) => !dismissed.has(item.trackIds.join('|'))).length} ${review.uncertainSongs.filter((item) => !dismissed.has(item.trackIds.join('|'))).length === 1 ? 'song' : 'songs'} with related recordings needing review`;
  const count = Math.ceil(items.length / 10);
  groupPage = Math.min(groupPage, Math.max(0, count - 1));
  $('#groups').innerHTML =
    items
      .slice(groupPage * 10, groupPage * 10 + 10)
      .map((entry) => (entry.kind === 'group' ? groupCard(entry.group) : uncertainCard(entry.item)))
      .join('') ||
    '<div class="empty-state"><h2>No groups to review</h2><p>No confident matches fit this filter. This does not prove that every song version was identified.</p></div>';
  $('#group-pagination').innerHTML =
    count > 1
      ? `<button class="button compact" data-group-page="-1" ${groupPage === 0 ? 'disabled' : ''}>Previous</button><span>Page ${groupPage + 1} of ${count}</span><button class="button compact" data-group-page="1" ${groupPage + 1 === count ? 'disabled' : ''}>Next</button>`
      : '';
}
function renderPlaylists() {
  const query = $('#playlist-search').value.toLowerCase();
  const visible = playlists.filter((playlist) => playlist.name.toLowerCase().includes(query));
  $('#playlist-count').textContent = playlists.length;
  $('#selection-count').textContent = `${selected.size} selected`;
  $('#scan').disabled = loading || !selected.size;
  $('#playlist-list').innerHTML =
    visible
      .map((playlist) => {
        const status = scan?.playlists.find((item) => item.id === playlist.id);
        return `<div class="playlist-row"><input id="playlist-${html(playlist.id)}" type="checkbox" data-playlist="${html(playlist.id)}" ${selected.has(playlist.id) ? 'checked' : ''} ${loading ? 'disabled' : ''}><label for="playlist-${html(playlist.id)}"><strong>${html(playlist.name)}</strong><small>${playlist.items?.total ?? playlist.tracks?.total ?? 'Unknown'} entries · ${html(playlist.owner?.display_name ?? playlist.owner?.id ?? 'Unknown owner')}</small></label><span class="playlist-state" title="${html(status?.error ?? '')}">${status ? `${html(status.status)}${status.scannedAt ? ` · entries read ${date(status.scannedAt)}` : ''}${status.reused ? ` · snapshot checked ${date(status.snapshotCheckedAt)}` : ''}` : 'Not scanned'}</span>${link(playlist.external_urls?.spotify, 'Spotify')}</div>`;
      })
      .join('') ||
    '<div class="empty-state">Connect Spotify and load your playlists, or try the sample library.</div>';
  const previous = $('#destination').value;
  $('#destination').innerHTML =
    '<option value="">Select a playlist</option>' +
    playlists
      .map((playlist) => `<option value="${html(playlist.id)}">${html(playlist.name)}</option>`)
      .join('');
  $('#destination').value = previous;
}
function applyScan(value) {
  epoch++;
  scan = value;
  review = reviewScan(scan);
  choices.clear();
  catalogs.clear();
  pages.clear();
  dismissed.clear();
  groupPage = 0;
  renderReview();
  renderPlaylists();
  $('#duplicate-result').innerHTML = '';
}
async function loadPlaylists() {
  if (loading) return;
  const requestEpoch = epoch;
  if (!auth.connected()) {
    navigate('settings');
    notice('Configure your Client ID and connect Spotify first.');
    return;
  }
  loading = true;
  updateConnection();
  notice('Loading playlists…');
  try {
    const { playlists: fetched, excludedCount } = await spotify.ownedPlaylists();
    if (requestEpoch !== epoch) return;
    if (scan?.demo) {
      scan = null;
      review = null;
      choices.clear();
      catalogs.clear();
      renderReview();
    }
    playlists = fetched
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    selected = new Set(
      [...selected].filter((id) => playlists.some((playlist) => playlist.id === id)),
    );
    renderPlaylists();
    notice(
      `${playlists.length} owned playlists listed. ${excludedCount} other playlists excluded. Select the ones to scan.`,
    );
  } catch (error) {
    notice(error.message, true);
  } finally {
    loading = false;
    updateConnection();
    renderPlaylists();
  }
}
async function scanSelected() {
  if (loading) return;
  const chosen = playlists.filter((playlist) => selected.has(playlist.id));
  if (!chosen.length) return;
  controller = new AbortController();
  loading = true;
  const requestEpoch = epoch;
  $('#cancel-scan').hidden = false;
  renderPlaylists();
  notice('Reading selected playlists…');
  try {
    let value;
    if (scan?.demo && chosen.every((playlist) => playlist.id.startsWith('demo-'))) {
      value = demoScan();
      value.playlists = value.playlists.filter((playlist) =>
        chosen.some((item) => item.id === playlist.id),
      );
    } else
      value = await spotify.scan(chosen, {
        signal: controller.signal,
        forceRefresh: $('#force-refresh').checked,
        progress: (name, count, total) => {
          $('#scan-progress').textContent = `Reading ${name}: ${count} of ${total ?? '?'} entries`;
        },
      });
    if (requestEpoch !== epoch) return;
    applyScan(value);
    navigate('review');
    notice(
      `Scan finished. ${value.playlists.filter((playlist) => playlist.status === 'scanned' && !playlist.reused).length} playlists read fully; ${value.playlists.filter((playlist) => playlist.reused).length} unchanged playlists reused after fresh snapshot checks.`,
    );
  } catch (error) {
    notice(error.message, true);
  } finally {
    loading = false;
    controller = null;
    $('#cancel-scan').hidden = true;
    $('#scan-progress').textContent = '';
    renderPlaylists();
  }
}
async function findCatalog(groupId) {
  if (loading) return;
  const requestEpoch = epoch;
  const group = review.groups.find((item) => item.id === groupId);
  if (!group) return;
  const prior = catalogs.get(groupId) ?? { tracks: [], offset: 0 };
  catalogs.set(groupId, { ...prior, loading: true });
  renderReview();
  try {
    const response = scan.demo
      ? { tracks: demoCatalog, next: null, offset: 10 }
      : await spotify.search(group.tracks[0], prior.offset);
    const known = new Set([...group.tracks, ...prior.tracks].map((track) => track.id));
    if (requestEpoch !== epoch) return;
    let skipped = 0;
    const accepted = [...group.tracks, ...prior.tracks];
    const additions = response.tracks
      .sort((a, b) => a.album.localeCompare(b.album) || a.id.localeCompare(b.id))
      .filter((track) => {
        if (known.has(track.id)) return false;
        const valid = accepted.every((member) => compareTracks(member, track).outcome === 'match');
        if (!valid) skipped++;
        else {
          known.add(track.id);
          accepted.push(track);
        }
        return valid;
      });
    const tracks = [...prior.tracks, ...additions].sort(
      (a, b) => a.album.localeCompare(b.album) || a.id.localeCompare(b.id),
    );
    catalogs.set(groupId, {
      tracks,
      offset: response.offset,
      exhausted: !response.next,
      loading: false,
      note: `${response.searchedAt ? `Catalog metadata read ${date(response.searchedAt)}${response.reused ? ' (cached)' : ''}. ` : ''}${additions.length} additional compatible versions found. ${skipped} uncertain or different recordings kept out. ${response.next ? 'Search has more pages; choose Find more releases again.' : 'No further search pages returned. Spotify search may omit releases.'}`,
    });
  } catch (error) {
    if (requestEpoch !== epoch) return;
    catalogs.set(groupId, { ...prior, loading: false, note: error.message });
  }
  renderReview();
}
async function checkDuplicate(event) {
  event.preventDefault();
  if (loading) {
    notice('Wait for the current scan to finish.');
    return;
  }
  const requestEpoch = epoch;
  const id = parseTrackId($('#track-link').value),
    playlist = playlists.find((item) => item.id === $('#destination').value);
  if (!id) {
    notice('Enter a Spotify track link or spotify:track: URI.', true);
    return;
  }
  if (!playlist) return;
  $('#check-duplicate').disabled = true;
  notice('Checking the candidate and destination…');
  try {
    let destination = scan?.playlists.find((item) => item.id === playlist.id),
      candidate;
    if (scan?.demo) {
      candidate = [...demoCatalog, ...review.tracks].find((track) => track.id === id);
      if (!candidate)
        throw new Error(
          'This is sample mode. Use the example track URI shown when you loaded the demo.',
        );
    } else {
      candidate = await spotify.track(id);
      if (requestEpoch !== epoch) return;
      if ($('#refresh-destination').checked) {
        destination = await spotify.scanPlaylist(playlist);
        if (requestEpoch !== epoch) return;
        if (destination.status !== 'scanned') throw new Error(destination.error);
      }
    }
    const result = destination
      ? duplicateMatches(candidate, destination)
      : { checked: false, matches: [] };
    $('#duplicate-result').innerHTML =
      `<div class="panel result-panel"><h2>${!result.checked ? 'Destination was not checked' : result.matches.length ? 'Possible duplicate found' : 'No likely duplicate found among checked entries'}</h2><p class="muted">${result.checked ? `${scan?.demo ? 'Sample check with synthetic data. ' : ''}Checked against the playlist snapshot from ${date(result.checkedAt)}. Spotify may have changed since then. ${destination.omissions.length} destination entries could not be checked.` : 'Scan the destination or enable reading it again before checking. No absence claim can be made.'}</p><h3>Candidate</h3>${trackDetails(candidate, false)}${result.matches.map((match) => `<div style="margin-top:14px"><h3>Existing entry #${match.position} · ${match.exact ? 'same Spotify ID' : html(match.comparison.confidence) + ' confidence'}</h3>${trackDetails({ ...match.track, locations: [{ playlist: playlist.name, position: match.position, playlistUrl: playlist.external_urls?.spotify }] })}<p class="muted">${html([...match.comparison.evidence, ...match.comparison.uncertainty].join(' '))}</p></div>`).join('')}<p class="muted" style="margin-top:12px">Metadata matching can miss alternate versions. Nothing was added or changed.</p></div>`;
    notice('');
  } catch (error) {
    notice(error.message, true);
    $('#duplicate-result').innerHTML =
      '<div class="panel">The duplicate check did not complete. No conclusion can be drawn.</div>';
  } finally {
    $('#check-duplicate').disabled = false;
  }
}
function exportReview() {
  if (!scan) return;
  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    readOnly: true,
    scan,
    choices: [...choices].map(([groupId, versionId]) => {
      const group = review.groups.find((item) => item.id === groupId);
      const target = [...group.tracks, ...(catalogs.get(groupId)?.tracks ?? [])].find(
        (track) => track.id === versionId,
      );
      return {
        groupId,
        chosenTrack: target ?? null,
        leaveUnchanged: versionId === 'leave',
        differingPlacements:
          versionId === 'leave'
            ? []
            : group.tracks
                .filter((track) => track.id !== versionId)
                .flatMap((track) =>
                  track.locations.map((location) => ({
                    ...location,
                    fromTrackId: track.id,
                    toTrackId: versionId,
                  })),
                ),
      };
    }),
    uncertainPairs: review.uncertain.map((item) => ({
      trackIds: item.trackIds,
      comparison: item.comparison,
      keptSeparate: true,
    })),
  };
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    ),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `trackmark-review-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.view) navigate(button.dataset.view);
  if (button.dataset.catalog) void findCatalog(button.dataset.catalog);
  if (button.dataset.leave) {
    choices.set(button.dataset.leave, 'leave');
    renderReview();
  }
  if (button.dataset.dismiss) {
    dismissed.add(button.dataset.dismiss);
    renderReview();
  }
  if (button.dataset.versionPage) {
    pages.set(
      button.dataset.versionPage,
      (pages.get(button.dataset.versionPage) ?? 0) + Number(button.dataset.delta),
    );
    renderReview();
  }
  if (button.dataset.groupPage) {
    groupPage += Number(button.dataset.groupPage);
    renderReview();
  }
});
document.addEventListener('change', (event) => {
  if (event.target.dataset.playlist) {
    const id = event.target.dataset.playlist;
    event.target.checked ? selected.add(id) : selected.delete(id);
    renderPlaylists();
  }
  if (event.target.dataset.choice) {
    choices.set(event.target.dataset.choice, event.target.value);
    renderReview();
  }
});
$('#client-id-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (auth.connected() || loading) return;
  const clientId = $('#client-id').value.trim();
  if (!/^[a-zA-Z0-9]{32}$/.test(clientId)) {
    notice('Enter a valid 32-character Spotify Client ID.', true);
    return;
  }
  try {
    localStorage.setItem(CLIENT_ID_KEY, clientId);
    auth.disconnect();
    spotify.clearCaches();
    config.clientId = clientId;
    updateConnection();
    notice('Client ID saved in this browser. You can now connect Spotify.');
  } catch {
    notice('Browser storage is unavailable. Allow local storage to save your Client ID.', true);
  }
});
$('#forget-client-id').addEventListener('click', () => {
  if (auth.connected() || loading) return;
  try {
    localStorage.removeItem(CLIENT_ID_KEY);
    auth.disconnect();
    spotify.clearCaches();
    config.clientId = fileClientId;
    $('#client-id').value = config.clientId;
    updateConnection();
    notice(
      fileClientId
        ? 'Saved ID removed. Using the Client ID from your local configuration file.'
        : 'Saved Client ID removed from this browser.',
    );
  } catch {
    notice('Browser storage is unavailable. Could not remove the saved Client ID.', true);
  }
});
$('#connect').addEventListener('click', () =>
  auth.login().catch((error) => {
    notice(error.message, true);
    navigate('settings');
  }),
);
$('#disconnect').addEventListener('click', () => {
  epoch++;
  controller?.abort();
  auth.disconnect();
  spotify.clearCaches();
  scan = null;
  review = null;
  playlists = [];
  selected.clear();
  choices.clear();
  catalogs.clear();
  $('#duplicate-result').innerHTML = '';
  updateConnection();
  renderReview();
  renderPlaylists();
  notice('Disconnected. Session tokens and scan data cleared.');
});
$('#load-playlists').addEventListener('click', loadPlaylists);
$('#scan').addEventListener('click', scanSelected);
$('#cancel-scan').addEventListener('click', () => controller?.abort());
$('#demo').addEventListener('click', () => {
  if (loading) return;
  const value = demoScan();
  playlists = value.playlists.map((playlist) => ({
    id: playlist.id,
    name: playlist.name,
    owner: { display_name: 'Sample library' },
    items: { total: playlist.placements.length },
  }));
  selected = new Set(
    value.playlists
      .filter((playlist) => playlist.status === 'scanned')
      .map((playlist) => playlist.id),
  );
  applyScan(value);
  $('#track-link').value = `spotify:track:${demoTrackId}`;
  notice('Sample library loaded. All metadata is synthetic; Spotify has not been scanned.');
});
$('#select-all').addEventListener('click', () => {
  if (loading) return;
  const query = $('#playlist-search').value.toLowerCase();
  playlists
    .filter((playlist) => playlist.name.toLowerCase().includes(query))
    .forEach((playlist) => selected.add(playlist.id));
  renderPlaylists();
});
$('#clear-selection').addEventListener('click', () => {
  if (!loading) {
    selected.clear();
    renderPlaylists();
  }
});
$('#playlist-search').addEventListener('input', renderPlaylists);
$('#song-search').addEventListener('input', () => {
  groupPage = 0;
  renderReview();
});
$('#song-filter').addEventListener('change', () => {
  groupPage = 0;
  renderReview();
});
$('#duplicate-form').addEventListener('submit', checkDuplicate);
$('#export').addEventListener('click', exportReview);
function themeLabel() {
  $('#theme-toggle').textContent =
    document.documentElement.dataset.theme === 'dark' ? '☀ Light mode' : '☾ Dark mode';
  $('#theme-toggle').setAttribute(
    'aria-label',
    `Switch to ${document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'} mode`,
  );
}
$('#theme-toggle').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  try {
    localStorage.setItem('trackmark-theme', theme);
  } catch {}
  themeLabel();
});
themeLabel();
navigate(location.hash.slice(1) || 'review');
updateConnection();
renderReview();
renderPlaylists();
try {
  await auth.callback(callbackUrl);
  updateConnection();
  if (auth.connected()) await loadPlaylists();
} catch (error) {
  notice(error.message, true);
  updateConnection();
}
