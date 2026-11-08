# Native performance pass — 2026-11-07

The iOS/macOS Rust reader retains all 81 Scripture Books and 410 Fathers Works,
150,073 Passages, both original and modernized wording, and existing audio
alignments. Audio remains opt-in, using original recordings without transcoding.
No database, embedding, transcription or source-cache update was performed.

## Measurements

The release audit exercises actual core operations and egui phone-size frames
on the host Mac. These are CPU timings, not physical iPhone frame rates or
network latency. Before and after used the same existing text corpus and
operations. Measurements were taken serially without concurrent builds. A noisy
concurrent-build audit was excluded from the comparison.

| Operation | Before | After |
| --- | ---: | ---: |
| Fathers work picker frame | 13.06 ms | 0.66 ms |
| Offline-audio catalog, fresh installation | 113.26 ms | 1.26 ms |
| First offline-audio menu frame | 113.04 ms | 1.44 ms |
| All-text keyword search, warmed normalization | 84.77 ms | 15.01 ms |
| Bible keyword search, warmed normalization | 6.58 ms | 0.61 ms |
| City of God playback-plan preparation | 6.79 ms | 0.32 ms |
| Chapter lookup batch, same IDs | 8.55 ms | 0.049 ms |
| Prepared library load, host | 401.59 ms | 341.41 ms |

The first all-text keyword query still takes approximately 85 ms. Normalized
text is built lazily for each searched Book and retained for later searches;
results themselves are not cached. This trades additional runtime RAM for faster
subsequent searches without increasing startup normalization work or disk size.
Filtering, Unicode lowercase handling, scores and result ordering match the
previous algorithm exactly in the regression test.

Reading/settings/results rendering was already inexpensive. Steady long-Book
scroll-frame CPU remains approximately 0.04 ms. Initial City of God layout is
approximately 148 ms versus 146 ms before, with no demonstrated improvement.
Exact full-Book geometry is retained to preserve stable chapter jumps. Selecting
one paragraph previously rebuilt the entire work (4,855 cached text layouts in
the regression); it now invalidates only the old/new selection and their chapter
geometry, stays below 200 cached layouts in that test, and takes 0.066 ms in the
release audit.

## Changes

- Book and Chapter lookups use runtime indexes. Keyword search filters Books
  first, normalizes searched text once, selects the best K candidates before
  sorting, and clones text only for returned hits. Runtime caches are excluded
  from the packaged format.
- Jump borrows Book metadata instead of copying all 410 Works and their Chapter
  trees every frame. Selection no longer changes the entire reader layout key.
- Audio preparation resolves each unique recording once per playback plan and
  checks storage roots once. A new plan sees files removed/downloaded since the
  previous plan. Hex cache keys avoid per-byte temporary allocations. The fresh
  downloads catalog skips filesystem checks when no audio storage exists.
- AVPlayer events wake the Rust worker directly, replacing its 100 ms polling
  loop. This removes the polling delay and ten idle worker wakeups per second;
  AVPlayer's existing position notifications remain unchanged.
- Remote searches share one HTTP client/connection pool. A local HTTP regression
  verifies two searches reuse one TCP connection. Actual remote query time still
  depends on the network, server and embedding service; no WAN speedup is claimed.
- Native library v3 uses checksummed Zstandard compression, declared output size,
  bounded decode and existing validation. v1/raw and v2/gzip remain readable.
  Codec comparison verified identical decompressed bytes: gzip 37.81 MB/256 ms
  versus Zstandard 30.99 MB/131 ms. Full native roundtrip tests compare every
  Book, Passage and alignment and reject truncated compressed data.
- Mac packaging now uses the same single prepared native library as iOS and
  removes older generated library resources before replacing them.

## iOS launch and package

The final Release simulator run reached library readiness in **340 ms**, versus
393 ms for the preceding gzip build. First reader frame preparation remained
**1.414 seconds**, the same as that preceding build; the text-loading gain did
not measurably reduce the full first-frame path. The original chapter-JSON path
measured 3.527 seconds earlier. These are simulator preparation timings, not
screen-presentation measurements or physical-device launch times.

The development-signed iPhone bundle is **44.76 MB**, down from 51.47 MB. Its IPA
is **36.90 MB**, down from 43.60 MB (decimal MB). Neither contains MP3/M4A files.
The signature verifies. Device and simulator Release builds pass. The iPhone
14 Pro remained unavailable in `devicectl`; this build was not installed there.
The generated archive is `dist/ios/Cross Canon.ipa`.

## Verification and reproduction

Four core tests and 30 native tests pass, with four explicitly opt-in tests
ignored in the normal suite. The two release performance tests pass with
budgets enforced. Search equivalence, passage selection, download retry/removal,
saved focus/navigation and HTTP connection reuse are covered. Real AVPlayer
continuous playback, pause/resume, fallback and system metadata pass; the
original-MP3 chapter-file probe also passes. Formatting, Clippy with warnings
denied and repository verification pass.

```sh
scripts/rust.sh test --locked -p cross-canon-core -p cross-canon-desktop --lib
CROSS_CANON_PERF_LIBRARY="$PWD/.tmp/ios-speed/library" CROSS_CANON_PERF_ENFORCE=1 \
  scripts/rust.sh test --locked --release -p cross-canon-desktop performance:: \
  -- --include-ignored --nocapture --test-threads=1
scripts/rust.sh run --release --locked -p cross-canon-core --example profile_codecs -- \
  .tmp/ios-opt-in/library/native-library.bin
scripts/rust.sh clippy --locked -p cross-canon-core -p cross-canon-desktop --all-targets -- -D warnings
VERIFY_PORT=13035 VERIFY_RUST_PORT=13036 npm run verify
bash scripts/package-desktop.sh
scripts/run-ios.sh
```

`profile_codecs` deliberately takes an older v2 gzip library for comparison.
Raw before/after audit logs are `.tmp/native-speed-before.log` and
`.tmp/native-speed-final.log`; simulator timing is
`.tmp/native-speed-ios-timing.log`. These generated logs are local/ignored.
Visual checks: `docs/screenshots/native-speed-ios-reader.png`,
`docs/screenshots/native-speed-phone-downloads.png`, and
`docs/screenshots/native-speed-desktop-downloads.png`.
