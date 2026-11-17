#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f Cargo.toml && -d rust/api ]] || { echo 'Run verification from Cross Canon.' >&2; exit 1; }
verify_port="${VERIFY_PORT:-3005}"
verify_host="${VERIFY_HOST:-127.0.0.1}"
compat_port="${VERIFY_COMPAT_PORT:-13006}"
base_url="http://${verify_host}:${verify_port}"
server_pid=""
server_log=.tmp/verify-server.log
cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
run_step() {
  local label="$1"
  shift
  echo
  echo "==> ${label}"
  "$@"
}
mkdir -p .tmp
export CROSS_CANNON_UPDATE_DB=0
run_step 'Off-server tooling tests' npm run test:unit
run_step 'Browser audio playback' node --test scripts/browser-audio-browser.test.mjs
run_step 'Shared text artifacts' scripts/rust.sh test --locked -p cross-canon-core
run_step 'Off-server TypeScript tooling' npm run typecheck
run_step 'Rust server, account and API tests' scripts/rust.sh test --locked -p r-cross-cannon
run_step 'Rust server and browser production build' npm run build

echo
echo '==> Start the single production Rust server'
CROSS_CANON_DATA_DIR="$PWD" R_CROSS_CANNON_BIND="${verify_host}:${verify_port}" \
  R_CROSS_CANNON_COMPAT_BIND="${verify_host}:${compat_port}" \
  target/release/r-cross-cannon >"$server_log" 2>&1 &
server_pid="$!"
ready=0
for attempt in {1..120}; do
  if curl -fsS --max-time 2 "$base_url/r/api/health" >/dev/null 2>&1; then ready=1; break; fi
  kill -0 "$server_pid" 2>/dev/null || { cat "$server_log" >&2; exit 1; }
  sleep 0.25
done
[[ "$ready" == 1 ]] || { cat "$server_log" >&2; exit 1; }
run_step 'Homepage HEAD' curl -fsS -I "$base_url/"
run_step 'Compatibility listener shares the same server' curl -fsS "http://${verify_host}:${compat_port}/r/api/health"
run_step 'Rust browser artifact and workers' node scripts/smoke-browser-artifact.mjs "$base_url"
run_step 'Installed reader upgrades and offline startup' env BROWSER_TEST_URL="$base_url" node scripts/browser-upgrade.test.mjs
run_step 'Mouse wheel scrolling over dialog buttons' env BROWSER_TEST_URL="$base_url" node scripts/browser-scroll.test.mjs
run_step 'Mobile startup budget' env BROWSER_TEST_URL="$base_url" node scripts/browser-startup.test.mjs
run_step 'Continuous Scripture book scrolling' env BROWSER_TEST_URL="$base_url" node scripts/browser-book-scroll.test.mjs
run_step 'Compatibility search forms use Rust' node --import tsx scripts/smoke-rust-web.ts "$base_url"
run_step 'Resource bytes, compression and audio ranges' node scripts/smoke-rust-resources.mjs "$base_url"
run_step 'Account documents and private endpoints' node scripts/smoke-rust-accounts.mjs "$base_url"
run_step 'Browser account and native handoff journey' node scripts/e2e-rust-accounts.mjs
echo
echo 'Verification passed: one Rust process serves the complete app.'
