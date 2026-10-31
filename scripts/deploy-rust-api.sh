#!/usr/bin/env bash
# Separate Rust release. No database/cache/audio rebuild or upload.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${EC2_PEM_PATH:?Set EC2_PEM_PATH}"
: "${EC2_PUBLIC_IP:?Set EC2_PUBLIC_IP}"
release="$(date -u +%Y%m%dT%H%M%SZ)"
archive=".tmp/r-cross-cannon-${release}.tar.gz"
mkdir -p .tmp
# Explicit allowlist: a release can never contain storage or secrets.
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$archive" Cargo.toml Cargo.lock rust
ssh_args=(-o BatchMode=yes -o ConnectTimeout=15 -i "$EC2_PEM_PATH")
scp -o BatchMode=yes -i "$EC2_PEM_PATH" "$archive" "ubuntu@${EC2_PUBLIC_IP}:/tmp/r-cross-cannon-${release}.tar.gz"
ssh "${ssh_args[@]}" "ubuntu@${EC2_PUBLIC_IP}" bash -s -- "$release" <<'REMOTE'
set -euo pipefail
release="$1"
base=/home/ubuntu/r-cross-cannon
mkdir -p "$base/releases/$release" "$base/toolchain"
tar -xzf "/tmp/r-cross-cannon-${release}.tar.gz" -C "$base/releases/$release"
export RUSTUP_HOME="$base/toolchain/rustup"
export CARGO_HOME="$base/toolchain/cargo"
export PATH="$CARGO_HOME/bin:$PATH"
if [[ ! -x "$CARGO_HOME/bin/cargo" ]]; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o "$base/toolchain/rustup-init.sh"
  sh "$base/toolchain/rustup-init.sh" -y --profile minimal --no-modify-path
fi
cd "$base/releases/$release"
cargo build --release --locked -p r-cross-cannon -j 2
# Validate the new binary against the existing production artifacts before switch.
CROSS_CANON_DATA_DIR=/home/ubuntu/cross-cannon R_CROSS_CANNON_BIND=127.0.0.1:13006 target/release/r-cross-cannon > /tmp/r-cross-cannon-smoke.log 2>&1 &
smoke_pid=$!
trap 'kill "$smoke_pid" 2>/dev/null || true' EXIT
ready=0
for attempt in {1..90}; do
  if curl -fsS --max-time 2 http://127.0.0.1:13006/r/api/health >/dev/null; then ready=1; break; fi
  kill -0 "$smoke_pid" 2>/dev/null || { cat /tmp/r-cross-cannon-smoke.log; exit 1; }
  sleep 1
done
[[ "$ready" == 1 ]] || { cat /tmp/r-cross-cannon-smoke.log; exit 1; }
curl -fsS --max-time 20 http://127.0.0.1:13006/r/api/search -H 'Content-Type: application/json' -d '{"query":"beginning","limit":3}' >/dev/null
kill "$smoke_pid"
wait "$smoke_pid" || true
trap - EXIT
previous="$(readlink "$base/current" || true)"
ln -sfn "$base/releases/$release" "$base/current"
sudo install -m 644 rust/deploy/r-cross-cannon.service /etc/systemd/system/r-cross-cannon.service
sudo systemctl daemon-reload
sudo systemctl enable r-cross-cannon
sudo systemctl restart r-cross-cannon
ready=0
for attempt in {1..90}; do
  if curl -fsS --max-time 2 http://127.0.0.1:3006/r/api/health; then ready=1; break; fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then
  if [[ -n "$previous" ]]; then ln -sfn "$previous" "$base/current"; sudo systemctl restart r-cross-cannon; fi
  exit 1
fi
rm -f "/tmp/r-cross-cannon-${release}.tar.gz"
echo "Rust API release $release is healthy. Publish the /r/api bridge with npm run ship."
REMOTE
