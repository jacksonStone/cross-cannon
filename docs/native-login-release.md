# Native Google login release — 2026-11-12

Google login and Reader Location sync are implemented for the native macOS and
iOS apps using the existing Cross Canon web OAuth client. Setup and GCP links
are in [google-login.md](google-login.md). No additional native GCP clients are
needed.

## Current release

The web backend was built and tested in local Linux/amd64 Docker with Node
24.13.0, then deployed through the shared activation, rollback and health-check
path to the existing Node 26.13.0 production service. No production compilation
or dependency installation was needed. Source fingerprint:
`ca7d75d381b7a19825396bc0b01ee6cdc108d1d0064edcb35d2d141cb19e9cf9`.

The account migration added the nullable native return-ticket hash column.
Existing accounts, Reader Locations and native sessions were preserved. The
canonical account migration was then rerun idempotently after deployment;
private environment and database files remained owner-only.

The current flow has no visible pairing code. Continue with Google opens the
browser directly; Continue as the chosen account returns a one-use ticket to
the app. The app must match its pending request and supply its private proof to
redeem that ticket. Persistent credentials never appear in return URLs.

iOS now uses the full default browser. During real-device testing, Google account
choices highlighted without navigating in the system authentication sheet, while
the same login worked in regular Safari. The user confirmed the Safari-based
native connection works. macOS retains ASWebAuthenticationSession and forwards
its callback through the native link handler.

The native Account panel is a compact bottom sheet on phones and a centered
panel on desktop. Sign-in, Close, Back to reading and Sign out fit without
scrolling at tested small-phone and landscape sizes. Reading progress details
are collapsed by default; conflicts expand when necessary. The browser
confirmation page also fits at 320×480 without scrolling.

## App artifacts and installation

- macOS Release bundle: `dist/Cross Canon Desktop.app`; portable archive:
  `dist/Cross Canon Desktop.zip`. The ZIP was extracted outside the synced
  Desktop folder and its signature verified. Finder metadata can reappear on
  Desktop bundles; the archive excludes it.
- iOS simulator and signed device Release builds passed. The latest signed
  device app is in
  `/private/tmp/crosscanon-native-login-device-build/Build/Products/Release-iphoneos/Cross Canon.app`.
- The prior Safari-based native login build was installed successfully, preserving
  app data. The final code-free/bottom-sheet build was installed successfully after the
  iPhone reconnected over Wi-Fi. The existing bundle identifier and app data were
  preserved. Receipt: `.tmp/native-login-simple-phone-install.json` (sequence
  3640).
- Updated previews: `docs/screenshots/native-account-ios.png`,
  `native-account-desktop.png`, and
  `native-login-approve-{mobile,desktop,small-phone}.png`.

## Verification

- `npm run verify` passed: 130 JavaScript/TypeScript tests, Python suites, Rust
  API checks, typecheck, build and local production smoke.
- All 50 active native reader tests passed across the full run and focused
  reruns; four existing live-network/performance checks remain ignored. The
  initial full run had five loopback fixture failures because sandbox networking
  was unavailable; all five passed unchanged with loopback access enabled.
- Seven focused native account regressions passed, including callback/request
  matching, credentials excluded from saved state, per-account offline queues,
  conflict handling, sign-out restoration, and primary controls visible without
  scrolling at 320×568, 393×852 and 844×390.
- `npm run e2e:accounts` passed using temporary test accounts: browser isolation,
  offline queue/conflicts, code-free native approval, ticket+proof redemption,
  native-to-web progress, session revocation and 320×480 confirmation layout.
  Server regressions also check ticket-required, single-use redemption and
  migration from the previous schema.
- Docker repeated the web tests/typecheck/build and tested the pruned Linux
  artifact, private-data rejection and production dependency loading.
- Production service, homepage, three-collection search, Rust resources and edge
  checks passed after activation. Native smoke passed for iOS and desktop:
  code-free request creation, private pages, pending proof checks, consent
  protection, Google callback/state/PKCE and invalid-session rejection.
- Final code-free login is covered by browser/server/native callback tests. Its
  real Google return on the physical phone remains a user check after installing
  the final build. No real Google account was impersonated or seeded into
  production. An optional interactive Mac check was unavailable while locked.

## Docker export correction

The first native backend release was delayed because exporting thousands of
individual runtime files into this synced Desktop checkout stalled after Docker
tests passed. Exporting the same scratch image as one tar stream completed in
6.5 seconds. The release helper now exports one tar stream and unpacks in an OS
temporary directory, retaining runtime hashes, source consistency checks,
private-data rejection and shared activation checks. The current release used
this path successfully; tar export took 5.3 seconds.
