# Christian Classics modernization implementation

- Scope: chapter-level reviewed overlays with exact original-text validation; preserve originals, passage IDs, existing immutable asset bytes and search vectors.
- Durable overlays: `data/public-domain/christian-classics/modernization/`, independent of generated assets. Explicit import reapplies overlays; focused publication rehashes only affected chapter assets and updates index/manifest.
- Existing Fathers assembler gains chapter scope and overlay output; it retains batch, review, duplicate, original-text and completeness checks.
- Web already exposes the text switch based on active chapter. Native needs chapter-aware availability.
- Content/review authored separately; no model calls, imports, indexing, deployment, or database changes in this implementation.

## Implemented

- `apply-church-fathers-modernization.ts`: optional chapter scope and overlay output, validating all selected chapter verses even if previously modernized. Existing full-work behavior remains the default.
- `classics_modernization.py` and `publish-classics-modernization.py`: validate overlays against originals, create immutable hashed assets, and update index/manifest. Explicit importer applies the same validation and retains existing hashed bytes.
- Native Classics version control follows active chapter where modern and original differ; web already tests the current chapter for `modernizedText`.
- Tests: `python3 scripts/test-classics-modernization.py` (3 passed), `npx tsc --noEmit` passed, Python compile passed. Rust formatting passed after formatting. `cargo check --offline -p cross-canon-desktop` blocked by missing cached `bincode`; network registry unavailable. Parent handles full verification/mobile build.
- Sample overlay and publication are intentionally left to parent to avoid concurrent data writes. No API, DB, deploy or git push.
- Fixture tests now run as part of `npm run test:unit`; a native regression loads source artifacts and verifies the version switch is available for Imitation Book 1 Chapter 1 and hidden in Chapter 2.
