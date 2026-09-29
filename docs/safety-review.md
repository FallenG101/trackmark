# Playlist safety review · 29 September 2026

## Scope and outcome

This review covers the current read-only application, saved preferences, local change previews and review exports. It does not certify a future playlist editing feature. No live playlists were modified during verification.

The application exposes Spotify metadata reads through a GET-only reader. OAuth POSTs go only to Spotify's token endpoint. Playlist modification scopes are rejected. Choosing, remembering, overriding, clearing, exporting and matching versions operate locally. There is no apply-to-Spotify command or playlist mutation endpoint in this release.

## Changes made during the review

- Preference targets and exported plans must match every scanned group member. Missing, unavailable, relinked and excluded targets are blocked rather than substituted.
- Preferences store exact user-selected Spotify IDs per account and Client ID; sample preferences have a separate scope. Unknown artist identity cannot establish a preference key. Manual choices and leave-unchanged decisions override preferences for the current review.
- Plan preparation rejects missing, invalid or overlapping playlist positions. Every differing occurrence retains its playlist ID, original one-based position, source ID and target ID. Repeated songs are preserved as separate occurrences; chosen-ID entries are left out of the plan. Inputs are not mutated.
- Playlist pagination that skips or overlaps entries stops the scan. Failed, interrupted or changed scans cannot establish consistency.
- Spotify reads and OAuth token exchanges reject HTTP redirects. Foreign pagination URLs are rejected before sending the token.
- Cached playlist reuse requires two fresh matching snapshots and recent complete entries. Failed verification never returns cached success. Forced refresh bypasses the cache; fresh duplicate checks read entries again.
- Rate-limit responses stop scans, preserve unscanned coverage and enforce a cooldown without automatic retry. Already-aborted scans issue no requests.

## Evidence

All 54 offline tests passed using Node's test runner. Tests use synthetic metadata and mocked HTTP responses, with no Spotify account access. Coverage includes matching exclusions, weak chains, state/PKCE validation, rejection of write scopes, preference persistence/account separation, invalid targets, exact placement preservation, corrupted storage, overlapping pages, cache expiry/forced reads, changed snapshots, cancellation and rate limits.

The sample browser flow was checked for immediate preference application, restoration after reload, leave-unchanged override surviving catalog lookup, and forgetting a preference clearing an applied choice.

## Limits and future editing gate

Metadata matching can still be wrong. Snapshot IDs check playlist changes, not independent changes to track metadata; cached metadata is explicitly dated and can be refreshed. Preference persistence is browser-specific. These checks do not guarantee correctness of song identity.

Before playlist editing can ship, implement and test exact approved-entry confirmation, ordered backups, recovery, fresh ownership/snapshot checks, preservation of unrelated entries and duplicates, concurrent edits, cancellation between writes, partial failures, uncertain-response reconciliation, and post-write verification. An uncertain write must never be retried automatically. Spotify operations are not atomic across multiple calls; if an exact bounded change cannot be performed safely, refuse that change. These future write requirements remain unimplemented, so editing stays disabled.
