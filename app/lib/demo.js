const id = (suffix) => suffix.padStart(22, '0');
const artists = [{ id: 'demo-north-harbor', name: 'North Harbor' }];
const song = (suffix, overrides = {}) => ({
  id: id(suffix),
  title: 'Paper Satellites',
  album: 'Paper Satellites',
  releaseDate: '2012',
  artists,
  durationMs: 241000,
  isrc: 'DEMO001',
  explicit: false,
  playable: true,
  spotifyUrl: null,
  locations: [],
  ...overrides,
});
export const demoCatalog = [
  song('a'),
  song('b', { album: 'Collected Works', releaseDate: '2018' }),
  song('c', { album: 'Paper Satellites (2024 Remaster)', releaseDate: '2024', durationMs: 241420 }),
  song('d', { album: 'A Decade of North Harbor', releaseDate: '2022' }),
  song('e', { album: 'Singles Collection', releaseDate: '2023' }),
  song('f', { album: 'Paper Satellites (Deluxe)', releaseDate: '2015' }),
  song('g', {
    title: 'Paper Satellites (Acoustic)',
    album: 'Unplugged Sessions',
    isrc: 'DEMO002',
    durationMs: 260000,
  }),
];
export function demoScan() {
  const now = new Date().toISOString();
  const other = song('h', {
    title: 'Harbor Lights',
    album: 'City Maps',
    isrc: 'DEMO003',
    durationMs: 180000,
  });
  const live = song('i', {
    title: 'Paper Satellites (Live at the Pier)',
    album: 'Live at the Pier',
    isrc: 'DEMO004',
  });
  const rerecorded = song('j', {
    title: 'Paper Satellites (Re-recorded)',
    album: 'New Sessions',
    isrc: 'DEMO005',
  });
  return {
    id: 'demo',
    demo: true,
    startedAt: now,
    completedAt: now,
    playlists: [
      {
        id: 'demo-after',
        name: 'After Hours',
        status: 'scanned',
        scannedAt: now,
        snapshotId: 'demo-1',
        omissions: [],
        placements: [
          { position: 12, track: demoCatalog[0] },
          { position: 27, track: demoCatalog[1] },
          { position: 30, track: live },
          { position: 31, track: other },
        ],
      },
      {
        id: 'demo-road',
        name: 'Road Mix',
        status: 'scanned',
        scannedAt: now,
        snapshotId: 'demo-2',
        omissions: [{ position: 3, reason: 'Local track' }],
        placements: [
          { position: 8, track: demoCatalog[2] },
          { position: 19, track: other },
          { position: 20, track: rerecorded },
        ],
      },
      {
        id: 'demo-shared',
        name: 'Shared Favorites',
        status: 'inaccessible',
        error: 'Example of an inaccessible playlist.',
        placements: [],
        omissions: [],
      },
      { id: 'demo-weekend', name: 'Weekend', status: 'unscanned', placements: [], omissions: [] },
    ],
  };
}
export const demoTrackId = id('b');
