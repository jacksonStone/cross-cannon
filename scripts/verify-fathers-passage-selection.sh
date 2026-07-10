#!/usr/bin/env bash
set -euo pipefail

verify_port="${VERIFY_PORT:-3005}"
base_url="http://127.0.0.1:${verify_port}"
server_log=".tmp/verify-fathers-passage-selection.log"
server_pid=""

cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" >/dev/null 2>&1; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT
mkdir -p .tmp
: > "$server_log"
npm run build
PORT="$verify_port" NODE_ENV=production npm run start >"$server_log" 2>&1 &
server_pid="$!"

for _ in {1..40}; do
  if curl -fsS -I "$base_url/" >/dev/null 2>&1; then
    E2E_BASE_URL="$base_url" npm run e2e:fathers-passage-selection
    exit 0
  fi

  if ! kill -0 "$server_pid" >/dev/null 2>&1; then
    cat "$server_log" >&2
    exit 1
  fi

  sleep 0.25
done

cat "$server_log" >&2
exit 1
