# iOS startup and offline audio — 2026-11-07

This records the initial bundled-audio implementation. The current installation
uses opt-in audio and lossless text compression; see
[the size follow-up](ios-size-opt-in-2026-11-07.md). Its signed install archive
replaces the earlier large archive at the same output path.

The iOS reader previously opened nearly 13,000 Chapter JSON files, parsed their
contents and reconstructed all 150,073 passages before entering UIKit. The
replacement packages the same existing artifacts into a versioned, typed native
library at build time. No database, Scripture cache, recording or alignment is
regenerated. The runtime retains all 491 Books, both text variants, Passage IDs,
chapter structure and audio timestamps. The packer fails on missing artifacts.

## Startup measurements

The initial repeatable host check of the old native startup path failed a 700 ms
library preparation budget at 1.643 seconds. The prepared library subsequently
loaded in 210–276 ms in isolated host runs.

A direct iPhone 16e / iOS 26.3 simulator comparison used the same optimized Rust
binary, fresh reader state and Genesis location. A generated comparison app
contained the original JSON artifacts instead of `native-library.bin`; the final
app was then reinstalled, including all bundled Bible audio.

| Startup boundary | Original JSON path | Prepared native library |
| --- | ---: | ---: |
| Library ready | 2.528 s | 0.242 s |
| First reader frame prepared | 3.527 s | 1.244 s |

The final first-frame preparation is approximately 65% faster in this simulator
comparison. Another final run with the downloads dialog open measured 193 ms to
library readiness and 1.313 s to first-frame preparation. Timings are CPU-side
preparation through egui's first update, not a measurement of displayed pixels,
physical iPhone performance or sustained frame rate.

Enable diagnostic timing with `CROSS_CANON_STARTUP_TIMING=1`; for simulator
launches, use the `SIMCTL_CHILD_` environment prefix. The remaining initialization
includes UIKit/Metal and fonts. Normal startup makes no audio download requests.

## Offline audio

- The app bundles 66 continuous Bible recordings, about 2.18 GB. All 1,189
  recorded Chapters resolve to files in the installed library. This includes
  2 Timothy's versioned source URL, which previously missed the continuous map.
  The additional Scripture Books retain their texts but have no recordings in
  the existing collection.
- **Aa → Offline audio** offers the currently aligned Fathers recordings:
  First Clement (1/65 Chapters), Confessions (18/275), City of God (664/664).
  Multiple Chapters sharing a track download it once. Existing offsets are
  preserved when playing a local recording.
- Downloads run off the UI thread, show byte/track progress, support pause,
  retry/resume and removal, and retain completed tracks across restarts. They
  require the app to remain in the foreground. An unfinished track restarts on
  resume. Files are published atomically after response length/type and audio
  signature checks; interrupted, empty and HTML responses cannot become playable.
- Bundled/downloaded files take priority over streaming. Download storage is
  separate from text, reader state and bundled audio. URLs are encoded without
  filename collisions or remote path traversal.
- A live source test found BiblicalAudio rejects generic requests. The native
  downloader's explicit `CrossCanon/0.1` user agent successfully downloaded and
  validated its existing First Clement MP3 (approximately 9 MB).
- A final AVPlayer check against that real downloaded MP3 rejected a generic
  `.audio` cache filename (`Cannot Open`). The cache now preserves `.mp3`/`.m4a`
  container extensions. The same native playback probe then passed with the
  actual downloaded MP3, including transitions, seeking, pause/resume and fallback.
  Cache-extension assertions prevent this failure from returning; the probe
  script accepts an optional recording path for repeatable local-file checks.

## Verification

- `scripts/rust.sh test --locked -p cross-canon-core -p cross-canon-desktop --lib`:
  2 core tests and 28 native tests passed; 2 live-network tests were opt-in.
  The new live Fathers recording test was also explicitly run and passed.
- Tests compare every packaged Passage and Book with the source artifacts,
  reject stale/truncated native bundles, exercise interrupted/cancelled/invalid
  downloads, retry only missing tracks after HTTP failure, remove cached audio,
  deduplicate shared tracks and preserve chapter offsets. Existing saved reader
  location, navigation, search and scrolling tests pass.
- `target/release/examples/check_startup .tmp/ios-offline-audio/library 0.7 --offline-audio`:
  210 ms; all 66 Books / 1,189 Chapters resolve locally.
- Native clippy with warnings denied, formatting and diff checks pass.
- `VERIFY_PORT=13035 VERIFY_RUST_PORT=13036 npm run verify` passes, including
  typecheck, Rust API tests, web build, search and resource/range-audio checks.
- The AVPlayer probe passes real local playback, chapter transitions,
  pause/resume, original fallback and system media metadata.
- Final Release simulator app builds, installs and launches. The ARM64 iPhone
  Release static library builds. The signed device app was staged outside the
  synced Desktop directory after Finder metadata blocked Xcode's signing step;
  its development signature passes `codesign --verify --deep --strict`. The
  install archive is `dist/ios/Cross Canon.ipa`; the current unpacked signed app
  path is recorded in `.tmp/ios-startup-audio-signed-app-path.txt`.
  Screenshots were visually inspected at desktop
  and phone sizes, including the actual simulator safe-area layout:
  `docs/screenshots/ios-offline-audio-desktop.png`,
  `docs/screenshots/ios-offline-audio-phone.png`, and
  `docs/screenshots/ios-offline-audio-simulator.png`.

The connected-device inventory currently reports the iPhone 14 Pro as unavailable.
Installation and on-device timing still require the phone to be connected and
unlocked. The simulator was restored to the final app after the comparison.
