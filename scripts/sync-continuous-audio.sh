#!/usr/bin/env bash
set -euo pipefail
: "${EC2_PEM_PATH:?EC2_PEM_PATH is required}"
: "${EC2_PUBLIC_IP:?EC2_PUBLIC_IP is required}"
# Upload only completed media referenced by this release's manifest.
# Never delete or overwrite the original chapter recordings.
file_list="$(mktemp)"
trap 'rm -f "$file_list"' EXIT
node --input-type=module > "$file_list" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const manifest = JSON.parse(fs.readFileSync('public/continuous-audio.json', 'utf8'));
for (const file of new Set(Object.values(manifest.chapters).map(c => path.basename(c.url)))) {
  if (!/^(bible|fathers)-[a-z0-9-]+-[a-f0-9]{16}\.m4a$/.test(file)) throw new Error('Invalid media filename');
  console.log(file);
}
JS
remote_dir="/home/ubuntu/cross-cannon/storage/audio/continuous"
ssh -i "$EC2_PEM_PATH" "ubuntu@$EC2_PUBLIC_IP" "mkdir -p '$remote_dir'"
rsync -az --files-from="$file_list" \
  -e "ssh -i $EC2_PEM_PATH" \
  storage/audio/continuous/ "ubuntu@$EC2_PUBLIC_IP:$remote_dir/"
