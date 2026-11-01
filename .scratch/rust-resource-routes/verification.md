# Resource migration verification

Baseline: `0bf738f98`. All six explicit resource handlers now run in Rust:
original MP3, continuous audio, Scripture cache, Early Christian metadata and
alignment, Chapter JSON, and the local service-worker test wrapper. Existing
URLs use byte-preserving streaming transport shims. The web launcher dispatches
these before static middleware so public/build copies cannot bypass Rust.
React rendering, page loader/action orchestration and build assets stay in Node.

- `npm run verify` passed: 97 unit tests, TypeScript checking, Rust integration
  tests, release build, web build, both actual reader search actions, and resource
  smoke tests through the real web server.
- `cargo clippy --workspace -- -D warnings` and formatting checks passed.
- Resource checks compare original JSON and precompressed gzip bytes, lengths,
  ETags and cache headers; both audio routes support partial GET/HEAD; malformed
  continuous ranges return 416; traversal and public-host worker requests fail.
- Separate Spec and Standards reviews found no remaining material issues,
  including a second review of the resource-first launcher and deploy rollback.
- `npm run verify-prod` passed after publication, including the same resource
  checks through the public host and both readers' Rust-backed search actions.
- A focused mobile Chromium journey downloaded a complete First Clement Work
  through Rust, disabled browser networking, reloaded, and displayed the
  downloaded passage text successfully.

The full offline browser suite stops at its waiting-worker assertion: the
unchanged `public/cross-canon-sw.js` calls `skipWaiting()` on install, while the
suite expects the successful update to stay waiting. This migration does not
change that service-worker activation policy. The failure is recorded rather
than weakening the suite or changing unrelated offline behavior.

Rust release: `20261101T020017Z`. Web release: `20261101T020236Z`.
The existing build-only release path preserves installed dependencies. Its
systemd drop-in selects the resource-first launcher; rollback restores the
previous server, launcher, and service configuration. Rust builds reuse copied
build products in an isolated release, without touching the active executable.
No text, vector, audio or timestamp artifacts were regenerated or uploaded.
Unrelated checkout changes remain untouched.
