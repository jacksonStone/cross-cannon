#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
if ! xcodebuild -checkFirstLaunchStatus; then
  echo 'Open Xcode, accept its license and finish setup, including an iOS simulator runtime.' >&2
  exit 1
fi
# Override IOS_SIMULATOR_ID to select a particular available iPhone.
simulator_id="${IOS_SIMULATOR_ID:-$(xcrun simctl list devices available -j | python3 -c '
import json,sys
devices=[d for runtime,items in json.load(sys.stdin)["devices"].items() if "iOS" in runtime for d in items if d.get("isAvailable") and d["name"].startswith("iPhone")]
devices.sort(key=lambda d:d["state"]!="Booted")
if not devices: raise SystemExit("Install an iOS simulator runtime in Xcode Settings > Components.")
print(devices[0]["udid"])
')}"
xcrun simctl boot "$simulator_id" 2>/dev/null || xcrun simctl bootstatus "$simulator_id" -b
open -a "$DEVELOPER_DIR/Applications/Simulator.app"
xcrun simctl bootstatus "$simulator_id" -b
xcodebuild -project ios/CrossCanon.xcodeproj -scheme CrossCanon -configuration Debug \
  -destination "platform=iOS Simulator,id=$simulator_id" -derivedDataPath "$PWD/.tmp/ios-build" \
  CODE_SIGNING_ALLOWED=NO build
bundle="$PWD/.tmp/ios-build/Build/Products/Debug-iphonesimulator/Cross Canon.app"
xcrun simctl install "$simulator_id" "$bundle"
xcrun simctl launch "$simulator_id" com.crosscanon.mobile
