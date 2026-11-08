#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
case "${PLATFORM_NAME:?Run this script through the Xcode project}" in
  iphoneos) rust_target=aarch64-apple-ios ;;
  iphonesimulator) rust_target=aarch64-apple-ios-sim ;;
  *) echo "Unsupported platform: $PLATFORM_NAME" >&2; exit 1 ;;
esac
export IPHONEOS_DEPLOYMENT_TARGET=15.0
export CARGO_TARGET_DIR="$PWD/target"
build_options=(build --locked --lib -p cross-canon-desktop --target "$rust_target")
if [[ "${CONFIGURATION:-Debug}" == Release ]]; then build_options+=(--release); fi
scripts/rust.sh "${build_options[@]}"
# Prepare existing texts for fast native loading; audio downloads are opt-in.
# No scripture cache, recording, alignment or database is regenerated.
scripts/package-ios-library.py "${TARGET_BUILD_DIR:?}/${UNLOCALIZED_RESOURCES_FOLDER_PATH:?}/library"
cp rust/desktop/fonts/*LICENSE* "$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/"
