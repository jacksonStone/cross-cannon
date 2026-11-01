# Cross Canon for iPhone

The iPhone target reuses the desktop Rust/egui reader and `cross-canon-core`.
The native Objective-C launcher only starts the Rust app, configures the audio
session and reports UIKit safe-area insets. Rendering uses wgpu/Metal on iOS;
desktop retains its existing OpenGL renderer. There is no webview or local server.

All 491 books and 150,073 passages are packaged from the existing immutable text
artifacts. Reading, navigation and keyword search work without a network. The
existing Rust API at `https://www.crosscanon.com/r/api` handles semantic/similar
queries. Audio uses the existing recording URLs and timestamp manifests; the
recordings themselves are not bundled. No embeddings or timestamps are rebuilt.

## After enabling Xcode

1. Open `/Applications/Xcode.app`, accept Apple's license and complete setup.
   Install an iOS simulator runtime in Xcode Settings > Components if needed.
2. This checkout already has the ARM64 device and simulator Rust targets. On a
   fresh Rust installation, install `aarch64-apple-ios` and
   `aarch64-apple-ios-sim` using `rustup target add` for your toolchain.
   Rust 1.88 or newer is required; `scripts/rust.sh` uses the isolated toolchain
   in `.tmp/` when present.
3. From the repository root, run:

   ```sh
   scripts/run-ios.sh
   ```

The script picks an available iPhone simulator, builds the Xcode target, bundles
local texts, installs the app and launches it. Set `IOS_SIMULATOR_ID` to use a
specific device, or `DEVELOPER_DIR` to select another Xcode installation.
Generated builds stay under `.tmp/ios-build` and `target/`.

To use Xcode directly:

```sh
open ios/CrossCanon.xcodeproj
```

Select the **CrossCanon** scheme and an iPhone simulator, then Run. For your
physical iPhone, select your signing team under Signing & Capabilities and a
connected device; change the bundle identifier if your team requires it. Device
installation requires Apple's provisioning setup. No signing credentials are
stored here. This is a development target, not an App Store or TestFlight release.

## Reader and desktop compatibility

Phone widths use a compact toolbar with at least 44-point main controls, wrapping
settings/search controls and a book picker above a chapter grid. Dialog bodies
scroll on short screens. Paper, sepia, dark and contrast themes and the bundled
typefaces are shared with desktop. The reader saves the focused passage ID and
settings in the application's sandbox, rather than relying on a raw scroll offset.

Desktop continues to run and package through the same commands:

```sh
scripts/rust.sh run -p cross-canon-desktop
scripts/package-desktop.sh
```

For a desktop-hosted phone-size UI preview (not an iOS simulator):

```sh
CROSS_CANON_PHONE_PREVIEW=1 scripts/rust.sh run -p cross-canon-desktop
```

## Verification status

See [the verification record](../.scratch/iphone/verification.md). The app builds,
installs and launches on the iPhone 16e simulator with iOS 26.3.1. Its real native
software keyboard, safe areas, chapter navigation, corpus switching and saved
passage restoration were checked there. Native audio reaches playing state and
pauses successfully after the M4A decoder fix. Recordings still download before
playback; range streaming is not implemented. Both simulator and unsigned physical iPhone targets compile
and link. The shared Rust regression suite passes, including an existing M4A
decode/seek test added after native testing exposed an older audio-library bug.

Physical-device runtime testing and signing/provisioning remain pending. The
desktop phone preview is separate from the real simulator verification.

The build uses Rust's documented [iOS device and simulator targets](https://doc.rust-lang.org/rustc/platform-support/apple-ios.html)
and follows the existing winit iOS integration: an exported Rust entry point is
called from the application's native `main` function. The app's Xcode build phase
compiles that static library and copies the existing resource files.
