#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
prod_url="${PROD_URL:-https://www.crosscanon.com}"
prod_url="${prod_url%/}"
remote_service="${VERIFY_PROD_SERVICE:-cross-cannon}"
[[ "$remote_service" =~ ^[a-zA-Z0-9@_.-]+$ ]] || { echo 'Invalid production service name.' >&2; exit 1; }
run_step() {
  local label="$1"
  shift
  echo
  echo "==> ${label}"
  "$@"
}
verify_remote_service() {
  if [[ -n "${VERIFY_PROD_SKIP_REMOTE:-}" ]]; then
    echo 'Skipping remote process proof because VERIFY_PROD_SKIP_REMOTE is set.'
    return
  fi
  : "${EC2_PEM_PATH:?Set EC2_PEM_PATH or VERIFY_PROD_SKIP_REMOTE=1}"
  : "${EC2_PUBLIC_IP:?Set EC2_PUBLIC_IP or VERIFY_PROD_SKIP_REMOTE=1}"
  ssh -o BatchMode=yes -i "$EC2_PEM_PATH" "ubuntu@${EC2_PUBLIC_IP}" bash -s -- "$remote_service" <<'REMOTE'
set -euo pipefail
service="$1"
systemctl is-active "$service"
pid="$(systemctl show "$service" -p MainPID --value)"
executable="$(sudo readlink -f "/proc/$pid/exe")"
[[ "${executable##*/}" == cross-cannon ]] || { echo 'Expected the unified Rust executable.' >&2; exit 1; }
if systemctl is-active --quiet r-cross-cannon; then
  echo 'Legacy Rust API service still runs a second Library.' >&2
  exit 1
fi
curl -fsS --max-time 10 http://127.0.0.1:3005/r/api/health
curl -fsS --max-time 10 http://127.0.0.1:3006/r/api/health
journalctl -u "$service" -n 20 --no-pager
REMOTE
}
run_step 'One managed Rust process, both existing edge ports' verify_remote_service
run_step 'Production reader HEAD' curl -fsS -I "${prod_url}/"
run_step 'Production browser artifact and workers' node scripts/smoke-browser-artifact.mjs "$prod_url"
run_step 'Production compatibility form searches' node --import tsx scripts/smoke-rust-web.ts "$prod_url"
run_step 'Production resources and audio ranges' node scripts/smoke-rust-resources.mjs "$prod_url"
run_step 'Production edge route boundaries' node scripts/smoke-direct-rust-proxy.mjs "$prod_url"
run_step 'Production account documents and private protocol' node scripts/smoke-rust-accounts.mjs "$prod_url"
echo
echo 'Production verification passed.'
