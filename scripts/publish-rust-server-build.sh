#!/usr/bin/env bash
# Publish Rust compiler/release inputs without changing the checkout or its Git index.
set -euo pipefail
cd "$(dirname "$0")/.."
# Keep the hosted branch/tag protocol stable so existing revision artifacts remain usable.
build_branch=ops/rust-api-ci-release
mkdir -p .tmp
git fetch --quiet origin main
parent="$(git rev-parse origin/main)"
existing="$(git ls-remote origin "refs/heads/$build_branch" | awk '{print $1}')"
if [[ -n "$existing" ]]; then
  git fetch --quiet origin "$build_branch"
  parent="$existing"
fi
index_path="$(mktemp "$PWD/.tmp/rust-build-index.XXXXXX")"
rm "$index_path"
trap 'rm -f "$index_path" "$index_path.lock"' EXIT
export GIT_INDEX_FILE="$index_path"
git read-tree origin/main
git add -- Cargo.toml Cargo.lock rust .github/workflows/rust-server-release.yml \
  deploy.sh scripts/release-server.py scripts/activate-server.py scripts/test-server-release.py \
  scripts/build-rust-server-container.sh scripts/fetch-rust-server-release.py \
  scripts/validate-rust-server-artifact.py scripts/rust-server-build.test.mjs \
  scripts/publish-rust-server-build.sh
# The base branch may predate the unified server cleanup. Remove retired release
# paths from this temporary snapshot as well; the real checkout/index is untouched.
git update-index --force-remove -- .github/workflows/rust-api-release.yml \
  scripts/ship-web-container.py scripts/activate-web-container.py \
  scripts/test-web-container-release.py scripts/build-rust-api-container.sh \
  scripts/fetch-rust-api-release.py scripts/validate-rust-api-artifact.py \
  scripts/rust-api-release.test.mjs scripts/publish-rust-api-build.sh \
  scripts/deploy-rust-api.sh scripts/deploy-rust-api-bridge.sh
tree="$(git write-tree)"
if [[ -n "$existing" && "$tree" == "$(git rev-parse "$existing^{tree}")" ]]; then
  printf '%s\n' "$existing"
  exit 0
fi
revision="$(printf '%s\n' 'Build the current Rust server source snapshot' | git commit-tree "$tree" -p "$parent")"
git push --progress origin "$revision:refs/heads/$build_branch" >&2
printf '%s\n' "$revision"
