# Matching model

The matcher proposes recording relationships using deterministic rules. Confidence is a descriptive outcome, not a probability or a correctness guarantee.

Title normalization folds Unicode presentation, case, punctuation and whitespace while preserving letters and numbers in all scripts. A separate comparison key removes recognized bracketed or suffix version annotations. Labels remain in the track metadata and are evaluated independently. Unknown qualifiers are retained.

Primary Spotify artist IDs establish identity. Different primary IDs cannot be overridden by matching names or a shared featured artist. Names without IDs provide review evidence only. Different artist credits lower certainty.

A match requires compatible base titles, artist IDs and credits, durations within two seconds, and no conflicting recording labels or ISRCs. A matching ISRC raises confidence, but cannot override conflicting durations. Acoustic, unplugged, stripped, remixed, demo, alternate take, edit, cover, instrumental, a cappella, speed-changed and re-recorded versions (including Taylor's Version) are excluded entirely from consistency groups, related recording suggestions and catalog replacement options, even when both tracks share labels or an ISRC. Remaster and explicit/clean labels remain eligible and do not choose a preferred release. Exact Spotify IDs can still produce duplicate warnings for excluded versions.

Live recordings are always excluded from consistency choices, including separate live performances. An exact live track ID can still trigger a duplicate warning in a destination playlist. Words such as “Live” in a song's base title do not automatically establish a live performance. Metadata can omit performance labels; those omissions remain a limitation.

Relinked metadata retains the original source ID when Spotify exposes it and does not establish automatic recording matches across different source IDs. The API may omit relinking evidence, so market identity cannot always be verified.

Groups are complete-link: every track must have a match against every other member. Candidate catalog versions must match every scanned member and every accepted catalog candidate. Input ordering is stabilized by ID. Ambiguous pairs remain outside replacement groups. The UI collects those comparisons under a song heading only for presentation; it does not infer group membership from them.

Review covers only successfully scanned entries. Pagination must complete and Spotify snapshot IDs must agree before and after a playlist read. Missing snapshots, interrupted reads and concurrent changes prevent a verified scan. Unsupported or unavailable entries are reported separately and cannot support consistency claims.

Test examples cover different IDs, reissues, compilations, remasters, Taylor's Version, explicit/clean variants, title and Unicode variations, live performances, covers, remixes, acoustic recordings, demos, edits, alternate takes, ambiguous metadata, shared featured artists, contradictory ISRC evidence, and weak-match chains. They use synthetic metadata and never call Spotify.
