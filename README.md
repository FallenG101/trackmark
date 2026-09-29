# Trackmark

A complete read-only web app for reviewing likely same-song versions across selected Spotify playlists. It groups metadata cautiously, shows the releases and exact playlist placements, and lets you choose a Spotify version or leave everything unchanged. Your choices create a review plan; playlist changes are deliberately a later phase.

## Run locally

On this Mac, double-click **Start Trackmark.command** to use the available Node runtime. Otherwise install Node.js 20 or newer (Node.js 24 recommended). There are no runtime or build dependencies to install.

```sh
npm start
```

Open **http://127.0.0.1:4173/**. The app needs an HTTP server for its JavaScript modules; opening `index.html` as a file does not run the app correctly.

Choose **Try sample library** to explore all review interactions without Spotify. All sample metadata is synthetic. The app defaults to dark mode and remembers theme changes.

## Connect your Spotify account

1. Create or use an app in [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Register the exact redirect URI displayed in **Setup & privacy** (including the final slash). Locally this is **http://127.0.0.1:4173/**. On a hosted site it is the site's HTTPS address. Spotify does not allow `localhost` as a redirect hostname.
3. Open **Setup & privacy**, paste your Client ID, and choose **Save Client ID**. Do not add a client secret. The browser uses Authorization Code with PKCE.
4. Choose **Connect Spotify**, select playlists, and choose **Scan selected**.

Only playlists whose owner ID matches your signed-in Spotify account are listed for scanning and duplicate checks. Followed playlists and collaborative playlists owned by someone else are excluded. If account identity cannot be verified, playlist loading stops.

The Client ID is public application metadata and is saved in this browser's local storage along with your theme preference. **Forget saved ID** removes it; disconnect before changing the ID. You can optionally supply it in `app/config.local.js` using `app/config.example.js`; that file is excluded from Git and static builds, and a browser-saved ID takes precedence. Access and refresh tokens stay in this browser tab's session storage. Disconnect clears the session and in-memory scan data. Scans and choices are not uploaded to a backend and disappear on reload.

Spotify's current development-mode restrictions require the app owner to have Premium and restrict account access. Playlist contents may be accessible only when you own the playlist or collaborate on it. Inaccessible playlists are shown explicitly. See [Spotify's development-mode migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide) and [redirect requirements](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).

## What is implemented

- Playlist selection and complete pagination, with scan timestamps per playlist.
- Snapshot comparison before and after reading each playlist. Changed, cancelled, incomplete, inaccessible, and unscanned playlists are excluded from matching.
- Unsupported episodes, local tracks, and unavailable entries reported as unchecked placements.
- Deterministic matching by base title, primary artist identity, duration, ISRC, artist credits, and preserved version labels.
- Complete-link groups: every member must match every other member, with stable ordering and no weak-match chains.
- Song-centered review with pairwise evidence and uncertainty, Spotify links, and all matching playlist placements.
- Live recordings excluded from consistency decisions. Covers, remixes, acoustic recordings, demos, edits, alternate takes, and re-recordings remain separate when evidence is insufficient.
- Neutral choices, up to five options per page, catalog search for compatible releases, no preselected preferred version.
- Exact differing-entry preview, explicit leave-unchanged decisions, and downloadable review JSON.
- Duplicate check for a track link or URI against a newly read destination playlist or its dated library scan. It cannot intercept actions inside Spotify.
- Responsive interface, dark/light themes, keyboard controls, and visible read-only status.

Confidence labels describe matching rules, not probabilities. Metadata does not establish recording identity with certainty. Missing or contradictory information stays uncertain. Spotify search may omit versions, and the app does not claim an exhaustive catalog.

## Checks and build

```sh
npm test
npm run build
```

`npm test` runs independent tests with Node's built-in test runner: matching examples, review placement preservation, duplicate checks, PKCE/state validation, permissions, token refresh, API pagination, scan conflicts, and errors. No test calls Spotify.

`npm run build` creates `dist/` as a portable static website, excluding local configuration. Hosted sites automatically use their own HTTPS address as the Spotify redirect; users enter their Client ID in the setup page.

## Website hosting

The app runs entirely in the browser and needs only static HTTPS hosting. It does not need a backend server. Spotify access remains read-only, and scans stay in browser memory.

- **GitHub Pages:** publish from `main`, repository root. The root page opens `app/`, and the Spotify redirect will be `https://falleng101.github.io/trackmark/app/`. GitHub Free requires a public repository for Pages; changing repository visibility requires the owner's approval.
- **Netlify:** import this repository. `netlify.toml` sets the build command and publishes `dist/`. Alternatively, build locally and upload the contents of `dist/` using Netlify's manual deploy flow.

After deployment, open **Setup & privacy** and copy the displayed HTTPS redirect into your Spotify Developer Dashboard's allowed redirect URIs. Enter your Client ID again on the hosted site: browser storage is separate for each site address. The local development server is no longer needed to use a deployed site.

## Code map

| Location                | Responsibility                                                 |
| ----------------------- | -------------------------------------------------------------- |
| `app/core/matching.mjs` | Pure, deterministic comparisons and grouping                   |
| `app/core/review.mjs`   | Track adaptation, placements, review data, duplicate detection |
| `app/lib/auth.js`       | PKCE, state verification, session tokens, refresh              |
| `app/lib/spotify.js`    | GET-only Spotify metadata reads and verified scans             |
| `app/lib/demo.js`       | Synthetic sample library                                       |
| `app/app.js`            | UI state, rendering, choices, filters, and actions             |
| `scripts/dev.mjs`       | Loopback-only development server                               |
| `scripts/build.mjs`     | Static build with local config excluded                        |
| `test/`                 | Offline behavior and safety tests                              |

The app does not download Spotify audio, perform playback, use audio features, or train a machine-learning model. Spotify metadata links back to Spotify; the logo in `app/assets/spotify-logo.svg` is Spotify's official supplied asset and remains their trademark.

Future playlist writes are specified in [the product plan](docs/product-plan.md), with separate permission, backup, freshness, exact-placement approval, and uncertain-write handling. This release contains no playlist mutation API.
