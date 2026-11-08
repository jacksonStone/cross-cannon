#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
probe_dir="$(mktemp -d /private/tmp/crosscanon-audio-probe.XXXXXX)"
trap 'rm -rf "$probe_dir"' EXIT
xcrun --sdk macosx clang -fobjc-arc -fblocks \
  rust/desktop/src/apple_audio.m rust/desktop/tests/apple_audio_probe.m \
  -framework Foundation -framework AVFoundation -framework CoreMedia -framework MediaPlayer \
  -o "$probe_dir/audio-probe"
if (( $# )); then
  "$probe_dir/audio-probe" "$@"
else
  "$probe_dir/audio-probe" "$PWD/rust/desktop/tests/fixtures/2-john.m4a"
fi
