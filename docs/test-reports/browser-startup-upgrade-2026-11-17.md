# Installed-reader startup recovery — 2026-11-17

Reported iPhone error:

```text
null is not an object (evaluating '$('reader-library').innerHTML=icons.library')
```

## Cause and reproduction

The Library/navigation change removed the separate `reader-library` button from
HTML. The older browser adapter at `fab6509d6^:web/platform.js` still assigns its
icon during `connect()`. A pre-existing worker serves network-first navigation
HTML but cache-first `/browser/` assets. Those mutable `start.js`, `platform.js`
and manifest URLs could therefore combine fresh HTML with older cached scripts.
Because offline registration follows readable startup, the failure also prevents
that page from reaching its normal worker-update flow; retrying can repeat it.

A minimal VM harness ran the actual old icon assignments against current HTML
IDs twice. Both runs produced null `innerHTML`; adding only the missing legacy
element made those assignments pass. The browser regression then seeded an
incumbent worker with the legacy mutable modules and loaded the current reader
from a real local Rust server. Before the fix:

```text
node scripts/browser-upgrade.test.mjs
AssertionError: New HTML loaded the incumbent worker's old startup:
Cannot set properties of null (setting 'innerHTML')
```

This is Chromium's equivalent of the reported Safari exception. Fresh origin
HTML, `start.js` and `platform.js` from production all matched their release
receipt (`70550ba7a6e19fd6a006`), and none contained the legacy icon assignment.
Thus the origin artifact was coherent; the reproduced installed-worker path
explains how the obsolete script reached the current page despite `no-cache`
HTTP headers.

## Fix

- Build byte-addressed startup JS and its relative module dependencies, CSS and
  fonts, rewriting their references before checksumming and compression.
- Pin startup to `manifest.<release>.json`, rather than the incumbent worker's
  mutable manifest alias.
- Stage `index.<release>.html` and the pinned manifest; offline navigation opens
  that exact document. A worker staging while the origin advances cannot cache
  the next release's mutable HTML as its own document.
- Keep previous immutable assets and the previous pinned manifest during build
  publication. Pinned manifest identity/gzip equality is checked alongside the
  existing browser receipt. Deployment still checksums the complete public tree.

No null-element workaround, preference reset, study database change, recording
deletion, native binary change, or server memory-policy change was needed.

## Validation

The regression passed after the fix (`d92309fd6ed8ca7dadfc`): installed legacy
worker → current mobile startup → update activation → offline reload. It
asserted the current manifest version, John 3 readability, retained local state,
zero browser exceptions, and fresh desktop startup. The same sequence now runs
inside `npm run verify`.

`npm run verify` passed under Node 26.13.0, including core/API/account tests,
production browser/server builds, the new installed-worker/offline regression,
startup budgets, scrolling, searches, resources, accounts and native handoff.
Two asset graph tests cover dependency/release address changes and nested
imports. A worker test stages release A while mutable aliases point at release B,
then verifies offline navigation and manifest selection still open A. Production
artifact smoke checks also verify immutable bootstrap URLs and pinned manifests.

Both code-review axes found no blocking issues. Mobile/desktop previews were
captured and visually inspected:

- [Mobile online](../screenshots/browser-upgrade/mobile-online.png)
- [Mobile offline](../screenshots/browser-upgrade/mobile-offline.png)
- [Desktop](../screenshots/browser-upgrade/desktop.png)

Local logs: `.tmp/browser-upgrade-green.log`, `.tmp/browser-upgrade-verify.log`,
and `.tmp/browser-upgrade-build.log`. The affected physical iPhone/Safari
installation was not directly available; browser emulation covers the reproduced
cache/DOM failure and upgrade sequence. Production deployment/verification is
recorded below after the authorized release.
