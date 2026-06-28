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

cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" >/dev/null 2>&1; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
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

run_step "Typecheck" npm run typecheck
run_step "Production build" npm run build

echo
echo "==> Start production server"
: > "$server_log"
PORT="$verify_port" NODE_ENV=production npm run start >"$server_log" 2>&1 &
server_pid="$!"

run_step "Wait for ${base_url}" wait_for_server
run_step "Homepage HEAD" curl -fsS -I "$base_url/"
run_step "Search POST smoke" curl -fsS -X POST "${base_url}/?index" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "question=fear and comfort" \
  --data "matchCount=5" \
  -o /dev/null

echo
echo "Verification passed."
