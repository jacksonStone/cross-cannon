# iOS size and opt-in audio — 2026-11-07

The later [native performance pass](native-performance-2026-11-07.md) supersedes
this report's package sizes and gzip format: the current IPA is 36.90 MB and the
installed bundle is 44.76 MB. The measurements below describe the preceding build.

The final direction is a small installation containing all offline text, with
audio available through explicit downloads. The app includes 81 Scripture Books
and all 410 Early Christian Works (491 Books, 150,073 Passages). Audio streams
until downloaded; opening the app or the downloads screen starts no download.

## Size and quality

- The initial continuous AAC Bible recordings used 2.184 GB. The original MP3s
  are smaller at 1.394 GB. Optional iOS Bible downloads now use those existing
  original recordings without re-encoding. All 1,189 copied MP3s were checked
  against their sources with SHA-256 while evaluating a bundled-original option;
  every file was byte-identical. The final app bundles none of them.
- The prepared native text library is losslessly gzip compressed from 250.3 MB
  to 37.8 MB. Tests compare every Book, Passage and audio alignment against the
  original artifacts after decompression, and reject truncated compressed data.
  Both modernized and original Fathers text are retained.
- The packager replaces the complete generated library, removing recordings
  left from previous large builds. Existing user downloads and reading state
  live outside the app bundle and are retained on update.
- The app offers Entire Bible and individual recorded Bible Books, plus the
  available Fathers audio. Whole-Bible and individual downloads share cached
  tracks. Progress, pause, retry/resume and removal remain available. Downloads
  require the app to stay open. Original MP3 chapter-file continuation passes
  the real AVPlayer probe; chapter metadata resets to the original track's zero
  start without changing the media bytes. Fathers alignments remain unchanged.

## Startup tradeoff

Lossless text compression adds decompression work but retains the single-file
native loading path. An isolated host comparison measured 278 ms uncompressed
versus 426–435 ms compressed (approximately 150–160 ms extra). CPU-heavy concurrent
builds produce higher measurements; final simulator measurements are recorded
after those builds finish. Debug builds optimize the compression dependency to
avoid slowing local tests and debugging.

The final Release simulator run measured **393 ms** to library readiness and
**1.414 seconds** to first reader frame preparation. The earlier uncompressed
optimized run took 1.244 seconds to frame preparation; the original JSON loading
path took 3.527 seconds. Thus compression added approximately 170 ms while the
final app remains about 60% faster than the original startup preparation. These
are simulator CPU preparation timings, not physical iPhone launch measurements.

## Final artifacts and checks

- Signed iPhone app bundle: **51.47 MB** including every offline text.
- Signed installation archive: **43.60 MB**, at `dist/ios/Cross Canon.ipa`.
- Both the app and archive were checked to contain no MP3/M4A recordings. The
  app's development signature verifies, and simulator/device Release builds pass.
- Three core tests and 28 native regression tests pass. The live original Bible
  download test also passes and verifies exact bytes against the source MP3.
  Clippy with warnings denied, formatting and diff checks pass.
- The final native text/opt-in check measured 388–456 ms in isolated host runs,
  below its 700 ms library-readiness budget. A concurrent-build run exceeded that
  budget; it is unsuitable for controlled startup comparisons.
- The phone and desktop layouts were visually inspected. Artifacts:
  `docs/screenshots/ios-opt-in-audio-phone.png`,
  `docs/screenshots/ios-opt-in-audio-desktop.png`, and
  `docs/screenshots/ios-opt-in-audio-simulator.png`.

## Verification commands

```sh
scripts/rust.sh test --locked -p cross-canon-core -p cross-canon-desktop --lib
scripts/rust.sh clippy --locked -p cross-canon-core -p cross-canon-desktop --all-targets -- -D warnings
target/release/examples/check_startup .tmp/ios-opt-in/library 0.7 --opt-in-audio
bash scripts/test-native-audio.sh --chapter-files /path/to/first.mp3 /path/to/second.mp3
```

`--opt-in-audio` verifies all 410 offline Fathers Works, all 1,189 optional
original Bible recording URLs, and absence of bundled recordings. An opt-in
live test downloads Genesis 1 through the native downloader and checks its bytes
against the original local recording. Retry/cancel tests use local HTTP fixtures.
The shared-code repository verification also passes:
`VERIFY_PORT=13035 VERIFY_RUST_PORT=13036 npm run verify`.
