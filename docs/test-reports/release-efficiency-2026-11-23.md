# Verified release reuse

The maintenance-only compact-overlay release previously took 635.7 seconds
(10m36s), including an unnecessary Linux build and 340.2-MiB upload. The new
unchanged-runtime path completed against that same production release in
71.2 seconds, an 88.8% reduction. This is one measured run, not a latency guarantee.

| New ship phase | Seconds |
| --- | ---: |
| Inspect local inputs and verify active production bytes/unit | 35.6 |
| Maintenance unit tests and TypeScript | 13.7 |
| Confirm unchanged inputs and production metadata | 10.2 |
| Production verification | 11.8 |

The phase values are individually rounded. The command returned success and
reported `Runtime unchanged: no Linux build, archive, upload or restart.`
Production checks confirmed one managed Rust process on both compatibility
ports, browser artifacts/workers, existing-vector searches, immutable resource
bytes, compression/audio ranges, edge route boundaries and account privacy.

## Change

`npm run ship` uses the existing release entry point. It compares the exact
runtime against the active release before selecting verification/build work.
A match still runs tooling tests, typechecking and production checks. A changed
runtime still runs full app verification. Needed hosted CI starts before that
suite, with fetch/package/upload allowed only after successful local checks.

Linux artifacts are reusable across unrelated Git commits only when compiler,
Docker context/recipe, pinned toolchain/image, Linux test workflow and validator
policy match. Artifact reuse also checks ELF architecture, checksums and actual
source revision. Source snapshots include uncommitted and new Rust files plus
Docker context-policy additions/edits/deletions without mutating HEAD or index.

The runtime comparison requires current browser source/artifacts, compiler and
build-recipe inputs, exact static file set/hashes and service unit. The active
release, actual installed unit and all recorded bytes are verified under the
shared deployment lock. A token from that successful check can be used only
within the same invocation to confirm unchanged receipt/file set/device/inode/
mode/size/mtime/ctime. Tokens are not persisted. Older receipts use checksum-
verified BUILD-INFO and the corresponding Git build recipe; uncertain provenance
forces the normal path. A concurrent edit or deployment prevents a skip.

Changed releases keep complete archives, atomic activation, rollback and account/
storage preservation. Packaging is pinned to the verified runtime snapshot and
rejects late file additions as well as content/source/recipe changes. No database
or Scripture-cache maintenance was performed. No runtime files changed in this fix.

## Validation

The initial `python3 scripts/test-release-efficiency.py` reproduced the bug:
documentation-only commits incorrectly changed the hosted build revision. The
fixed test suite passes all 25 cases, including actual local Git publisher
fixtures, precise build-recipe invalidation, metadata/byte proofs, corrupt cache
rejection, missing browser output, explicit revision constraints, installed-unit
drift, concurrent edits, CI-before-verification ordering and failure-before-upload.

All 14 release boundary/activation tests pass, including actual simulated shared
activation and rollback preserving accounts/WAL data. A regression injects an
unverified public file during artifact validation and proves it cannot enter the
archive. The final tests are included in `npm run test:unit`.

The full app suite passed:

```bash
PATH=/Users/jacksonstone/.nvm/versions/node/v24.13.0/bin:$PATH \
  VERIFY_PORT=3327 VERIFY_COMPAT_PORT=13327 npm run verify
```

After review fixes, the complete tooling suite, typecheck and production checks
passed through the measured new command:

```bash
PATH=/Users/jacksonstone/.nvm/versions/node/v24.13.0/bin:$PATH \
  VERIFY_PORT=3327 VERIFY_COMPAT_PORT=13327 npm run ship
```

Separate standards and correctness reviews found four issues (Docker context
policy snapshotting, explicit revision handling, installed-unit proof and late
package-file collection); all were fixed and covered by regression tests. Both
reviewers reran the final 25+14 tests and reported no remaining actionable findings.

Logs are under `.tmp/release-efficiency-verify.log`,
`.tmp/release-efficiency-plan-final.log` and `.tmp/release-efficiency-ship.log`.
The earlier baseline is `.tmp/compact-modernization-ship.log`.
