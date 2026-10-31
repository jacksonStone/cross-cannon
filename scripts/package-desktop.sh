#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$(uname -s)" == Darwin ]] || { echo 'The .app packager requires macOS.' >&2; exit 1; }
scripts/rust.sh build --release --locked -p cross-canon-desktop
staging="$(mktemp -d /private/tmp/cross-canon-package.XXXXXX)"
trap 'rm -rf "$staging"' EXIT
bundle="$staging/Cross Canon Desktop.app"
final_bundle="$PWD/dist/Cross Canon Desktop.app"
# Replacing this generated bundle never touches source artifacts or user state.
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources/library/public"
cp target/release/cross-canon-desktop "$bundle/Contents/MacOS/"
cp -R -X scripture-cache "$bundle/Contents/Resources/library/"
cp -R -X public/church-fathers-preview "$bundle/Contents/Resources/library/public/"
cp public/continuous-audio.json "$bundle/Contents/Resources/library/public/"
cp rust/desktop/fonts/*LICENSE* "$bundle/Contents/Resources/"
cat > "$bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>cross-canon-desktop</string>
<key>CFBundleIdentifier</key><string>com.crosscanon.desktop</string>
<key>CFBundleName</key><string>Cross Canon Desktop</string>
<key>CFBundleDisplayName</key><string>Cross Canon Desktop</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>NSHighResolutionCapable</key><true/>
<key>LSMinimumSystemVersion</key><string>11.0</string>
</dict></plist>
PLIST
# Copying existing text assets can carry Finder metadata; clear it only in this generated bundle.
xattr -cr "$bundle"
/usr/bin/strip -x "$bundle/Contents/MacOS/cross-canon-desktop"
# Stage outside Desktop so file-provider metadata cannot interfere with signing.
# Ad-hoc signing makes the locally built Apple Silicon bundle launchable.
codesign --force --deep --sign - "$bundle"
codesign --verify --deep --strict "$bundle"
mkdir -p "$final_bundle/Contents"
# Copy rather than move large bundles out of Desktop/file-provider folders.
cp -R -X "$bundle/Contents/." "$final_bundle/Contents/"
# The portable archive excludes Finder/resource-fork metadata that sync services
# can attach to .app folders under Desktop. Its signature was verified above.
ditto -c -k --norsrc --keepParent "$bundle" "$PWD/dist/Cross Canon Desktop.zip"
# Resolve resources from the bundle, with no dependency on the working directory.
(cd /tmp && "$bundle/Contents/MacOS/cross-canon-desktop" --check-library)
printf '\nBuilt %s\nPortable archive: %s\n' "$final_bundle" "$PWD/dist/Cross Canon Desktop.zip"
