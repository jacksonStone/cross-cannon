#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
log_dir="storage/deploy-logs"
log_file="${log_dir}/large-index-prod-${timestamp}.log"
mkdir -p "$log_dir"

exec > >(tee -a "$log_file") 2>&1

echo "==> Cross Canon large-index production deploy started at $(date -u +%Y-%m-%dT%H:%M:%SZ)"

: "${EC2_PUBLIC_IP:?EC2_PUBLIC_IP is required}"
: "${EC2_PEM_PATH:?EC2_PEM_PATH is required}"

if [[ "$EC2_PEM_PATH" == "~/"* ]]; then
  EC2_PEM_PATH="${HOME}/${EC2_PEM_PATH#~/}"
fi

if [[ ! -f storage/crosscannon.db ]]; then
  echo "Missing storage/crosscannon.db" >&2
  exit 1
fi

if [[ ! -f storage/indexing-jobs.db ]]; then
  echo "Missing storage/indexing-jobs.db" >&2
  exit 1
fi

echo "==> Pushing commits"
git push

echo "==> Running local checks"
npm run typecheck

echo "==> Deploying app package"
./deploy.sh

echo "==> Uploading large-model DB files"
ssh -i "$EC2_PEM_PATH" ubuntu@"$EC2_PUBLIC_IP" "mkdir -p /home/ubuntu/.temp/cross-cannon-large-index"
scp -i "$EC2_PEM_PATH" storage/crosscannon.db ubuntu@"$EC2_PUBLIC_IP":/home/ubuntu/.temp/cross-cannon-large-index/crosscannon.db
scp -i "$EC2_PEM_PATH" storage/indexing-jobs.db ubuntu@"$EC2_PUBLIC_IP":/home/ubuntu/.temp/cross-cannon-large-index/indexing-jobs.db

echo "==> Swapping DB files and restarting service"
ssh -i "$EC2_PEM_PATH" ubuntu@"$EC2_PUBLIC_IP" <<'REMOTE'
set -euo pipefail
sudo systemctl stop cross-cannon
mkdir -p /home/ubuntu/cross-cannon/storage
rm -f /home/ubuntu/cross-cannon/storage/crosscannon.db
rm -f /home/ubuntu/cross-cannon/storage/indexing-jobs.db
mv /home/ubuntu/.temp/cross-cannon-large-index/crosscannon.db /home/ubuntu/cross-cannon/storage/crosscannon.db
mv /home/ubuntu/.temp/cross-cannon-large-index/indexing-jobs.db /home/ubuntu/cross-cannon/storage/indexing-jobs.db
rm -rf /home/ubuntu/.temp/cross-cannon-large-index
chown -R ubuntu:ubuntu /home/ubuntu/cross-cannon/storage
sudo systemctl start cross-cannon
systemctl is-active cross-cannon
REMOTE

echo "==> Smoke checking live routes"
curl -sS -L -o /tmp/cross-cannon-prod-index.html -w 'index status=%{http_code} bytes=%{size_download} time=%{time_total}\n' 'https://www.crosscanon.com/?index'
cache_url="$(grep -o '/scripture-cache/[a-f0-9]\{16\}\.json' /tmp/cross-cannon-prod-index.html | head -1)"
if [[ -z "$cache_url" ]]; then
  echo "Could not find scripture cache URL in live HTML" >&2
  exit 1
fi
curl -sS -L -H 'Accept-Encoding: gzip' -o /tmp/cross-cannon-prod-cache.gz -w 'cache status=%{http_code} bytes=%{size_download} time=%{time_total}\n' "https://www.crosscanon.com${cache_url}"
curl -sS -L --max-time 60 'https://www.crosscanon.com/?index' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'question=hope%20after%20death&books=Genesis&matchCount=5' \
  -o /tmp/cross-cannon-prod-search.html \
  -w 'search status=%{http_code} bytes=%{size_download} time=%{time_total}\n'

echo "==> Cross Canon large-index production deploy finished at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Log: ${log_file}"
