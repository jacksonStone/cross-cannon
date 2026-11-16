# Native iPhone and macOS apps

Both platforms run `cross-canon-desktop` and `cross-canon-core`, sharing reading,
search, study and account reconciliation with the browser. The crate name stays
stable for build commands. Native packages contain the complete immutable text
library and source catalog; reading, navigation and keyword search need no
network or local server. Semantic search and account sync use the Rust API.
Recordings remain optional downloads.

## macOS

```bash
scripts/rust.sh run --locked -p cross-canon-desktop
scripts/package-desktop.sh
```

Packaging writes `dist/Cross Canon Desktop.app` and
`dist/Cross Canon Desktop.zip`. The bundle resolves its library from
`Contents/Resources/library`, independently of the checkout and databases.
The packager checks resource resolution outside the repo, clears generated
Finder metadata, signs locally and verifies the portable ZIP. Distribution
signing, notarization and Windows/Linux installers are separate work.

A desktop phone-size layout preview uses:

```bash
CROSS_CANON_PHONE_PREVIEW=1 scripts/rust.sh run --locked -p cross-canon-desktop
```

## iPhone

Install Xcode, accept its license and install an iPhone simulator runtime. Rust
needs `aarch64-apple-ios` and `aarch64-apple-ios-sim` for device/simulator builds.
Use the intended toolchain explicitly; ordinary builds never install toolchains.

```bash
scripts/run-ios.sh
# For Rust debugging:
IOS_CONFIGURATION=Debug scripts/run-ios.sh
```

The launcher defaults to optimized Release, selects an available simulator,
builds, installs and launches. `IOS_SIMULATOR_ID` selects a device;
`DEVELOPER_DIR` selects Xcode. Generated files stay under `.tmp/ios-build` and
`target/`. The script stages the small Xcode project outside synced Desktop
folders to avoid file-coordination stalls.

For a signed device Release, open `ios/CrossCanon.xcodeproj`, select scheme
`CrossCanon`, the `iphoneos` SDK and your development team/device. Signing
credentials are not stored here. Install with `xcrun devicectl device install app`;
updating `com.crosscanon.mobile` preserves app data. Launch requires an unlocked
phone. App Store/TestFlight distribution is separate from local development
signing.

## Reader and platform behavior

UIKit supplies selectable reading text, native Copy/Look Up/Translate/Share,
VoiceOver and Read & Speak. Larger Text and Bold Text combine with reader
settings. Reflow, rotation and chapter loading retain the focused Passage.
The browser HTML surface implements the same text contract; the macOS egui
surface shares domain behavior while retaining its measured scroll geometry.

Native libraries use lossless compression and indexes for Book/Chapter lookup;
keyword normalization is prepared lazily per searched Book. Packaging never
rebuilds indexes, aligns recordings or embeds a recording collection.
Apple audio uses AVPlayer and system media controls; other desktop targets keep
their existing playback adapter. Downloads prefer complete cached recordings,
retain existing chapter offsets and remain independent of text. Keep iPhone
apps open while downloading; iOS may suspend background workers.

Google login opens the system browser and returns a one-use ticket through the
registered `crosscanon` scheme. Native credentials live in Keychain on Apple
platforms. See [account setup](google-login.md).

## Required checks

```bash
scripts/rust.sh test --locked -p cross-canon-desktop -- --test-threads=1
npm run test:native-repaint
bash scripts/test-ios-accessibility.sh
```

The repaint regression gate runs before macOS packaging and iPhone Release
builds and fails if required tests fail or disappear. The accessibility harness
uses an isolated UIKit app and creates normal/large-text previews without
opening accounts or search databases.

For event-loop/framework changes, repeat an unplugged 90-second background-audio
capture on a physical phone, including locked playback and returning to reading.
Investigate sustained background CPU above 5% of one core; the fixed baseline
was 0.175%. Host tests cannot establish phone battery, thermal or touch behavior.
Preserve the framework backport's coverage when upgrading its dependency.

Evidence: [background audio profile](test-reports/native-background-audio-profile-2026-11-13.md),
[latest UIKit accessibility review](test-reports/ios-text-accessibility-2026-11-15.md),
and [framework backport](../rust/desktop/vendor/eframe/UPSTREAM.md).
