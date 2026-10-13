# Capacitor Mobile App Plan

Status: Proposed; not scheduled\
Recorded: 2026-08-01\
Scope: iOS and Android applications built with Capacitor while preserving the
existing Remix website and production service.

## Objective

Ship Cross Canon as a useful, store-ready mobile application without moving the
SQLite, vector search, rate limiting, or OpenAI integration onto the device.
The mobile application should retain the existing reading experience, work as a
reader without a network connection, and use the production service for search.

## Recommendation

Keep the current Remix application as the website and server, and add a separate
bundled mobile SPA:

```text
Web browser ----> existing Remix SSR application
                              |
Capacitor app --> bundled reader UI --> versioned HTTPS API
                     |                    `- search / SQLite / OpenAI
                     `- native offline storage
```

Do not release an application that uses Capacitor's `server.url` to load
`https://www.crosscanon.com`. It is useful for a short compatibility spike, but
Capacitor documents it as a live-reload feature that is not intended for
production. A remote-site wrapper also carries additional App Store review risk
because Apple expects an app to provide utility beyond a repackaged website.

The production application should contain a local `index.html`, JavaScript,
CSS, fonts, and core Scripture data. Only search and optional content downloads
should require the server.

## Why The Existing Build Cannot Be Copied Directly

The current `npm run build` produces Remix client and server bundles, but not a
standalone `build/client/index.html`. The route modules also depend on server
loaders and actions:

- `app/routes/_index.tsx` loads books, authors, and Scripture cache metadata and
  handles Search Requests.
- `app/routes/reader.$passageId.tsx` resolves Scripture cache information on the
  server.
- `app/routes/church-fathers.tsx` uses a server loader/action for initial state
  and searching.
- Search runs against the production SQLite/libSQL index and may call OpenAI.
- Early Christian offline storage currently relies on a service worker, Cache
  Storage, and browser-relative asset URLs.

Capacitor expects its configured `webDir` to contain final static web assets and
an `index.html`. The mobile build therefore needs client-side route adapters and
an HTTP API for server-only behavior.

## Proposed Repository Shape

Add a standalone package rather than introducing Capacitor dependencies into
the production server package:

```text
mobile/
  package.json
  package-lock.json
  capacitor.config.ts
  vite.config.ts
  src/
    main.tsx
    routes/
    platform/
  ios/
  android/

app/
  features/                 shared reader and search UI/domain logic
  routes/api.v1.*           mobile-facing resource routes
```

The mobile package should build to `mobile/dist/`, and
`capacitor.config.ts` should set `webDir: "dist"`.

Keeping the package separate protects the current deployment path. Production
is pinned to Node 20.15.0 in `deploy.sh`, while Capacitor 8 development requires
Node 22 or newer. The mobile directory is also excluded naturally from the
explicit set of files packaged by `deploy.sh`.

## Delivery Phases

### Phase 0: Compatibility Spike

Create a disposable Capacitor shell that temporarily loads the local Remix dev
server or production site with `server.url`. Do not commit a production remote
URL configuration.

Test on at least one physical iPhone and one physical Android device:

- Long reader scrolling and chapter-window expansion.
- Focused-passage restoration.
- Search form keyboard behavior and modal dismissal.
- Audio playback and behavior when the app backgrounds.
- Safe areas, status bar, text sizing, rotation, and dark/light reader themes.
- iOS swipe navigation and Android hardware back.
- External links and reader URLs.

Exit criteria:

- No fundamental WKWebView or Android WebView incompatibility is found.
- Any required UI changes are recorded before the production mobile build is
  started.
- The remote `server.url` is removed or restricted to an ignored development
  configuration.

### Phase 1: Bundled Mobile Shell

Create the standalone `mobile/` Vite/React application and initialize
Capacitor for iOS and Android. A Remix SPA build is also viable, but it must use
mobile-only route modules because Remix SPA mode rejects server `loader` and
`action` exports.

The mobile bundle should initially render the Scripture reader using a bundled
Scripture cache. Configure SPA routing so all application paths resolve through
the local `index.html`.

Add development commands similar to:

```text
npm --prefix mobile run dev
npm --prefix mobile run build
npm --prefix mobile run cap:sync
npm --prefix mobile run cap:ios
npm --prefix mobile run cap:android
```

Exit criteria:

- The application cold-starts without a network connection.
- Scripture reading, jumping, themes, and reader-position restoration work from
  bundled assets.
- `npx cap sync` copies only built mobile assets into both native projects.
- The existing web build and `npm run verify` remain unchanged.

### Phase 2: Extract Shared UI Seams

Retain the feature code under `app/features`, but remove direct Remix coupling
from components that the mobile application needs to reuse.

Introduce small interfaces for:

- Search submission and submission state.
- Reader navigation, push, replace, and back behavior.
- Asset URL resolution.
- Reader settings, filters, favorites, and position persistence.
- Connectivity state.
- Downloaded-work storage.

The website supplies Remix/browser implementations. The mobile application
supplies client-router/Capacitor implementations. Pure domain utilities and UI
should remain shared.

Pay particular attention to components that currently render Remix `<Form>`
elements or consume `useNavigation`, `useLoaderData`, or `useActionData`.
Convert these to receive data and callbacks from route-level adapters.

Exit criteria:

- The website and mobile shell render the same core reader and search UI.
- Shared feature modules do not import server-only modules.
- Existing unit tests pass, with new contract tests for the platform adapters.

### Phase 3: Versioned Mobile API

Add explicit Remix resource routes rather than posting to `/?index` from the
mobile application.

Proposed endpoints:

```text
GET  /api/v1/bootstrap
POST /api/v1/search
GET  /api/v1/health       optional
```

`GET /api/v1/bootstrap` should return:

- Indexed Scripture books.
- Early Christian author options.
- Current Scripture and Early Christian content versions.
- The public origin or asset base URL.
- A minimum-supported mobile API/client version if version gating becomes
  necessary.

`POST /api/v1/search` should:

- Accept a documented JSON Search Request.
- Return the existing Scripture and Early Christian result contracts.
- Reuse `handleSearchRequest` and the current ranking/search modules.
- Apply the same validation and rate limiting as the web routes.
- Return structured error codes for offline, validation, rate-limit, and server
  failures.

Factor shared route logic so the existing web actions and mobile API cannot
drift. Keep OpenAI credentials and database access entirely server-side.

Use absolute HTTPS URLs in the client. Evaluate Capacitor's native HTTP support
for the API and large asset downloads so the implementation does not depend on
WebView CORS behavior. If ordinary browser `fetch` is retained, add a narrow
origin policy for the Capacitor origins and test it on both platforms.

Exit criteria:

- Both reader corpora can submit theme and similar-passage searches.
- Results retain the current ordering, match metadata, filters, and focused
  passage behavior.
- Rate-limit responses preserve retry timing.
- An incompatible mobile client receives a clear upgrade response rather than
  silently failing.

### Phase 4: Native Offline Storage

Do not rely on the current service worker or browser Cache Storage inside the
native application. Skip service-worker registration when running natively and
provide storage adapters:

- Capacitor Preferences for reader position, settings, filters, favorites, and
  a lightweight download registry.
- Capacitor Filesystem for downloaded Early Christian chapter JSON and any
  future downloaded audio.
- Capacitor Network for connectivity state and change events.

Initial content strategy:

- Bundle the Scripture cache, currently about 11 MB uncompressed and about 2 MB
  gzip-compressed.
- Bundle the Early Christian manifest and book index, currently about 3.1 MB.
- Bundle one small starter work if useful for the first-launch experience.
- Keep the remaining Early Christian chapter set, currently about 143 MB,
  downloadable by complete work.
- Bundle the Inter and Source Serif font files so reading does not depend on
  Google Fonts.
- Keep semantic search online-only for the first release.

Create an asset resolver that can return, in priority order:

1. A downloaded native file.
2. A bundled mobile asset.
3. A production HTTPS asset when online.

Preserve the current atomic work-download guarantees: progress, cancellation,
resume, validation, promotion only after completeness, repair of missing
chapters, and removal.

Exit criteria:

- The app launches and reads Scripture in airplane mode.
- Downloaded Early Christian works remain readable across restarts and app
  upgrades.
- Interrupted downloads do not replace a previously complete generation.
- Removing a work reclaims its native files and updates the registry.
- Search is clearly unavailable offline without disrupting reading.

### Phase 5: Native Application Behavior

Add the platform behavior expected of a mobile application:

- Universal Links on iOS and App Links on Android for existing
  `crosscanon.com/reader/...` and `crosscanon.com/church-fathers?...` links.
- Capacitor App lifecycle handling for launch URLs, background/resume, process
  restoration, and Android back.
- Native share sheets for Scripture and Early Christian passages.
- External-site links opened in the system browser.
- Splash screen, application icons, status/system bars, and safe-area styling.
- Accessible native labels and reasonable dynamic text behavior.
- A useful offline/download management surface.

Audio should stream in the first release unless offline audio is explicitly
added to scope. If background audio is expected, treat it as a distinct feature
requiring native capability configuration and dedicated lifecycle testing.

Exit criteria:

- Deep links open the correct corpus, chapter, and focused passage from a
  terminated state.
- Android back closes open UI, traverses reader navigation, and exits only at
  the root.
- Sharing uses the native share sheet.
- The app provides clear lasting utility beyond the website wrapper, especially
  through bundled/offline reading and native downloads.

### Phase 6: Verification And Release

Add a mobile verification path without changing `npm run ship`, which must
continue to deploy only the website/server.

Suggested commands:

```text
npm --prefix mobile test
npm --prefix mobile run typecheck
npm --prefix mobile run build
npm --prefix mobile run verify
npm --prefix mobile run cap:sync
```

Automated coverage should include:

- Platform-adapter contract tests.
- Reader navigation and focused-passage persistence.
- Search request/response serialization.
- Asset resolution among bundled, downloaded, and remote sources.
- Atomic download, cancellation, resume, repair, and removal.
- A browser-level journey against the built mobile SPA.

Device verification should include:

- Cold start online and offline.
- Airplane-mode transition while reading and searching.
- Backgrounding, process termination, and restoration.
- Interrupted and low-storage downloads.
- Keyboard, modals, safe areas, rotation, and text scaling.
- Long Scripture and Early Christian scrolling.
- Audio interruption and resume.
- Deep links from Messages, Safari/Chrome, and a terminated state.
- Android hardware back.
- At least one older supported device and current OS devices.

Release work includes:

- App IDs, signing, certificates, and provisioning.
- Privacy policy and support URL.
- iOS privacy manifest entries required by the selected plugins.
- Store icons, screenshots, descriptions, age/content ratings, and review
  notes.
- TestFlight and Google Play internal testing before public submission.
- Documented mobile release/versioning procedure separate from `npm run ship`.

## Suggested First Release Scope

The smallest sensible store release contains:

- Complete offline Scripture reading.
- Online Scripture and Early Christian search.
- Persistent reader settings and focused-passage restoration.
- Deep links.
- Native sharing.
- Native connectivity state and polished back/safe-area behavior.
- Early Christian work downloads if schedule permits; otherwise ship at least a
  useful bundled sample and schedule downloads immediately afterward.

Defer unless explicitly prioritized:

- Fully offline semantic or vector search.
- Background/offline audio downloads.
- Push notifications.
- Accounts or cross-device synchronization.
- In-app purchases.
- Replacing the existing website deployment architecture.

## Rough Effort

For one engineer familiar with the codebase, expect roughly three to five
engineering weeks after native build tools and store accounts are available:

| Work | Estimate |
| --- | ---: |
| Compatibility spike | 1-2 days |
| Mobile shell and shared UI seams | 4-7 days |
| API and search integration | 3-5 days |
| Native offline storage and downloads | 4-7 days |
| Native polish, device QA, and store preparation | 4-7 days |

These are planning ranges, not commitments. Offline download migration and
device-specific reader behavior are the largest uncertainty.

## Risks And Mitigations

### Web and mobile UI drift

Mitigation: share feature/domain modules and keep thin Remix and Capacitor route
adapters rather than copying route components.

### Service-worker assumptions in native WebViews

Mitigation: disable the service worker natively and use explicit Preferences,
Filesystem, and Network adapters.

### App Store minimum-functionality rejection

Mitigation: ship bundled offline Scripture, durable downloads, deep links,
native sharing, and polished platform behavior. Treat store acceptance as a
release gate, not as guaranteed by the use of Capacitor alone.

### API/client version drift

Mitigation: use `/api/v1`, additive response changes, contract tests, and an
explicit minimum-supported-client response from bootstrap.

### Mobile package affects server deployment

Mitigation: keep its package and lockfile under `mobile/`; do not change the
explicit web deployment package list or add mobile build steps to `npm run
ship`.

### Large content and download storage

Mitigation: bundle only core text, download Early Christian content by work,
validate free-space and write failures, and make removal/recovery visible.

## Prerequisites At Time Of Recording

Local state observed on 2026-08-01:

- Node.js 24.13.0 and npm 11.6.2 are installed.
- Xcode Command Line Tools are selected, but the full Xcode application is not
  installed/configured for `xcodebuild`.
- Android Studio was not found under `/Applications`.
- Java 17 is installed.

Before execution, install the then-supported Xcode and Android Studio versions,
confirm physical-device access, and confirm Apple Developer and Google Play
Console accounts. Re-check Capacitor's current support policy instead of
assuming the versions recorded here remain current.

## Decisions To Revisit Before Starting

1. Confirm Capacitor major version and its Node/Xcode/Android requirements.
2. Choose plain Vite/React Router or Remix SPA mode for `mobile/`; prefer the
   option that creates the thinnest route adapters.
3. Confirm application ID and public store name.
4. Decide whether Early Christian downloads are required in version 1.0.
5. Decide whether audio may stop on background or needs native background-audio
   support.
6. Define the supported iOS and Android OS floor.
7. Confirm whether mobile API traffic needs additional abuse controls beyond
   the existing per-IP rate limit.

## Primary References

- [Installing Capacitor](https://capacitorjs.com/docs/getting-started)
- [Capacitor configuration](https://capacitorjs.com/docs/config)
- [Capacitor development workflow](https://capacitorjs.com/docs/basics/workflow)
- [Capacitor environment setup](https://capacitorjs.com/docs/getting-started/environment-setup)
- [Capacitor HTTP](https://capacitorjs.com/docs/apis/http)
- [Capacitor App lifecycle and links](https://capacitorjs.com/docs/apis/app)
- [Capacitor Network](https://capacitorjs.com/docs/apis/network)
- [Capacitor Preferences](https://capacitorjs.com/docs/apis/preferences)
- [Remix SPA mode](https://v2.remix.run/docs/guides/spa-mode/)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
