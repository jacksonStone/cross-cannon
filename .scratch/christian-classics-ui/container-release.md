# Hosted container Rust release

The default release path now builds on GitHub's Ubuntu x86-64 runner. Docker
Desktop on the Mac is optional; its pending privileged-networking setup prompt
was neither approved nor bypassed.

`scripts/deploy-rust-api.sh` publishes a small compiler-input source snapshot to
`ops/rust-api-ci-release`, waits for its commit-specific release, validates it,
and uploads the binary through existing EC2 SSH access. The alternate Git index
preserves the checkout/index and excludes unrelated unpublished local history.
No production SSH secret or private index is uploaded to GitHub.

The pinned Rust 1.99.1 Bookworm container runs data-independent API tests and
builds Linux x86-64. Its context excludes databases, text artifacts, Node modules,
and credentials. Production receives only the binary, systemd unit, build
metadata, and SHA256 checksums. It verifies hashes, archive contents, architecture
and dynamic linkage, then replaces the single managed instance under the shared
deployment lock. Health checks restore the previous release on failure. No
remote Cargo or additional full-library smoke process is used.

Validated on 2026-11-11:

- All 119 JavaScript unit tests passed, including release-boundary regressions.
- Hosted snapshot: `23453943665168c476abe55c7c6b97ea28072217`.
- GitHub Actions run: https://github.com/jacksonStone/cross-cannon/actions/runs/43100344225
  completed successfully, including the Linux container build and API tests.
- Its verified binary was activated as production Rust release
  `20261111T211317Z-eb6738c8`.
- `npm run verify-prod` passed after activation, including Scripture/Classics
  searches, immutable resources, compression, range audio and edge routing.

Local container builds remain available with `--build-local`; they require a
running local Docker engine and refuse remote Docker contexts. The default
hosted path was demonstrated while Docker Desktop setup was blocked on the Mac.
Runtime memory safeguards remain necessary independently of where builds run.
