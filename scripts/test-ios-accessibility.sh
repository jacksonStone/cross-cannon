#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
simulator="${IOS_SIMULATOR_ID:-$(xcrun simctl list devices available -j | python3 -c '
import json, sys
devices = [d for runtime, items in json.load(sys.stdin)["devices"].items() if "iOS" in runtime for d in items if d.get("isAvailable") and d["name"].startswith("iPhone")]
devices.sort(key=lambda d: d["state"] != "Booted")
if not devices: raise SystemExit("Install an iPhone simulator runtime in Xcode Settings > Components.")
print(devices[0]["udid"])
')}"
output="$PWD/.tmp/ios-accessibility"
probe_dir="$(mktemp -d /private/tmp/crosscanon-accessibility-probe.XXXXXX)"
trap 'rm -rf "$probe_dir"' EXIT
app="$probe_dir/Accessibility Probe.app"
mkdir -p "$app" "$output" docs/screenshots/ios-text-accessibility
sdk="$(xcrun --sdk iphonesimulator --show-sdk-path)"
xcrun --sdk iphonesimulator clang -fobjc-arc -fblocks -target arm64-apple-ios17.0-simulator \
  -isysroot "$sdk" -framework UIKit -framework Foundation -framework CoreText -framework CoreGraphics \
  rust/desktop/tests/ios_accessibility_probe.m -o "$app/Accessibility Probe"
cp -X rust/desktop/fonts/SourceSerif4-*.ttf "$app/"
rm -f "$app/reader-performance.json"
if [[ -n "${IOS_READER_PERF_INPUT:-}" ]]; then cp -X "$IOS_READER_PERF_INPUT" "$app/reader-performance.json"; fi
python3 - "$app/Info.plist" <<'PY'
import plistlib, sys
with open(sys.argv[1], 'wb') as f:
    plistlib.dump(dict(CFBundleIdentifier='com.crosscanon.accessibility-probe',
        CFBundleExecutable='Accessibility Probe', CFBundleName='Accessibility Probe',
        CFBundlePackageType='APPL', CFBundleVersion='1', CFBundleShortVersionString='1.0',
        MinimumOSVersion='17.0', UIDeviceFamily=[1], UILaunchScreen={}), f)
PY
xattr -cr "$app"
codesign --force --sign - "$app"
xcrun simctl bootstatus "$simulator" -b
xcrun simctl install "$simulator" "$app"
xcrun simctl launch --console --terminate-running-process "$simulator" com.crosscanon.accessibility-probe 2>&1 | tee "$output/probe.log"
rg -q '^PASS: UIKit selection' "$output/probe.log"
container="$(xcrun simctl get_app_container "$simulator" com.crosscanon.accessibility-probe data)"
cp "$container"/Documents/native-*.png docs/screenshots/ios-text-accessibility/
