# Cross Cannon Agent Context

Use this file first when working in this repo. It exists to avoid rediscovering
the same project shape, deploy path, and reader-state decisions across sessions.

## Project Basics

- Repo: `/Users/jacksonstone/Desktop/ubuntu_box_software/cross-cannon`
- This directory is its own git repository. Do not report root workspace dirty
  state as Cross Cannon dirty state.
- Local app: `http://127.0.0.1:3005`
- Production app: `https://www.crosscanon.com`
- Production service: `cross-cannon`
- Default systemd port: `3005`

## Standard Commands

Run commands from the Cross Cannon repo root.

```bash
npm run verify
./deploy.sh
npm run verify-prod
```

Use the single-command release path when asked to verify, deploy, and check
production:

```bash
npm run ship
```

`npm run build` builds the shared Rust browser artifacts and the Rust server.
`npm run verify` runs Rust and off-server tooling/protocol tests, starts one Rust
server locally, and checks reading startup, form searches, resources and accounts.
Node is only an off-server tool for content maintenance and browser tests;
production never runs Node, npm, or a compiler.

`./deploy.sh` obtains a tested Linux x86-64 Rust binary from hosted CI and packages
it with the matching browser/static artifacts. `npm run ship:docker` builds that
binary in local Docker instead. Both reuse the shared deploy lock, storage
preservation, atomic activation and rollback. They reject storage/database data,
secrets and Node runtime files. `scripts/release-server.py` is the shared release
entry point; the API is never released independently.

`npm run ship` checks the active release and local runtime inputs first. If the
Rust/compiler recipe, served assets and service unit are unchanged, it runs
tooling tests/typechecking and production verification without a Linux build,
archive, upload or restart. Changed runtime inputs run full `npm run verify`;
hosted CI starts first so its build overlaps local verification. Existing Linux
artifacts are reused only with matching compiler/build-recipe inputs and valid
checksums/architecture. `./deploy.sh --plan` is a read-only production comparison;
`--force` disables the unchanged-runtime shortcut. `npm run verify` always runs
the complete suite.

The one `cross-cannon` service listens on 3005 and compatibility port 3006 using
one shared Library. Deployment stops/disables the old `r-cross-cannon` service.
Never start a second full-library smoke instance on the 2 GB production host.
Accounts have a dedicated writable directory; other runtime data stays read-only.
During initial transition, closed existing account DB/WAL/journal files move
intact under the deployment lock, with old-path links and rollback preservation.
This is a file relocation, not an implicit schema/database update.

`npm run verify-prod` proves the running executable is Rust and the old API
service is inactive, then checks public reading, searches, resources and accounts.
It expects `EC2_PEM_PATH` and `EC2_PUBLIC_IP`, unless
`VERIFY_PROD_SKIP_REMOTE=1` is set.

Do not refresh scripture cache artifacts or perform database-update work as part
of `npm run ship`, `npm run verify`, or `./deploy.sh`. Use an explicit
database-named command, such as `npm run update-db:scripture-cache`, when the
user asks to update DB-backed artifacts. Production runtime database maintenance
is disabled unless `CROSS_CANNON_UPDATE_DB=1` is set for an explicit DB update
task.

## Before Deploying UI Changes

- Run `npm run verify`.
- Capture relevant desktop and mobile screenshots.
- Put preview artifacts under `docs/screenshots/`; screenshots are ignored by
  git.
- Share the screenshot links before deploying when the user asked to preview UI.

## Key Files

- `rust/desktop/src/text_surface.rs`: shared reading snapshot and event reducer.
- `rust/desktop/src/reader.rs`: passage identity, navigation, and chapter windows.
- `rust/desktop/src/dialogs.rs`: shared library, jump, and search widgets.
- `rust/desktop/src/study.rs`: shared notes, highlights, and reconciliation.
- `rust/desktop/src/platform/`: native/browser effect adapters.
- `web/platform.js` and `web/reader.css`: browser text/accessibility surface.
- `web/service-worker.js`: complete-reader offline staging and updates.
- `rust/api/src/accounts/`: Google login, native consent and account/study APIs.
- `rust/api/src/compat.rs`: compatibility form POSTs and commentary endpoint.
- `scripts/lib/`: shared content-maintenance, audio, and export helpers.
- `scripts/build-browser.py`: off-server Rust browser artifact build.
- `README.md` and `docs/architecture.md`: runtime/build/deploy notes.

## Reader State Decisions

- Persist and restore the user's focused passage, not a raw scroll offset.
- Do not use scroll position as the source of truth for chapter identity.
- Verse/passage numbers should stay hidden in the main reading flow unless
  selected or specifically needed by the current interaction.
- Chapter boundaries should feel subtle and should not introduce visible scroll
  jumps.
- Reader controls such as `Aa`, search/jump, and similar-passage affordances
  should close when tapping outside their modal/popover.

## Avoid Known Token Burn

- Prefer `npm run verify` over separate typecheck/build/start/curl loops.
- Prefer `npm run ship` over manual verify/deploy/prod-verify sequences.
- Prefer `npm run verify-prod` over ad hoc SSH, journalctl, and curl checks
  after deploys.
- Read this file, `README.md`, and `docs/architecture.md` before broad repo
  exploration.

## Agent skills

### Issue tracker

Issues and PRDs are tracked as local markdown under `.scratch/<feature-slug>/`;
external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the default local status strings: `needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, and `wontfix`. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: root `CONTEXT.md` plus `docs/adr/`, created lazily when
domain terms or decisions are resolved. See `docs/agents/domain.md`.
