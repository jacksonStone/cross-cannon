#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f package.json || ! -f remix.config.js || ! -d app ]]; then
  echo "Run this from the cross-cannon project root." >&2
  exit 1
fi

verify_port="${VERIFY_PORT:-3005}"
verify_host="${VERIFY_HOST:-127.0.0.1}"
base_url="http://${verify_host}:${verify_port}"
server_log=".tmp/verify-server.log"
server_pid=""
rust_pid=""
rust_port="${VERIFY_RUST_PORT:-13006}"
export R_CROSS_CANNON_ORIGIN="http://127.0.0.1:${rust_port}"

cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" >/dev/null 2>&1; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$rust_pid" ]]; then
    kill "$rust_pid" >/dev/null 2>&1 || true
    wait "$rust_pid" >/dev/null 2>&1 || true
  fi
}

run_step() {
  local label="$1"
  shift

  echo
  echo "==> ${label}"
  "$@"
}

wait_for_server() {
  local attempt

  for attempt in {1..40}; do
    if curl -fsS -I "$base_url/" >/dev/null 2>&1; then
      return 0
    fi

    if [[ -n "$server_pid" ]] && ! kill -0 "$server_pid" >/dev/null 2>&1; then
      echo "Server exited before becoming ready. Log:" >&2
      cat "$server_log" >&2
      return 1
    fi

    sleep 0.25
  done

  echo "Timed out waiting for ${base_url}." >&2
  echo "Server log:" >&2
  cat "$server_log" >&2
  return 1
}

trap cleanup EXIT

mkdir -p .tmp

run_step "Unit tests" npm run test:unit
run_step "Typecheck" npm run typecheck
run_step "Rust API tests" scripts/rust.sh test --locked -p r-cross-cannon
run_step "Rust release build" scripts/rust.sh build --locked --release -p r-cross-cannon
run_step "Production build" npm run build

echo
echo "==> Start Rust API with existing artifacts"
CROSS_CANON_DATA_DIR="$PWD" R_CROSS_CANNON_BIND="127.0.0.1:${rust_port}" target/release/r-cross-cannon >.tmp/verify-rust.log 2>&1 &
rust_pid="$!"
ready=0
for attempt in {1..90}; do
  if curl -fsS "${R_CROSS_CANNON_ORIGIN}/r/api/health" >/dev/null 2>&1; then ready=1; break; fi
  kill -0 "$rust_pid" 2>/dev/null || { cat .tmp/verify-rust.log >&2; exit 1; }
  sleep 0.25
done
[[ "$ready" == 1 ]] || { cat .tmp/verify-rust.log >&2; exit 1; }

echo
echo "==> Start production server"
: > "$server_log"
PORT="$verify_port" NODE_ENV=production node build/server/serve.mjs >"$server_log" 2>&1 &
server_pid="$!"

run_step "Wait for ${base_url}" wait_for_server
run_step "Homepage HEAD" curl -fsS -I "$base_url/"
run_step "Web search uses Rust" node --import tsx scripts/smoke-rust-web.ts "$base_url"
run_step "Resource routes use Rust" node scripts/smoke-rust-resources.mjs "$base_url"

echo
echo "Verification passed."
