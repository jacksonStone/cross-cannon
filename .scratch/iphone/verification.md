# iPhone preparation and desktop compatibility

Baseline: `fb9fd36a6`. User requested iPhone first, then asked to wrap up pending
Xcode setup and explicitly preserve the functional desktop version.

## Implemented

- Separate iPhone Xcode application target with shared Rust/egui renderer,
  wgpu/Metal, a small native launcher, safe-area bridge and sandbox persistence.
- Shared reader supports narrow phone widths, touch-sized main controls,
  scrolling dialogs, a book picker/chapter grid and wrapping reader settings.
- Existing desktop entry command and OpenGL renderer remain in place. Its
  implementation moved to a library so the iOS host can reuse it.
- Text/metadata packager copies existing artifacts; no production changes,
  database work, embeddings or timestamp generation.
- `scripts/run-ios.sh` checks Xcode setup, chooses an iPhone simulator, builds,
  installs and launches the development target.

## Preparation checks before Xcode setup

- Host Rust check and all seven Rust workspace tests pass (one core, two reader,
  three API library and one API socket test). The socket test requires the
  sandbox's loopback restriction to be lifted; the complete rerun passes.
- Phone interaction regression passes at 320- and 393-point widths: tools open
  by pointer/touch-compatible events, Jump opens, dialog backdrops dismiss,
  focused-passage/theme/font settings restore, and keyword search returns local
  passages with an unreachable API URL.
- Mac release build and packaging pass, including ad-hoc signature verification
  and resolving all 491 books / 150,073 passages from a staged bundle outside the
  repository's working directory.
- The iPhone text package also loads those complete counts; SHA-256 checks
  confirm all 13,687 bundled JSON artifacts match their original files.
- Xcode project and Info.plist pass `plutil -lint`. Shell scripts pass `bash -n`.
- Native desktop screenshots are saved under `docs/screenshots/`; a phone-size
  macOS preview is explicitly separate from an iPhone simulator screenshot.

## Xcode verification on 2026-11-01

The user completed Apple's license/first-launch setup. The missing ARM64
iOS 26.3.1 simulator runtime was installed through Xcode's official
`xcodebuild -downloadPlatform iOS -architectureVariant arm64` command.

- `scripts/run-ios.sh` builds, installs and launches on the iPhone 16e simulator.
  The actual UI renders through Metal, respecting the notch and home indicator.
- Native UIKit software-keyboard entry works. On the initial prepared reader,
  entering `beginning` and choosing keyword search returns 20 passages. The
  subsequent desktop-search parity edits belong to a concurrent user chat; the
  iPhone app was rebuilt with those shared changes, but that task owns detailed
  search contract and result-layout acceptance.
- Jump navigates from Genesis 1 to Genesis 3. After pressing Home, terminating
  the app, and launching it again, Genesis 3 and its focused passage restore.
- The corpus switch opens the bundled Early Christian reader (The Pastor of
  Hermas), displaying its local text and chapter heading.
- All 13,687 JSON files in the installed simulator bundle match their original
  source SHA-256 hashes. This includes the existing text and timestamp metadata.
- A generic physical ARM64 iPhone build also compiles and links with signing
  disabled. This proves the device target builds, not that it is installed on a
  physical phone.
- The complete Rust workspace test run passes: 12 tests pass and one live
  search-parity test is explicitly ignored by the concurrent desktop task.
- A real simulator screenshot is saved at
  `docs/screenshots/cross-canon-iphone-simulator.png`.

The first simulator boot's launch service returned a transient no-process error;
opening the app succeeded, and subsequent complete build/install/launch runs
succeeded. The runtime's initial boot/migration took several minutes.

## Runtime fixes found by verification

macOS Bash 3 treats an empty array expansion as unbound with `set -u`. The Debug
Xcode phase initially failed at `build_options[@]`. Building the nonempty argument
array first fixes Debug while retaining the Release flag.

Native audio testing reproduced a Rodio 0.20 decoder panic: its `ReadSeekSource`
reports no byte length, but Symphonia's MP4 reader requires one for seekable input.
The panic killed the audio worker and left the UI on `Loading audio…`. A local
regression using byte-identical existing 2 John M4A bytes failed with that exact
panic before the fix. Rodio 0.21.1, an explicit byte length/seekable decoder, and
direct seeking to the existing chapter offset pass the same test. Playback is
still bounded by the unchanged `end_seconds - start_seconds` timestamps.
The new fixture copies existing audio; it does not re-encode or generate media.
After the fix, Genesis 3 reaches the playing state in the actual simulator,
clears `Loading audio…`, and changes the control to Pause. Tapping Pause returns
it to Play. This verifies native playback initialization and pause state;
sound quality and physical-device audio remain outside this check. Recordings
are still downloaded before playback, so large book recordings have a loading
delay; this release does not implement range streaming.

## Remaining distribution checks

Physical iPhone installation needs the user's signing team and device
provisioning. No App Store/TestFlight release or physical-device runtime test is
claimed. The production API and concurrent desktop-search edits are outside
this verification commit.

## Review

Spec review reports no material gaps for this preparation stage. Standards
review reports no documented violations or correctness findings, with one minor
nonblocking duplication observation: desktop and phone toolbars share the same
audio play/pause logic in two handlers. Follow-up Standards and Spec reviews of
the runtime fixes report no actionable findings. Simulator playback confirmation,
pending Mac unlock at review time, subsequently passed as described above.
