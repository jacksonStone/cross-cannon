#!/usr/bin/env bash
set -euo pipefail

local_audio_dir="${1:-storage/audio/WEBD_AT}"
remote_audio_dir="/home/ubuntu/cross-cannon/storage/audio/WEBD_AT"

if [[ ! -d "$local_audio_dir" ]]; then
  echo "Missing local audio directory: $local_audio_dir" >&2
  echo "Run: node --import tsx scripts/download-audio.ts" >&2
  exit 1
fi

if [[ -z "${EC2_PEM_PATH:-}" || -z "${EC2_PUBLIC_IP:-}" ]]; then
  echo "EC2_PEM_PATH and EC2_PUBLIC_IP are required." >&2
  exit 1
fi

ssh -i "$EC2_PEM_PATH" ubuntu@"$EC2_PUBLIC_IP" "mkdir -p '$remote_audio_dir'"

rsync -az --progress \
  -e "ssh -i $EC2_PEM_PATH" \
  "$local_audio_dir/" \
  "ubuntu@$EC2_PUBLIC_IP:$remote_audio_dir/"

ssh -i "$EC2_PEM_PATH" ubuntu@"$EC2_PUBLIC_IP" \
  "find '$remote_audio_dir' -type f -name '*.mp3' | wc -l && du -sh '$remote_audio_dir'"
