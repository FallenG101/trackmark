# Product boundary and future phases

The shipped app is the read-only MVP: matching, selected-playlist scanning, song review, optional duplicate checking, and local export. Scan data and choices live in memory. A review choice does not change Spotify. Claims refer only to the successful scan's entries and date.

Before considering writes, validate matches on user-reviewed examples and measure false positives. Expand deterministic fixtures from observed edge cases without training a model on Spotify content. Keep uncertain recording relationships separate.

A future write phase requires its own implementation and validation. Request playlist modification permissions only then. Compile a concrete change plan containing exact playlist IDs, ordered placements, original IDs, and chosen replacements. Require clear confirmation for the exact plan, after backup and a fresh snapshot check. Preserve unrelated entries, duplicates, and order. Avoid whole-playlist replacement or URI-wide removals that could alter unapproved placements.

Spotify mutation operations are not atomic across a sequence or multiple playlists. Snapshot checks cannot eliminate a concurrent-edit race. If a position-preserving, bounded operation cannot be performed safely with the API available to the user, decline that operation rather than broaden the change. Backups must include original ordered entries and scan state, with a verified recovery path. An uncertain write response must stop the run and require reconciliation; never retry it automatically. Post-write verification reports approved operations completed, failed, or unresolved without claiming a transaction guarantee.

Playlist changes remain outside this release. No write scopes or playlist mutation calls are present.
