# Deployment and recovery

Production runs one `cross-cannon` Rust service behind the existing Go reverse
proxy. Primary port 3005 and compatibility port 3006 share one router, account
store, search budget and loaded Library. The former separate `r-cross-cannon`
service is inactive. No edge patch or Node process is needed.

## Release commands

Run from the repository root:

```bash
npm run ship
npm run ship:docker
npm run verify-prod
```

`ship` verifies locally, obtains the Linux binary through hosted CI, packages
matching browser assets, activates, then verifies production. `ship:docker`
uses a local Docker Linux x86-64 builder instead. For packaging without
contacting production:

```bash
./deploy.sh --build-only
./deploy.sh --build-local --build-only
```

The workstation needs `EC2_PEM_PATH` and `EC2_PUBLIC_IP`. Hosted builds also need
a usable Git SSH identity. The compiler snapshot includes current uncommitted
Rust/Cargo inputs without changing the checkout/index or publishing unrelated
history. The repository and historical `ops/rust-api-ci-release` build branch
are public. `--revision <full SHA>` reuses a hosted binary only when its compiler
inputs match the current checkout. Docker contexts must be local.

Browser WASM builds require the explicit toolchain described in
[README](../README.md). Both binary and browser artifacts build off-server.
Compiler-input fingerprints, the browser receipt, ELF architecture and file
checksums are validated before upload. Archives reject databases, live storage,
secrets, symlinks and Node runtime files. Production runs no build or dependency
installation.

For UI changes, run verification, capture relevant desktop/mobile screenshots
under `docs/screenshots/`, and share previews when requested before activation.
Retain old published icon/manifest URLs for installed readers. Indexing, content
imports, cache refreshes and account schema changes are separate explicit tasks;
none runs during verification, startup or deployment.

## Storage and activation

Activation uses the shared deployment lock, an atomic application link, managed
service health checks and a previous-release receipt. A failed health check
restores the prior app/unit and account files before restarting prior services.
New account writes made during a failed activation are retained during recovery.

Accounts need a writable parent for SQLite journals. They live under:

```text
/home/ubuntu/.workspace-deploy/shared/cross-cannon/accounts/accounts.db
```

The service can write only that accounts directory. Search indexes and remaining
storage stay read-only. The transition moved closed legacy account main/WAL/SHM/
journal files together and left old-path links. Custom account paths are resolved
to their canonical file so sidecars use the writable directory. This relocation
performs no SQL migration. See [account setup and backups](google-login.md).

Release code must stop all prior account writers before relocating files and
must never copy only a live SQLite main file. Keep consistent backups off-server.
Use SQLite's online backup API or stop writers before copying main and sidecars.
Retain active and rollback releases when reclaiming disk space.

The production host has 2 GB RAM, a 1,200-MiB service cap and a 1-GiB swap buffer.
Do not start a second full-Library smoke process during deployment. Swap absorbs
temporary spikes; it does not replace checking memory headroom.

## Verification

`npm run verify-prod` checks the managed Rust executable over SSH, confirms the
old API service is inactive, verifies both listeners and exercises public
reading, worker, search, resource and account contracts. It expects the SSH
variables above. `PROD_URL`, `VERIFY_PROD_SERVICE` and
`VERIFY_PROD_SKIP_REMOTE=1` support another host/unit or HTTP-only checks.

Browser journeys use temporary accounts/storage. Live Google project settings
and physical-device app links still need real sign-in/consent checks; automated
provider fixtures cannot prove those external configurations. See
[Google login](google-login.md), [native checks](native-apps.md) and the
[production release record](test-reports/node-free-runtime-2026-11-16.md).
