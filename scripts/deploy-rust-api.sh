#!/usr/bin/env bash
# Fetch the hosted CI artifact, then publish a binary-only Rust release.
# No database/cache/audio rebuild or upload; no compilation on production.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${EC2_PEM_PATH:?Set EC2_PEM_PATH}"
: "${EC2_PUBLIC_IP:?Set EC2_PUBLIC_IP}"
release="$(date -u +%Y%m%dT%H%M%SZ)-$(node -e 'process.stdout.write(require("node:crypto").randomBytes(4).toString("hex"))')"
archive=".tmp/r-cross-cannon-${release}.tar.gz"
artifact="$PWD/.tmp/rust-api-linux/$release"
mkdir -p .tmp
case "${1:-}" in
  --build-local) scripts/build-rust-api-container.sh "$artifact" ;;
  '')
    git diff --quiet HEAD -- Cargo.toml Cargo.lock rust || { echo 'Commit Rust changes before requesting a hosted release.' >&2; exit 1; }
    [[ -z "$(git ls-files --others --exclude-standard -- Cargo.toml Cargo.lock rust)" ]] || { echo 'Commit new Rust files before requesting a hosted release.' >&2; exit 1; }
    python3 scripts/fetch-rust-api-release.py "$(git rev-parse HEAD)" "$artifact"
    ;;
  *) echo 'Usage: scripts/deploy-rust-api.sh [--build-local]' >&2; exit 1 ;;
esac
python3 scripts/validate-rust-api-artifact.py "$artifact"
# Explicit allowlist: only the built binary, unit, and verification metadata.
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$archive" -C "$artifact" \
  target/release/r-cross-cannon rust/deploy/r-cross-cannon.service BUILD-INFO SHA256SUMS
archive_sha="$(shasum -a 256 "$archive" | awk '{print $1}')"
ssh_args=(-o BatchMode=yes -o ConnectTimeout=15 -i "$EC2_PEM_PATH")
scp -o BatchMode=yes -i "$EC2_PEM_PATH" "$archive" "ubuntu@${EC2_PUBLIC_IP}:/tmp/r-cross-cannon-${release}.tar.gz"
ssh "${ssh_args[@]}" "ubuntu@${EC2_PUBLIC_IP}" bash -s -- "$release" "$archive_sha" <<'REMOTE'
set -euo pipefail
release="$1"
archive_sha="$2"
base=/home/ubuntu/r-cross-cannon
[[ "$(uname -m)" == x86_64 ]] || { echo 'Expected an Intel/AMD x86-64 Linux host.' >&2; exit 1; }
# Share the web deploy lock so compilation/restarts cannot overlap releases.
mkdir -p /home/ubuntu/.workspace-deploy "$base/releases"
exec 9>/home/ubuntu/.workspace-deploy/lock
flock -n 9 || { echo 'Another deployment is running; retry later.' >&2; exit 1; }
printf '%s  %s\n' "$archive_sha" "/tmp/r-cross-cannon-${release}.tar.gz" | sha256sum -c -
mkdir "$base/releases/$release"
python3 - "$release" <<'PY_PACKAGE'
import pathlib,sys,tarfile
release=sys.argv[1]
root=pathlib.Path('/home/ubuntu/r-cross-cannon/releases')/release
expected={'target/release/r-cross-cannon','rust/deploy/r-cross-cannon.service','BUILD-INFO','SHA256SUMS'}
with tarfile.open('/tmp/r-cross-cannon-'+release+'.tar.gz','r:gz') as archive:
 members=archive.getmembers()
 assert len(members)==len(expected) and {m.name for m in members}==expected and all(m.isfile() for m in members), 'Unexpected release contents'
 archive.extractall(root,filter='data')
PY_PACKAGE
cd "$base/releases/$release"
sha256sum -c SHA256SUMS
[[ -x target/release/r-cross-cannon ]]
ldd target/release/r-cross-cannon > ldd.txt
if grep -q 'not found' ldd.txt; then cat ldd.txt >&2; exit 1; fi
# Derive the smoke source from the existing host cache; CI never needs its data.
source_id="$(python3 - <<'PY_SOURCE'
import json,pathlib
root=pathlib.Path('/home/ubuntu/cross-cannon/scripture-cache')
version=json.loads((root/'manifest.json').read_text())['version']
passages=json.loads((root/(version+'.json')).read_text())['passages']
print(next(p['id'] for p in passages if p['reference'].startswith('Genesis 1:')))
PY_SOURCE
)"
[[ "$source_id" =~ ^[a-f0-9]{24}$ ]]
# The production host has 2 GB RAM. Restart the managed service before probes:
# a second full library instance alongside the live process can exhaust the host.
previous="$(readlink "$base/current" || true)"
applied=0
healthy=0
rollback() {
  local status=$?
  if [[ "$applied" == 1 && "$healthy" == 0 && -n "$previous" ]]; then
    echo 'New Rust release failed verification; restoring the previous release.' >&2
    ln -sfn "$previous" "$base/current"
    sudo systemctl restart r-cross-cannon
  fi
  return "$status"
}
trap rollback EXIT
applied=1
ln -sfn "$base/releases/$release" "$base/current"
sudo install -m 644 rust/deploy/r-cross-cannon.service /etc/systemd/system/r-cross-cannon.service
sudo systemctl daemon-reload
sudo systemctl enable r-cross-cannon
sudo systemctl restart r-cross-cannon
ready=0
for attempt in {1..90}; do
  if curl -fsS --max-time 2 http://127.0.0.1:3006/r/api/health >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || { echo 'Rust service did not become ready.' >&2; exit 1; }
python3 - "$source_id" <<'PY_CHECK'
import json,pathlib,sys,urllib.request
origin='http://127.0.0.1:3006/r/api'
root=pathlib.Path('/home/ubuntu/cross-cannon')
def get(path,headers=None):
 return urllib.request.urlopen(urllib.request.Request(origin+path,headers=headers or {}),timeout=30).read()
def search(body):
 request=urllib.request.Request(origin+'/search',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
 return json.load(urllib.request.urlopen(request,timeout=30))
assert json.loads(get('/health'))['status']=='ok'
for corpus,author in [('early-christian','Clement of Rome'),('christian-classics','Thomas à Kempis')]:
 data=search({'sourceId':sys.argv[1],'corpus':corpus,'web':True,'authors':[author],'limit':3})
 assert len(data['results'])==3
 assert all(result['author']==author and result['highlightPassage']['text'] for result in data['results'])
version=json.loads((root/'scripture-cache/manifest.json').read_text())['version']
assert get('/resources/scripture-cache/'+version+'.json',{'Accept-Encoding':'gzip'})==(root/('scripture-cache/'+version+'.json.gz')).read_bytes()
assert len(get('/resources/audio/WEBD_AT/01_Genesis_01.mp3',{'Range':'bytes=0-1023'}))==1024
assert json.loads(get('/resources/christian-classics-text/manifest.json'))['chapterCount']==2580
print('Rust service, both Work collections, compressed Scripture and range audio verified.')
PY_CHECK
healthy=1
trap - EXIT
rm -f "/tmp/r-cross-cannon-${release}.tar.gz"
echo "Rust API release $release is healthy. Publish the /r/api bridge with npm run ship."
REMOTE
