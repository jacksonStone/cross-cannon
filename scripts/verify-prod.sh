#!/usr/bin/env bash
set -euo pipefail

prod_url="${PROD_URL:-https://www.crosscanon.com}"
prod_url="${prod_url%/}"
remote_service="${VERIFY_PROD_SERVICE:-cross-cannon}"
skip_remote="${VERIFY_PROD_SKIP_REMOTE:-}"

run_step() {
  local label="$1"
  shift

  echo
  echo "==> ${label}"
  "$@"
}

verify_remote_service() {
  if [[ -n "$skip_remote" ]]; then
    echo "Skipping remote service check because VERIFY_PROD_SKIP_REMOTE is set."
    return
  fi

  if [[ -z "${EC2_PEM_PATH:-}" || -z "${EC2_PUBLIC_IP:-}" ]]; then
    echo "Missing EC2_PEM_PATH or EC2_PUBLIC_IP for remote production check." >&2
    echo "Set VERIFY_PROD_SKIP_REMOTE=1 to run only public HTTP checks." >&2
    return 1
  fi

  ssh -i "$EC2_PEM_PATH" ubuntu@"$EC2_PUBLIC_IP" \
    "systemctl is-active ${remote_service} && journalctl -u ${remote_service} -n 30 --no-pager"
}

run_step "Remote service status: ${remote_service}" verify_remote_service
run_step "Production homepage HEAD: ${prod_url}" curl -fsS -I "${prod_url}/"
run_step "Production search POST smoke" curl -fsS -X POST "${prod_url}/?index" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "question=fear and comfort" \
  --data "matchCount=5" \
  -o /dev/null

echo
echo "Production verification passed."
