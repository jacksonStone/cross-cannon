#!/usr/bin/env bash
# Publish only compiler inputs, without changing the checkout or its Git index.
set -euo pipefail
cd "$(dirname "$0")/.."
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
git add -- Cargo.toml Cargo.lock rust .github/workflows/rust-api-release.yml \
  scripts/build-rust-api-container.sh scripts/deploy-rust-api.sh \
  scripts/fetch-rust-api-release.py scripts/validate-rust-api-artifact.py \
  scripts/rust-api-release.test.mjs scripts/publish-rust-api-build.sh
tree="$(git write-tree)"
if [[ -n "$existing" && "$tree" == "$(git rev-parse "$existing^{tree}")" ]]; then
  printf '%s\n' "$existing"
  exit 0
fi
revision="$(printf '%s\n' 'Build the current Rust API source snapshot' | git commit-tree "$tree" -p "$parent")"
git push --progress origin "$revision:refs/heads/$build_branch" >&2
printf '%s\n' "$revision"
