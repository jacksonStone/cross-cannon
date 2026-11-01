#!/usr/bin/env bash
# Build-only fallback for an API route release with an unchanged dependency lock.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${EC2_PEM_PATH:?Set EC2_PEM_PATH}"
: "${EC2_PUBLIC_IP:?Set EC2_PUBLIC_IP}"
[[ -f build/server/index.js ]] || { echo 'Run npm run verify first.' >&2; exit 1; }
release="$(date -u +%Y%m%dT%H%M%SZ)"
lock_hash="$(shasum -a 256 package-lock.json | cut -d ' ' -f 1)"
archive=".tmp/r-api-bridge-$release.tar.gz"
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$archive" build/server build/client/assets rust/deploy/cross-cannon-resources.conf
scp -o BatchMode=yes -i "$EC2_PEM_PATH" "$archive" "ubuntu@${EC2_PUBLIC_IP}:/tmp/r-api-bridge-$release.tar.gz"
ssh -o BatchMode=yes -o ConnectTimeout=15 -i "$EC2_PEM_PATH" "ubuntu@$EC2_PUBLIC_IP" bash -s -- "$release" "$lock_hash" <<'REMOTE'
set -euo pipefail
release="$1"
expected_lock="$2"
app=/home/ubuntu/cross-cannon
actual_lock="$(sha256sum "$app/package-lock.json" | cut -d ' ' -f 1)"
[[ "$actual_lock" == "$expected_lock" ]] || { echo 'Dependency lock mismatch; use the standard release.' >&2; exit 1; }
staging="/home/ubuntu/r-cross-cannon/web-releases/$release"
mkdir -p "$staging"
tar -xzf "/tmp/r-api-bridge-$release.tar.gz" -C "$staging"
test -s "$staging/build/server/index.js"
cp "$app/build/server/index.js" "$staging/previous-server.js"
dropin=/etc/systemd/system/cross-cannon.service.d/30-rust-resources.conf
if [[ -f "$dropin" ]]; then cp "$dropin" "$staging/previous-resources.conf"; fi
if [[ -f "$app/build/server/serve.mjs" ]]; then cp "$app/build/server/serve.mjs" "$staging/previous-serve.mjs"; fi
applied=0
healthy=0
ready=0
rollback() {
  if [[ "$applied" == 1 && "$healthy" == 0 ]]; then
    cp "$staging/previous-server.js" "$app/build/server/index.js"
    if [[ -f "$staging/previous-serve.mjs" ]]; then cp "$staging/previous-serve.mjs" "$app/build/server/serve.mjs"; fi
    if [[ -f "$staging/previous-resources.conf" ]]; then
      sudo install -m 644 "$staging/previous-resources.conf" "$dropin"
    else
      sudo rm -f "$dropin"
    fi
    sudo systemctl daemon-reload
    sudo systemctl restart cross-cannon
  fi
}
trap rollback EXIT
# Keep existing immutable client assets for already-open readers.
cp -a "$staging/build/client/assets/." "$app/build/client/assets/"
cp -a "$staging/build/server/assets/." "$app/build/server/assets/"
cp "$staging/build/server/index.js" "$app/build/server/index.js.next"
mv "$app/build/server/index.js.next" "$app/build/server/index.js"
applied=1
cp "$staging/build/server/serve.mjs" "$app/build/server/serve.mjs"
sudo mkdir -p /etc/systemd/system/cross-cannon.service.d
sudo install -m 644 "$staging/rust/deploy/cross-cannon-resources.conf" "$dropin"
sudo systemctl daemon-reload
sudo systemctl restart cross-cannon
for attempt in {1..40}; do
  if curl -fsS --max-time 3 http://127.0.0.1:3005/r/api/health > "$staging/health.json"; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]]
curl -fsS --max-time 20 http://127.0.0.1:3005/r/api/search -H 'Content-Type: application/json' -d '{"query":"beginning","limit":3}' > "$staging/search.json"
curl -fsS --max-time 20 'http://127.0.0.1:3005/?_data=routes%2F_index' -H 'Content-Type: application/x-www-form-urlencoded' --data 'question=fear+and+comfort&matchCount=5' -D "$staging/web-search.headers" > "$staging/web-search.json"
python3 - "$staging" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
assert 'x-cross-canon-search: rust' in (root / 'web-search.headers').read_text().lower()
assert len(json.loads((root / 'web-search.json').read_text())['results']) == 5
PY
curl -fsS --max-time 20 http://127.0.0.1:3005/church-fathers-preview/books.json -D "$staging/resource.headers" -o /dev/null
python3 - "$staging/resource.headers" <<'PY'
import pathlib, sys
assert 'x-cross-canon-resource: rust' in pathlib.Path(sys.argv[1]).read_text().lower()
PY
healthy=1
cat "$staging/health.json"
rm -f "/tmp/r-api-bridge-$release.tar.gz"
echo "Rust web search published; code backup: $staging/previous-server.js"
REMOTE
