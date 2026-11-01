# Rust resource routes

Move all remaining non-React resource route behavior to Rust: original and
continuous audio, Scripture cache, Early Christian metadata/alignment JSON,
Chapter JSON, and the localhost-only service-worker release test endpoint.
Preserve existing URLs through thin streaming transport shims. React pages and
their loader/action wiring remain in Remix. Keep range seeking, HEAD, gzip bytes,
content lengths, cache headers and ETags working, without whole-file buffering.
Restrict paths and prevent symlink escapes. Preserve legacy MP3 invalid-range
fallback and continuous audio 416 responses. Keep the test worker inaccessible
on the public host. Reuse all existing data and media; regenerate nothing.
Verify, review, publish Rust first then web, and commit only this migration.
