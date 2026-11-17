# Node-free runtime verification — 2026-11-16

The remaining production HTTP endpoints now run in `r-cross-cannon`. One
Rust/Axum process serves both existing edge ports with one router and loaded
Library. Node remains an off-server build, import/export and test tool. The unified runtime was deployed and production-verified on 2026-11-16.
No production schema maintenance or search-index update was performed.

## Completed migration

- Google OAuth/OIDC with PKCE, browser-bound one-use state, verified RS256 ID
  tokens, issuer/audience/nonce checks and opaque hashed browser sessions.
- Account documents and explicit sign-in/sign-out/native-consent browser actions.
- Reading-progress and study-item compare-and-swap protocols, account isolation,
  Unicode validation, deletion tombstones and existing database identity.
- Native browser consent, device proof, one-use return tickets and independent
  revocable session tokens.
- Compatibility search form POSTs and commentary metadata using the existing
  Rust search engine and read-only indexes.
- A single Rust systemd service and checksummed Linux release package, including
  removal of the legacy Node ExecStart override and rollback restoration.

Existing Google provider/user IDs, progress and study rows, native token hashes
and offline checkpoints are preserved. Old browser cookies intentionally require
fresh sign-in, as authorized. Runtime startup opens existing account storage;
schema initialization remains an explicit database-maintenance command.

## Verification

- `npm run verify`: **passed**. This includes 95 off-server JS/TS tests,
  22 Python tests, real browser audio, five shared artifact tests, TypeScript
  checks, Rust tests, production builds, both Rust listeners, mobile startup
  budgets, real compatibility search forms, resource ranges and the complete
  temporary-account browser/native journey.
- Local Rust API: **36 library tests plus one TCP test passed**, including actual
  read-only search indexes, session renewal/revocation, invalid credentials,
  same-origin writes, progress/study conflicts and native proof/ticket redemption.
- Five authentication tests include real RSA signatures, a loopback Google
  token/JWKS provider, the complete callback-to-session-cookie HTTP flow and
  replay rejection. Invalid signatures, algorithms, issuer, audience, nonce,
  expiration, identity and unverified email are rejected.
- Full WASM browser journey passed directly against the unified Rust server:
  responsive reading, deep links, keyword search, highlights, note formatting,
  commentary, account documents, offline reload, single-writer tab handoff and
  one-time legacy checkpoint/study import. No browser errors were reported.
- Signed-in browser/native journey passed with a temporary SQLite account:
  actual consent-button approval, proof-plus-ticket single-use redemption,
  progress conflicts, Unicode note sync, desktop sign-out, independent native
  revocation and the explicit database-maintenance guard. The mobile app-return
  attempt can leave Chromium's automated mouse input inactive; the desktop
  journey uses a fresh focused tab with shared browser cookies. It performs a
  real button click and checks the response and signed-out document.
- Linux x86-64 release build passed **33 library tests plus one TCP test**. The
  three private-index tests are excluded in the compiler container and run in
  local verification instead.
- Release packaging and rollback: **13 Python tests passed**, including closed
  SQLite sidecars, legacy unit overrides, failed health checks and preserving
  account writes during rollback. Three binary/build-boundary tests passed.
- The combined release package validated its ELF architecture, checksums,
  compiler inputs and browser artifact receipt. It contains 23,115 files,
  including one approximately 14-MiB ELF, and no Node modules, server JavaScript,
  live database, secret environment file or compiler. Archive size: 256,940,253
  bytes for this local build.
  The activation-side validator independently accepted all 23,115 checksummed
  files without activating or contacting production.
- That exact Linux ELF also passed in a clean Debian x86-64 container with
  **neither Node nor npm installed**, networking disabled, an unprivileged user,
  a read-only root filesystem and read-only text/vector mounts. One process
  served ports 3005/3006, both health endpoints, reader and configured temporary
  accounts, account/consent HTML, byte-identical text and worker resources, and a
  1,024-byte audio range response. The temporary account database lived only in
  container tmpfs. Observed RSS was approximately 790 MiB; this is one local snapshot,
  not a before/after memory benchmark.

## Controlled performance comparison

The preceding architecture pass compared delivery of the **same final artifact**
through Node and Rust at 393 × 852, scale 2, fresh contexts, cache disabled,
80-ms emulated latency and 1,250,000 bytes/second download throughput. Each
mode/origin was measured once; small timing differences support a flat-to-modest
improvement, not a production latency claim.

| Journey | Node readable | Rust readable | Node critical bytes | Rust critical bytes |
| --- | ---: | ---: | ---: | ---: |
| Deep link | 5,297 ms | 5,147 ms | 5,565,300 | 5,249,911 |
| Saved Chapter | 5,330 ms | 5,065 ms | 5,603,437 | 5,286,752 |

Critical transfer fell about **5.7%**. The initial gzip-only Rust candidate was
rejected for higher transfer; build-time Brotli removed that regression. Fifty
interleaved warm loopback requests measured shell median/p95 of 1.14/1.60 ms
(Node) and 0.51/0.90 ms (Rust), and manifest 6.51/9.99 versus 2.47/4.14 ms.
WASM HEAD was effectively flat. These are local delivery measurements.

The shared native single-Chapter MSB projection microbenchmark measured about
2,552 → 37.58 µs (approximately 68× faster) over the actual Library and 1,000
repeated fragments. That isolates projection rather than whole-app startup.
Native regressions, WASM checks and the iOS simulator library check passed.
The macOS measured reader geometry was preserved.

Current startup checks retain the 8-second readable-paint and 8-MiB critical
transfer budgets in `scripts/browser-startup.test.mjs`. No production latency,
battery or before/after memory improvement is claimed.

## Evidence and release boundary

Local logs: `.tmp/node-free-verify.log`, `.tmp/node-free-reader-browser.log`,
`.tmp/node-free-account-browser.log`, `.tmp/node-free-linux-build.log`.
The Linux runtime evidence is `.tmp/node-free-linux-smoke/evidence.txt` and
`container.txt` in that directory.
Browser screenshots and JSON reports are under ignored
`docs/screenshots/node-free-reader/` and `docs/screenshots/node-free-accounts/`.
The locally packaged release is `.tmp/node-free-release.tar.gz`.

The automated Google provider uses test-only signing keys and temporary storage.
Live Google consent and a physical-device app-link return have not been performed
in this pass. Those manual checks are documented in [Google login](../google-login.md) and
[deployment guide](../deployment.md). OIDC verification follows Google's
[OpenID Connect documentation](https://developers.google.com/identity/openid-connect/openid-connect).

## Production release

Deployed to `https://www.crosscanon.com` at approximately **13:44 UTC** on
2026-11-16. `npm run ship` passed fresh local verification and published compiler
snapshot `3d57433e48b562e3729a4adcc09db26bc4c44add`.
The [hosted Linux build](https://github.com/jacksonStone/cross-cannon/actions/runs/43877099820)
passed and produced the deployed binary.

The first activation rolled back because its public form health fixture asked
for three matches, below the existing 5–40 form contract. A local reproduction
confirmed three returns 400 and five returns 200. The health fixture was corrected
to five; all 13 release/rollback tests passed again. The retry reused the same
tested binary and completed successfully.

`npm run verify-prod` passed: the managed executable is Rust, the legacy API
service is inactive/disabled, both ports return healthy responses, and reader,
workers, cross-corpus compatibility searches, compressed resources, audio ranges,
edge routing and private account endpoints work through the public site.
Production's anonymous account response also confirms `configured: true`,
`user: null`, `X-Cross-Canon-Runtime: rust` and `Cache-Control: private, no-store`.
Both listeners report 495 Books, 315,170 Passages and 23,896 stored vectors.

Deployment used the closed-file account relocation and storage-preserving
activation; no database initialization, scripture refresh or indexing command ran.
Existing browser sessions require fresh Google sign-in as authorized.
Logs are `.tmp/node-free-ship.log`, `.tmp/node-free-ship-retry.log` and
`.tmp/node-free-production-account.json`. The deployed package is under
`.tmp/rust-server-linux-37de90fb4a9d/`.

## Repository cleanup after release

Removed the retired Remix/React server, Better Auth implementation and duplicate
TypeScript protocol oracles after the Rust account/search contracts passed.
Retained maintenance helpers live under `scripts/lib/`; the package manifest now
has six development dependencies. Release helpers and their tests use unified
server names. Historical hosted branch/tag identifiers remain compatible.

Fresh `npm run verify` passed after cleanup: 33 Node tooling tests, 22 Python
tests, browser audio, five shared artifact tests, 36 Rust API tests plus the TCP
test, typecheck, production builds, startup budgets and account/native browser
journeys. The complete responsive/offline WASM reader journey passed again with
no browser errors. Local documentation links and whitespace checks pass.
Logs: `.tmp/repo-cleanup-verify.log` and `.tmp/repo-cleanup-browser.log`.

Obsolete scratch investigations, generated diagrams, superseded manuals and old
build/deploy bundles were removed. Current source/edition research, reviewed
content overlays, device evidence and published immutable text assets remain.
Older installed native catalogs can still reference those published asset URLs.
This cleanup did not deploy again or perform database maintenance.
