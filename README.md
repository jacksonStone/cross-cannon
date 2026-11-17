# Cross Cannon

Cross Cannon reads Scripture, Early Christian Works and Christian Classics in
the browser, on iPhone and on macOS. All three run the same Rust reader. One
Rust/Axum process serves the website, accounts, synchronization, search and
text/audio resources at [crosscanon.com](https://www.crosscanon.com).

Reading, passage-based resume, keyword search, notes and highlights work offline.
Theme and similar-passage searches return original source passages; they do not
generate answers or commentary. Search indexes stay read-only. Only a new theme
query requests an embedding.

## Run locally

Use the Node version in `.nvmrc` for build tools, Python 3, and the Rust
compiler. Browser builds also require the `wasm32-unknown-unknown` target and
`wasm-bindgen-cli 0.2.130`. `scripts/rust.sh` uses the isolated toolchain under
`.tmp/` when available, otherwise the installed Cargo toolchain.

```bash
npm ci
npm run dev
# http://127.0.0.1:3005
```

The app expects existing immutable text assets and read-only search databases
under `storage/`. Obtain those artifacts separately; ordinary builds never
regenerate text caches, index content or initialize account databases. Google
login is optional. `OPENAI_API_KEY` enables new theme queries; similar-passage
search reuses existing vectors.

```bash
npm run build           # browser artifacts and release server
npm start               # run the release server
npm run verify          # unit/type/Rust checks and production-shape HTTP/browser tests
npm run verify:offline  # complete responsive/offline reader journey
```

Use `VERIFY_PORT` for an alternate local verification port. For an already
running server, use `BROWSER_TEST_URL=http://127.0.0.1:3005 npm run verify:browser`.
Screenshots go under ignored `docs/screenshots/`.

## Find the code

| Area | Source |
| --- | --- |
| Library identity, immutable texts and keyword search | `rust/core/` |
| Shared reading, navigation, dialogs, study and reconciliation | `rust/desktop/src/` |
| Text snapshot and typed reader commands | `rust/desktop/src/text_surface.rs`, `text_surface/` |
| Platform tasks, HTTP, media, downloads and credentials | `rust/desktop/src/platform/` |
| HTML text/accessibility, browser media and offline staging | `web/` |
| HTTP server, static resources and search | `rust/api/src/` |
| Google login, native consent and account storage | `rust/api/src/accounts/` |
| Explicit content imports, indexing and exports | `scripts/` |

Keep reading behavior in shared Rust and platform effects in adapters. Persist
Reader Locations by Passage identity, not scroll offsets. See
[architecture](docs/architecture.md), [domain language](CONTEXT.md) and
[reader navigation decisions](docs/adr/0001-reader-navigation-restores-reader-location.md).

## Native apps

```bash
scripts/rust.sh run --locked -p cross-canon-desktop
scripts/package-desktop.sh   # signed local macOS app and ZIP under dist/
scripts/run-ios.sh           # build/install/launch an iPhone simulator
```

Native packages bundle the complete text library; recordings are optional
separate downloads. See [native builds and device checks](docs/native-apps.md).

## Release

```bash
npm run ship                 # verify, build off-server, deploy, verify production
npm run ship:docker          # use a local Docker Linux builder
npm run verify-prod          # check the existing production release
```

Releases contain a Rust executable and static resources. Production installs
no compiler, Node or npm. The `cross-cannon` service shares one Library between
ports 3005 and 3006 for the existing Go reverse proxy. Do not start a second
Library process on the 2-GB host.

Deployment preserves live storage, validates artifacts and rolls back failed
activation. Database changes require an explicit database-named command and are
separate from shipping. Capture desktop/mobile previews before releasing UI
changes. See [deployment and recovery](docs/deployment.md) and the
[verified runtime release](docs/test-reports/node-free-runtime-2026-11-16.md).

## Working guides

- [Google login and account setup](docs/google-login.md)
- [Notes, highlights and synchronization](docs/personal-study.md)
- [Search API](docs/api.md)
- [Content, indexing, audio and Kindle exports](docs/content-maintenance.md)
- [Text and edition research](docs/research/)
- [Agent workflow](AGENTS.md)
