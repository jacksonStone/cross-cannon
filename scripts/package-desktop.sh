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
mkdir -p "$bundle/Contents/Resources/library/scripture-cache"
scripts/rust.sh run --release --locked -p cross-canon-core --example package_native -- \
  "$PWD" "$bundle/Contents/Resources/library/native-library.bin" --original-bible-audio
cp scripture-cache/manifest.json "$bundle/Contents/Resources/library/scripture-cache/"
cp rust/desktop/fonts/*LICENSE* "$bundle/Contents/Resources/"
# Reuse the existing web artwork for the native application icon.
iconset="$staging/CrossCanon.iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" public/favicon-512-fd59821d9d5b.png --out "$iconset/icon_${size}x${size}.png" >/dev/null
  retina_size=$((size * 2))
  sips -z "$retina_size" "$retina_size" public/favicon-512-fd59821d9d5b.png --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$bundle/Contents/Resources/CrossCanon.icns"
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
<key>CFBundleIconFile</key><string>CrossCanon.icns</string>
<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLName</key><string>com.crosscanon.reader</string><key>CFBundleURLSchemes</key><array><string>crosscanon</string></array></dict></array>
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
# Replace the executable inode: overwriting a running signed binary can leave
# macOS validating its old cached signature on the next launch.
rm -f "$final_bundle/Contents/MacOS/cross-canon-desktop"
# Drop the previous generated library so older JSON/audio payloads cannot linger.
rm -rf "$final_bundle/Contents/Resources/library"
cp -R -X "$bundle/Contents/." "$final_bundle/Contents/"
# The portable archive excludes Finder/resource-fork metadata that sync services
# can attach to .app folders under Desktop. Its signature was verified above.
ditto -c -k --norsrc --keepParent "$bundle" "$PWD/dist/Cross Canon Desktop.zip"
# Resolve resources from the bundle, with no dependency on the working directory.
(cd /tmp && "$bundle/Contents/MacOS/cross-canon-desktop" --check-library)
printf '\nBuilt %s\nPortable archive: %s\n' "$final_bundle" "$PWD/dist/Cross Canon Desktop.zip"
