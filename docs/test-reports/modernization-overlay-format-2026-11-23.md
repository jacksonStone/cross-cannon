# Compact modernization overlay validation

The durable overlay format now stores exact UTF-8 edits against immutable source
text, with source/result SHA-256 hashes and complete reviewed-segment counts.
The assembler emits format 2; publication and source imports accept both formats.
Published reader resources keep their existing bytes and format.

## Actual conversion

| Checkout | Chapters | Reviewed segments | Before bytes | After bytes |
| --- | ---: | ---: | ---: | ---: |
| Main | 114 | 2,357 | 842,914 | 228,340 |
| Study integration worktree | 2,027 | 250,362 | 74,513,566 | 3,764,789 |

The integration set includes the 114 Imitation Chapters also present on main.
Its reduction is 94.95%; the converted files total 1,886,459 bytes with independent
gzip-9 compression per Chapter. Only 45,728 of its source segments have edits.
These are durable-overlay sizes, not browser download measurements.

Both migrations proved exact expanded entries and reconstructed original overlay
bytes before replacing any files. Both were run again with `--write` and reported
zero conversions and identical sizes. No live publication, Scripture-cache generation,
database update, index generation or deployment was performed.

## Validation

- Sixteen format/migration/publication tests pass, including 600 deterministic
  randomized Unicode round trips. Coverage includes literal UTF-8 offsets,
  punctuation/whitespace, insertions/deletions, zero edits, nonconsecutive numbers,
  stale/reordered/renumbered source, missing/duplicate edits, corrupt result hashes,
  invalid/overlapping/out-of-range spans, fail-before-mutation application, mixed
  formats, canonical encoding, whole-directory preflight, atomic replacement,
  permissions, idempotence and failure of a second Chapter before any publication.
- Twelve commentary importer tests pass. A bounded actual import assembly runs
  with legacy and compact overlays for all seven Works and produces identical
  Chapters, catalog, manifest, coverage, quotation flags and source paragraphs.
- Nine quotation protection tests pass in the integration worktree, including
  migrated old-byte approvals, new compact-byte approvals, altered approved text,
  arbitrary formatting, and malformed historical quotation protections.
- Three actual approval workflow tests pass. Temporary Git repositories exercise
  pinned external approval import, acceptance, publication and the full corpus
  checker with both formats. Altered drafts and correctly hash-approved but
  noncanonical compact drafts fail before durable/manifest/import/request writes.
- Independent before/after corpus comparison covers all 2,027 integration
  Chapters and all 114 main Chapters. Every expanded entry, original approval
  byte hash, published Chapter byte hash, catalog and manifest is identical.
  The real publisher runs against isolated catalogs and immutable Chapter links:
  it produces no new assets and leaves catalogs/manifests byte-identical.
- The integration corpus checker passes: 4,734 commentary Chapters inventoried;
  1,913 complete, 2,821 remaining, none skipped; 248,005 source segments reviewed,
  43,508 edited. Originals, IDs, metadata, coverage, Greek/Hebrew, quotations,
  independent review receipts and old assets are preserved. Editorial status
  and the progress manifest are unchanged by storage migration.
- Standards and correctness reviews completed; all reported compatibility
  findings were fixed and covered by the approval workflow regressions.

## Full verification

Main passed:

```bash
VERIFY_PORT=3327 VERIFY_COMPAT_PORT=13327 npm run verify
```

This includes tooling, Rust Library/native/server tests, TypeScript, production
build, real browser startup/upgrades/offline reading/navigation/audio/search,
resource bytes/compression/ranges and account/native handoff checks. The final
tooling suite was also rerun after the parser/approval fixes; subsequent added
publication regression passes in the focused 16-test suite.

Integration verification ran with:

```bash
VERIFY_PORT=3337 VERIFY_COMPAT_PORT=13337 npm run verify
```

Every stage through account documents passed, including its extra desktop/mobile
commentary hierarchy checks. The final account journey selected Node 20.15.0 and
failed to import `node:sqlite`; no application assertion failed. That final stage
then passed when rerun explicitly with the installed Node 24.13.0:

```bash
/Users/jacksonstone/.nvm/versions/node/v24.13.0/bin/node scripts/e2e-rust-accounts.mjs
```

Thus all integration verification stages passed, with the final stage completed
separately under the supported runtime rather than a single green invocation.

Local logs: `.tmp/compact-modernization-verify.log` in each checkout, plus
`.tmp/compact-modernization-final-unit.log` on main and
`.tmp/compact-modernization-corpus-check.log` and
`.tmp/compact-modernization-accounts-node24.log` in the integration worktree.
Before/after hashes and migration summaries are under the root checkout's
`.scratch/modernization-format-exploration/`.
