# Cross Canon for iPhone

The iPhone target reuses the desktop Rust/egui reader and `cross-canon-core`.
The native Objective-C launcher starts the Rust app, configures the audio
session and reports UIKit safe-area insets. Small OS adapters provide AVPlayer
playback, system media controls and incoming reader links. Rendering uses wgpu/Metal on iOS;
desktop retains its existing OpenGL renderer. There is no webview or local server.

All 491 books and 150,073 passages are packaged from the existing immutable text
artifacts. Reading, navigation and keyword search work without a network. The
existing Rust API at `https://www.crosscanon.com/r/api` handles semantic/similar
queries. All 81 Scripture Books and 410 Early Christian Works are included as
offline text in a losslessly compressed native library of approximately 31 MB.
Audio is streamed until the user explicitly downloads it. No recordings are
included in the installation. Bible downloads use the existing original MP3s
without re-encoding; the complete 66-Book / 1,189-Chapter recording collection
uses approximately 1.39 GB, and individual Books can be downloaded instead.
The additional Scripture books have text but no recordings in the collection.
No embeddings or source recordings are regenerated.

The build prepares a single versioned native library from the existing text and
audio metadata. Startup reads this directly instead of opening roughly 13,000
Chapter JSON files and reconstructing their passages on the phone. All texts,
original/modernized variants, passage IDs and audio offsets are retained. The
v3 library uses checksummed Zstandard compression; older gzip and uncompressed
libraries remain readable. Navigation uses runtime Book/Chapter indexes, and
keyword normalization is cached lazily for searched Books. See the
[measured performance pass](test-reports/native-performance-2026-11-07.md).
The simulator launcher defaults to optimized Release builds; use
`IOS_CONFIGURATION=Debug scripts/run-ios.sh` when debugging Rust itself.

## Optional offline audio

Open **Aa → Offline audio** to choose **Entire Bible**, expand **Choose individual
Bible books**, or download available Early Christian recordings. Downloads never
start automatically, and cached tracks are shared between the per-Book and
whole-Bible choices. Downloaded recordings can be removed independently of text.
The screen shows Chapter coverage for each Work: City of God currently has all
664 Chapters aligned, Confessions has 18 of 275, and First Clement has 1 of 65.
Only those existing chapter-aligned recordings are offered. Shared tracks are
downloaded once, and chapter playback keeps the existing timestamps.

Downloads show track and byte progress and can be paused, resumed or removed.
Keep the app open while downloading; iOS can suspend the worker when the app is
in the background. Completed tracks survive interruption and app restarts;
resuming retries the unfinished track. Partial or failed responses never replace
a playable recording. Playback prefers downloaded files, then uses
the existing streaming URLs when a recording has not been downloaded.

The recordings are stored in the app's Application Support directory. Removing
audio leaves all texts and saved reading positions intact. Building the app
requires existing text/metadata artifacts, not a local recording collection.
The packager replaces the generated library so audio from older large bundles
cannot accidentally remain in the installation.

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
The script mirrors the small Xcode host project into `/private/tmp` while building
Rust from this checkout, avoiding file-coordination stalls in synced Desktop folders.

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
scroll on short screens. Search follows mobile web: its header stays fixed while
the form and full passages share one scrolling body, with Filters in a separate
dialog. Paper, sepia, dark and contrast themes and the bundled
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
passage restoration were checked there. The parity pass adds separate per-corpus
locations, verse jumps, work favorites, native reader links, a compact settings
popover, full readable work titles and landscape support. It also reuses the web
artwork for the app icon. AVPlayer now handles streaming and seeking, continuous
chapters, original Scripture fallback, system media controls, and audio-session
interruptions. A real AVPlayer probe verifies continuous playback, pause/resume,
fallback and system metadata using an existing local recording. The final parity
build was verified on the simulator; the earlier unsigned physical iPhone target
build predates these updates. See the [parity follow-up](test-reports/native-parity-2026-11-01.md).

On 2026-11-02, development signing and provisioning were completed, and the app
was installed and launched on a connected iPhone 14 Pro. The scrolling follow-up
uses an optimized Release build; see [its verification record](test-reports/ios-scrolling-2026-11-02.md).
Automated touch replay and desktop phone previews are separate from hands-on
assessment of scrolling feel on the physical phone.

The build uses Rust's documented [iOS device and simulator targets](https://doc.rust-lang.org/rustc/platform-support/apple-ios.html)
and follows the existing winit iOS integration: an exported Rust entry point is
called from the application's native `main` function. The app's Xcode build phase
compiles that static library and copies the existing resource files.
