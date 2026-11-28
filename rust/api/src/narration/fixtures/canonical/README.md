# Canonical narration test inputs

These are test-only inputs within the existing Rust/compiler/Docker boundary.
They are not added to the production runtime payload or compiled into the server.

- All 29 vetted On Prayer chapters, 249 original/modernized passages, byte-for-byte
  copies of the title-scoped runtime assets.
- Catalog projections preserving every current Work's exact licensing metadata
  (410 Early Christian Works, 7 Classics). Only On Prayer retains all Chapter
  entries; Treasury of David retains the Psalm 119 entry for its existing test.
- MSB provenance/rights metadata, without the full translation.
- The unchanged, already-live Treasury of David Psalm 119 artifact needed to
  retain the actual largest-Chapter (>2,048 units) regression assertion. Its
  source bytes were checked against the live release receipt before copying.

`pins.json` records exact SHA256 identities and catalog counts. The explicit
maintenance command is `python3 scripts/build-narration-test-fixtures.py`; it
copies existing local inputs and never generates text or updates a database.
Ordinary build, verification, startup and deployment do not regenerate fixtures.

Portable Rust/CI tests use this bundle. Full `npm run verify` sets
`CROSS_CANON_REQUIRE_NARRATION_RUNTIME_INPUTS=1`, requiring real runtime assets
and comparing them to these pins/projections. Missing or changed real inputs
fail; assertions are not skipped or silently redirected. No full corpus,
recording, browser build, storage/index/account DB or credential is included.
