#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# These host-side scheduler tests need no phone, window, audio device or library.
# Xcode supplies an iOS SDK environment; don't use it for the Mac test runner.
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
if ! test_output="$(env -u SDKROOT -u IPHONEOS_DEPLOYMENT_TARGET -u CARGO_BUILD_TARGET \
  CARGO_TERM_COLOR=never scripts/rust.sh test --locked -p eframe --lib \
  --no-default-features --features glow,default_fonts,persistence,x11,wayland,accesskit \
  repaint_tests -- --test-threads=1 2>&1)"; then
  printf '%s\n' "$test_output"
  exit 1
fi
printf '%s\n' "$test_output"

# A dependency upgrade or removed test must not turn this into a green zero-test run.
for regression in \
  withheld_redraw_does_not_leave_the_loop_polling \
  due_requests_preserve_the_next_future_deadline; do
  if [[ "$test_output" != *"test native::run::repaint_tests::$regression ... ok"* ]]; then
    printf 'Required redraw regression did not pass: %s. Preserve these checks when upgrading eframe.\n' "$regression" >&2
    exit 1
  fi
done
