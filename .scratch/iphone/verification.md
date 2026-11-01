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

## Verified locally

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

## Pending Apple setup

Xcode 26.3 is installed, but its license/first-launch setup is incomplete. The
simulator launcher stops with setup instructions. Direct cross-target checking
cannot locate an active iOS SDK in the selected command-line-tools environment.
Both ARM64 Rust device/simulator standard libraries have been installed into the
isolated toolchain; no Apple license has been accepted by the agent.

After Xcode setup, run `scripts/run-ios.sh`. The iOS build/link, simulator launch,
keyboard, actual safe areas, audio and suspend/resume remain unverified. Physical
iPhone installation additionally needs the user's Apple signing team and device
provisioning. No installable iPhone release is claimed yet.

The existing production API and existing user changes are outside this commit.

## Review

Spec review reports no material gaps for this preparation stage. Standards
review reports no documented violations or correctness findings, with one minor
nonblocking duplication observation: desktop and phone toolbars share the same
audio play/pause logic in two handlers. Platform build/runtime checks remain
pending, as described above.
