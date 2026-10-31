# Initial native/Rust API verification — 2026-10-31

- `npm run verify`: 86 web tests, TypeScript, build, homepage/search smoke passed.
- `cargo test --workspace`: core artifact completeness, native keyboard/dialog/
  offline-search behavior, read-only real-index and API contract checks passed.
- Rust formatting and Clippy with warnings denied passed.
- 491 bundled Books/Works; 150,073 reader passages; 12,956 Early Christian
  chapters. All 13,688 bundled source/cache/timestamp files compare byte for byte
  with the existing artifacts.
- `dist/Cross Canon Desktop.zip`: extracted to a new temporary folder, strict
  signature verified, `--check-library` passed from outside the checkout.
- Actual native reader and settings screenshots captured. Side-by-side comparison
  against the running web reader saved in `docs/screenshots/`.
- Both production services are active. R Cross Cannon loads 21,316 pre-existing
  vectors read-only; no passage/query corpus re-embedding, cache rebuild,
  transcription, alignment, or database maintenance was performed.
- Public `https://www.crosscanon.com/r/api`: health/cache-version match, keyword,
  Scripture similar, cross-corpus similar, and one live semantic theme query all
  passed. Smoke server times: keyword 14 ms, similar 17–29 ms; semantic theme
  1,067 ms including the query-embedding provider request. These are single smoke
  measurements, not a load benchmark.
- `npm run verify-prod`: active service, production homepage and legacy search
  smoke passed after the API bridge publication.

The normal remote web release failed during dependency reinstallation under its
900 MiB build cap. The exact production dependency lock matched the verified
local build, so `scripts/deploy-rust-api-bridge.sh` published only the compiled
bridge and retained a code rollback copy. No dependency or database update was
needed. The shared release allowlist's missing existing audio-source metadata
fixture was fixed; its patch is recorded under `rust/deploy/`.

First-version limits: no distribution notarization/Windows/Linux installers;
chapter-segment audio downloads before playback, without web continuous playback/
Media Session parity; no verse-level semantic highlights. Early Christian
semantic ranking currently returns the first paragraph of a matching chapter.
