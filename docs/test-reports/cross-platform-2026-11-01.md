# Cross Canon cross-platform audit — 1 November 2026

Core Bible and Fathers reading, semantic search, local native keyword search, and the tested audio flows work. The native apps are functional, but full web parity has not been reached. The largest confirmed problems are native corpus switching losing the previous reading place, a web offline verse jump ending in an application error, and a web saved-position regression.

[Open the screenshot comparison gallery](../screenshots/cross-platform-e2e/comparison.html). It includes matched Genesis 1 and Clement 1 views from production web, Rust desktop, mobile web, and iOS. [Desktop comparison board](../screenshots/cross-platform-e2e/desktop-comparison.png) · [Mobile comparison board](../screenshots/cross-platform-e2e/mobile-comparison.png).

## What was tested

The baseline was commit `54ee9899c0c73f8043b9a6230675b13f3b29a0d3` plus the current native search changes already present in the working tree. Critical source/build hashes are recorded in [baseline.json](cross-platform-2026-11-01/baseline.json). This audit did not change runtime source, regenerate text caches, embeddings, recordings, or timestamps, or deploy production changes. Existing unrelated edits were preserved.

The web tests used a production build on `127.0.0.1:13616`, connected to the Rust API on `127.0.0.1:13606`. Production reference captures returned HTTP 200 without page errors or horizontal overflow at 1003 × 886 and 390 × 844. Their stylesheet asset matched the local build, and the scripture cache version was `98c414bddc31ea96`. Most destructive/offline experiments ran against disposable local browser contexts and local servers, not production.

The native tests used the packaged macOS app and a freshly built, installed iPhone 16e Simulator app running iOS 26.3. Screenshots preserve actual app output: desktop uses a 2× bitmap and includes its title bar; iOS uses a 3× bitmap and includes safe areas. Node was **24.13.0**, not the newer version requested by the working tree's `.nvmrc`.

The iOS simulator build succeeded. Xcode initially stalled coordinating files in the Desktop project directory; copying the project wrapper to `/private/tmp` and retaining the original `SRCROOT` allowed the same sources to build. This was a build-environment workaround, not an app-code change. This audit does not certify signing, TestFlight, or a physical iPhone build.

## Automated results

| Check | Result | Evidence / qualification |
| --- | --- | --- |
| `npm run verify` | Pass | 97 web unit tests, typecheck, Rust API tests, release builds, homepage/search/resource smoke checks. [Log](cross-platform-2026-11-01/verify.log) |
| Rust workspace tests | Pass | 12 passed; live search test ignored by default, then run explicitly below. [Log](cross-platform-2026-11-01/rust-tests.log) |
| Live web/native search parity | Pass | All eight cases returned identical ranked passages and highlights. Includes Bible/Fathers, theme/similar search, both cross-corpus directions, canon, book, author, and match-count variations. [Log](cross-platform-2026-11-01/live-parity.log) |
| Reader kitchen sink | 11 / 12 pass | Original suite stopped at the saved-position failure. A continuation copy retained each assertion and recorded the remaining cases. [Results](cross-platform-2026-11-01/reader-results.json) |
| Expanded web feature matrix | 17 / 19 pass | Desktop/mobile × Bible/Fathers, settings, filters, validation, favorites, modernized text, search and dismissal. Both failures are Fathers Jump ignoring Escape. No page errors. [Results](cross-platform-2026-11-01/web-results.json) |
| Fathers selection restoration | Pass with hydration-aware harness | Initial test raced hydration. Waiting for network-idle before restoring state made the original selection assertions pass; selected 1–3 remained selected instead of reverting to 4–6. Movement was 43.3 px, within the existing 100 px tolerance. [Log](cross-platform-2026-11-01/fathers-hydrated.log) |
| Responsive reader fixture | Pass | Phone portrait, landscape safe areas, and orientation anchor. This is a fixture, not the full app. [Log](cross-platform-2026-11-01/responsive.log) |
| Audio start fixture | Pass | Loading/seek, pause/resume, retained recording element, and fractional timestamp cases, including iOS-style rounding. Deterministic media shim. [Log](cross-platform-2026-11-01/audio-start.log) |
| Real browser Bible audio | Pass | Continuous chapter transition after JS suspension, pause/resume, later-chapter seek, byte-range 206, and missing-combined-recording fallback. Desktop/mobile browser viewports. [Log](cross-platform-2026-11-01/audio-real.log) |
| Real browser Fathers audio | Pass | Clement recording loaded, advanced to 4.62 s, and paused successfully. [Results](cross-platform-2026-11-01/fathers-audio.json) |
| Full offline lifecycle suite | Fail / incomplete | Early service-worker activation and missing offline status blocked later assertions. Cancel/resume paths executed, but quota, repair, removal and all later recovery cases are not certified. [Original log](cross-platform-2026-11-01/offline.log), [continuation log](cross-platform-2026-11-01/offline-deep.log) |
| Independent real offline reading | Mixed | Downloaded Fathers cold reading and new-tab reading worked; Bible cold reading worked; offline status and Bible verse jump failed. [Results](cross-platform-2026-11-01/offline-basic-results.json) |
| iOS simulator build | Pass | Fresh build installed and manually exercised. [Log](cross-platform-2026-11-01/ios-rebuild.log) |

These checks overlap; adding them into a single pass percentage would overstate coverage. Search test elapsed time includes production rate-limit cooldown and is not a runtime benchmark.

## Functional comparison

“Contract” below means the shared request/result behavior was tested, rather than every combination being tapped manually on each device.

| Feature | Web | Rust desktop | iOS native |
| --- | --- | --- | --- |
| Bible / Fathers reader content | Pass | Pass | Pass |
| Text available without text API | Cached Bible / downloaded Fathers work | Entire bundled library; verified | Entire bundled library; verified |
| Jump to book/work and chapter | Pass | Pass | Pass |
| Jump to individual Bible verse | Pass online; fails offline | Missing | Missing |
| Continuous reader chapter boundaries | Pass, both corpora | Wheel down/up pass | Touch swipe unverified |
| Remember focus after restart | Web regression below | Shared persistence test passes | Clement focus and Dark/Compact settings survive relaunch |
| Remember each corpus's place | Pass in tested round trip | Fails | Fails |
| Theme / text settings | All 4 themes and presets pass | Paper/Dark and Compact/Default manually checked | Paper/Dark and Compact/Default manually checked |
| Semantic search, highlighted results | Pass | Pass UI + eight-case contract | Pass UI + shared contract |
| Search filters | Canon/books/authors/match count pass | UI + contract | Scope and author UI; remaining shared contract |
| Similar / cross-corpus search | Both directions pass | UI context action + contract | Shared contract; UI subset |
| Local keyword search without API | Offline suite incomplete | Pass, Fathers “Rome” | Pass, Fathers “Rome”; Clement author filter narrows to 1 result |
| Service-unreachable recovery | Offline status problem below | Clear error; switch to keywords works | Clear error; switch to keywords works |
| Original / modernized Fathers text | Pass | Pass, visible wording changes | Shared implementation; toggle not manually repeated |
| Favorites | Pass, persists | Missing | Missing |
| Browser Back / reader URLs | Pass | No equivalent | No equivalent |
| Audio | Bible continuous/fallback and Fathers pass | Decoder fixture passes; physical playback not certified here | Clement loading → playing → pause manually verified |
| Continuous audio chapter following / original fallback | Pass in browser tests | Not web-equivalent | Not web-equivalent |
| Outside-dismiss / keyboard Escape | Mostly pass; Fathers Jump Escape fails | Settings pass | Outside-dismiss pass; full hardware keyboard coverage incomplete |
| Clipboard result copy | Control present; contents not checked | Control present; contents not checked | Control present; contents not checked |
| Landscape | Responsive checks pass | Desktop resize covered by tests | App is portrait-only |

## Fathers are packaged by default

Both native apps already satisfy the requested packaging behavior. The full library contains **410 Fathers works**. The audit compared **13,684 existing Fathers JSON files**, totaling **131,700,278 bytes** of raw file content, against the desktop bundle, built iOS bundle, and actual installed simulator bundle. All three had **zero missing files and zero byte differences**. See [bundled-fathers.json](cross-platform-2026-11-01/bundled-fathers.json).

Both apps opened Fathers text and returned local Fathers keyword results while their API URL deliberately pointed at an unavailable loopback port. No text download was needed at runtime. Semantic search and streamed audio still use the network. Web work-download controls are a separate browser storage flow; they are not a requirement to read Fathers in the native apps.

After the offline experiments, the desktop app was relaunched with normal defaults and the simulator app was restored to `https://www.crosscanon.com/r/api`. Both returned to readable native screens.

## Confirmed problems and reproductions

### P1 — Native corpus switching discards the previous place

On desktop, jump to John 3; on iOS, jump to Genesis 3. Switch to Fathers, then back to Bible. Both apps open Genesis 1 rather than the previous Bible chapter. Switching to Fathers likewise opens the first work rather than restoring the previous Fathers location. `ReaderState` holds only one `location_passage_id`, and the corpus switch selects the first matching book. This conflicts with the web reader's tested corpus-position behavior.

### P1 — Web offline Bible verse jump ends in an application error

Warm both readers online, download Clement through the real UI, take the browser offline, and cold-open the Bible. Reading works. Open Jump, choose John, and select the first verse. The client requests `/reader/516492ab83debf6ec33e560e?_data=routes%2Freader.%24passageId`; the request fails offline and the reader becomes an application-error screen. This reproduced with both reader shells prewarmed, so it is not merely an uncached initial Bible page. [Before jump](../screenshots/cross-platform-e2e/web-bible-offline-before-jump.png) · [Failure](../screenshots/cross-platform-e2e/offline-failure-4.png).

### P2 — Web saved focus reloads Psalms 149 as Psalms 150

The existing kitchen-sink scenario focuses a passage within Psalms 149 and verifies saved state before reload. After reload the title becomes Psalms 150. Both the original run and the continuation run reproduced this. Other chapter boundary and corpus round-trip cases passed; this is specifically a focused-position restoration regression. [Failing assertion and continued cases](cross-platform-2026-11-01/reader-continue.log).

### P2 — Long desktop Fathers titles overlap reader tools

Open First Epistle of Clement and expand the top tools. The title is drawn behind the action controls. The closed-tools view also leaves very little room at this window width. iOS truncates the title instead; it avoids this overlap but loses useful work/chapter identity. [Actual desktop screenshot](../screenshots/cross-platform-e2e/desktop-fathers-header-overlap.png).

### P2 — Web service-worker update activates during the session

The offline suite stages a successful new shell generation and expects the current generation to remain active until the next session. The worker instead calls `skipWaiting()` during installation and advances the active-shell pointer on activation. The failed-staging case preserves the previous generation, but the successful-update deferral contract fails. This is an update-lifecycle failure; this audit did not establish text corruption.

### P2 — Web offline / unavailable-server status is unreliable

A downloaded Fathers work remains readable after an offline cold reload, but the expected offline indicator never appears. A separate managed-server test stops the origin while `navigator.onLine` remains true: the shell is controlled by the service worker but does not enter the expected offline fallback state. The provider relies on browser network events rather than origin reachability. [Readable Fathers with missing indicator](../screenshots/cross-platform-e2e/offline-failure-2.png).

### P3 — Web Fathers Jump ignores Escape

At desktop and mobile widths, open Fathers Jump, filter for Clement, then press Escape. The dialog remains open. This accounts for both failures in the expanded 19-case matrix. Outside dismissal works in the independent mobile dismissal case.

## Visual assessment and remaining limits

The native apps preserve the warm Paper background, Source Serif reading face, bold reading text, subtle dividers, accent color, and generally similar text width and rhythm. They are recognizable counterparts to the web reader. They are not pixel-identical: title size/wrapping, top metadata, safe-area spacing, dialog structure, and tool placement differ. The native default Fathers work is Hermas while web starts at Clement; the comparison boards deliberately navigate both to Clement.

The mobile work picker also showed a clipped long row, and the native iPhone header truncates work identity aggressively. An iOS Simulator Safari reference showed missing toolbar glyphs; Chromium references did not. The Safari observation needs a real-device reproduction before treating it as a general iPhone defect.

The automation drag failed to scroll both the native iPhone reader and Safari's web reader. Therefore native touch scrolling is **unverified**, not a confirmed app defect. A physical-device pass should check scrolling across chapters, long search results, keyboard selection, VoiceOver, background/lock-screen audio, sound quality, interruptions, and orientation expectations. The native accessibility snapshot exposed the window rather than individual egui controls, but no screen-reader certification was attempted.

The whole artifact set was verified, but every one of the 491 books / 150,073 passages was not manually read. No assertion is made that all later offline quota/repair cases passed. No statistical native-versus-web performance benchmark was run.

## Reproduction commands and evidence

Run from the repository root, with a production web build using the local Rust API. Audit scripts default to the isolated web port `13616`; override `E2E_BASE_URL` when needed. The preserved script copies write screenshots/results to the original audit locations and assume dependencies are installed.

```sh
VERIFY_PORT=13605 VERIFY_RUST_PORT=13606 npm run verify
scripts/rust.sh test --locked --workspace
scripts/rust.sh test --locked -p cross-canon-desktop live_web_search_parity -- --ignored --nocapture
E2E_BASE_URL=http://127.0.0.1:13616 npm run e2e:reader
E2E_BASE_URL=http://127.0.0.1:13616 node --import tsx docs/test-reports/cross-platform-2026-11-01/reader-continue.ts
E2E_BASE_URL=http://127.0.0.1:13616 node --import tsx docs/test-reports/cross-platform-2026-11-01/fathers-hydrated.ts
E2E_BASE_URL=http://127.0.0.1:13616 node docs/test-reports/cross-platform-2026-11-01/web-audit.mjs
E2E_BASE_URL=http://127.0.0.1:13616 PREWARM_BIBLE=1 node docs/test-reports/cross-platform-2026-11-01/offline-basic.mjs
npm run e2e:reader-responsive
npm run e2e:audio-start
AUDIO_TEST_ORIGIN=http://127.0.0.1:13616 npm run e2e:continuous-audio
E2E_MANAGE_SERVER=1 E2E_PORT=13625 R_CROSS_CANNON_ORIGIN=http://127.0.0.1:13606 npm run e2e:offline
```

Raw results, continuation harnesses, and selected logs are preserved in [the evidence directory](cross-platform-2026-11-01/). Screenshots live under `docs/screenshots/cross-platform-e2e/`, which follows this repository's ignored-preview convention; the Markdown report and structured test evidence can be committed separately.
