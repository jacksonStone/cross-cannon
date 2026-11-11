#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
output="${1:-$PWD/.tmp/rust-api-linux}"
command -v docker >/dev/null || { echo 'Install Docker to build the Linux Rust release.' >&2; exit 1; }

# A remote Docker context could put compilation back on the production host.
case "${DOCKER_HOST:-unix://local}" in
  unix://*) ;;
  *) echo 'Rust releases require a local Docker engine; remote DOCKER_HOST is refused.' >&2; exit 1 ;;
esac
context="$(docker context show)"
endpoint="$(docker context inspect "$context" --format '{{.Endpoints.docker.Host}}')"
case "$endpoint" in
  unix://*) ;;
  *) echo 'Rust releases require a local Docker context.' >&2; exit 1 ;;
esac
docker --context "$context" info >/dev/null
mkdir -p "$output"
docker --context "$context" buildx build --builder "$context" \
  --platform linux/amd64 --file rust/deploy/api.Dockerfile \
  --build-arg "SOURCE_REVISION=${RUST_RELEASE_REVISION:-working-tree}" \
  --target artifact --output "type=local,dest=$output" .

# Catch an accidental macOS/ARM artifact before packaging or contacting the host.
python3 scripts/validate-rust-api-artifact.py "$output"
