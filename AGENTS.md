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

`npm run verify` typechecks, builds the scripture cache and Remix app, starts
the production server locally, checks the homepage, and runs a search POST
smoke test.

`npm run verify-prod` checks the remote service over SSH, checks the production
homepage, and runs a production search POST smoke test. It expects
`EC2_PEM_PATH` and `EC2_PUBLIC_IP`, unless `VERIFY_PROD_SKIP_REMOTE=1` is set.

`./deploy.sh` builds, packages, copies, installs production dependencies, and
restarts the remote service. It preserves the remote `storage` directory.

## Before Deploying UI Changes

- Run `npm run verify`.
- Capture relevant desktop and mobile screenshots.
- Put preview artifacts under `docs/screenshots/`; screenshots are ignored by
  git.
- Share the screenshot links before deploying when the user asked to preview UI.

## Key Files

- `app/features/passage-reader/PassageReader.tsx`: reader UI, reader controls,
  focus passage behavior, chapter boundary behavior.
- `app/features/search/SearchForm.tsx`: search controls and similar-passage
  input behavior.
- `app/features/search/SearchResults.tsx`: result cards and actions.
- `app/lib/search.server.ts`: search execution and ranking.
- `app/lib/scripture-cache.server.ts`: scripture cache loading.
- `app/styles.css`: global and feature styling.
- `README.md`: operational notes, indexing, verification, deployment.
- `docs/architecture.md`: runtime and build/deploy architecture.

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
