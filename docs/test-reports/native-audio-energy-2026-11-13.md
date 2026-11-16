# Native audio energy audit — November 13, 2026

The user reports phone warmth after a few minutes of audio playback. The paired
iPhone was unavailable for profiling, and the user could not connect it during
this audit. Phone temperature, GPU load and power draw were not measured. This
report establishes unnecessary playback work, not the cause of the thermal symptom.
The initial audit changed no production app source. The subsequent implementation
and regression checks are recorded below. The update was subsequently installed
and launched on the paired phone over Wi-Fi.

## Reproducible playback work

The probe imports the actual `rust/desktop/src/apple_audio.m` adapter, runs real
AVPlayer playback of the bundled 2 John AAC fixture locally at muted volume, and
counts adapter-to-Rust events and calls to `updateNowPlaying`. After startup it
measures three seconds of continuous playback without seeks or chapter changes.
It fails if unused position events are emitted or media metadata is repeatedly
published during that steady interval.

Command after compilation:

```sh
.tmp/energy-audit/audio-energy-probe "$PWD/rust/desktop/tests/fixtures/2-john.m4a"
```

Observed baseline:

```text
FAIL: steady playback sends unused reader updates and repeatedly republishes system media metadata
ENERGY_AUDIT {"seconds":3,"unusedPositionEvents":12,"metadataUpdates":12,"rustWakeups":12,"playing":true}
```

Each position event causes `audio.rs` to request an egui repaint. The receiver
only stores `audio_seconds`; no production UI reads this field. The adapter also
replaces the system Now Playing dictionary on every 250 ms periodic callback.
The periodic callback additionally checks chapter boundaries, so it must not be
removed wholesale without replacing or retaining that behavior.

## Controlled comparisons

Three isolated source copies under `.tmp/energy-audit/` changed one contributor
at a time, followed by a combined comparison. Production source remained intact.

| Three-second interval | Position events | Now Playing updates | Rust wakeups | Still playing |
| --- | ---: | ---: | ---: | --- |
| Current adapter | 12 | 12 | 12 | Yes |
| Suppress position messages only | 0 | 13 | 0 | Yes |
| Suppress periodic metadata only | 11 | 0 | 11 | Yes |
| Suppress both | 0 | 0 | 0 | Yes |

Callback counts vary slightly at interval boundaries. These measurements show
that both streams are avoidable during steady playback. They do not prove a
battery or temperature improvement, nor validate seeking, all media controls,
interruptions or chapter transitions after a fix.

Apple documents that the system extrapolates elapsed playback time from elapsed
time and playback rate, and frequent metadata updates are unnecessary:
[MPNowPlayingInfoPropertyElapsedPlaybackTime](https://developer.apple.com/documentation/mediaplayer/mpnowplayinginfopropertyelapsedplaybacktime).
Apple also documents the power cost of unnecessary rendering:
[Rendering efficiency](https://developer.apple.com/documentation/xcode/improving-your-app-s-rendering-efficiency).

## Other observations

- Study sync has a five-second minimum interval, but receives credentials only
  on a successful account refresh. It does not independently fetch every five
  seconds. Account refresh was every twenty seconds when clean; both paths also
  requested unnecessary half-second timer redraws. No network power was measured.
- A five-second sample of the installed, idle Mac process showed zero added CPU
  time. Its threads were waiting. That sample is not a foreground iPhone playback
  measurement and does not rule out the reported issue.
- The existing Release-mode native frame audit passed using the packaged library.
  It measures CPU layout work without the phone GPU, and is not an energy test.
- Xcode's Power Profiler template is installed. A real-device recording requires
  the paired iPhone to be reachable and unlocked; profile the reported playback
  scenario before attributing warmth to these findings.

Evidence: `.tmp/energy-audit/audio-baseline.log`, `audio-comparison.json`,
`mac-baseline.json`, `mac-idle.sample.txt`, and `frame-baseline.log`.

## Follow-up playback validation

The quieter adapter copy also passed the existing real AVPlayer probe for
continuous chapters, pause/resume, fallback to original recordings, media
metadata and notifications. The probe's previous position-event assertion was
supplemented by a check of the actual Now Playing chapter/time, since unused
position messages are intentionally suppressed in that copy.

A separate real-player seek probe advanced from the first chapter to 44 seconds
inside chapter three. Both adapters reported the correct chapter, a published
elapsed time of 44 seconds and playback rate 1.0 while playback continued.
Evidence: `quiet-controls.log`, `seek-baseline.log`, and `seek-quiet.log` under
`.tmp/energy-audit/`.

The Apple audio worker blocks on a message receiver between events; it is not a
busy loop. AVPlayer manages streaming and decoding. There is no evidence here of
a custom audio-decoding spin loop. The native reader has no visible elapsed-time
control consuming its stored `audio_seconds` value.

Both sync paths create a new reqwest HTTP client for each polling operation.
That discards the per-client connection pool between operations. The initial
estimate of fifteen clean reads per minute overlooked the account credential
gate. An unchanged signed-in reader normally requests one account/study pair
per account interval (previously twenty seconds), subject to persistence and
in-flight requests. This is a source-level finding, not a cellular-radio power measurement.
Apple recommends batching networking and avoiding frequent background wakeups:
[Networking power usage](https://developer.apple.com/documentation/xcode/reducing-networking-and-bluetooth-power-usage).

The redundant audio notifications are not gated on foreground activity in the
adapter. No conclusion is drawn about actual background GPU draws: iOS and the
windowing backend also control whether drawing executes, and this needs a device
trace. The initial audit used isolated source copies to suppress these notifications.

Recommended first implementation: eliminate unused position-driven reader
wakeups, publish Now Playing information on significant playback changes, and
retain accurate chapter-end handling. Then address clean/idle sync frequency and
reuse HTTP clients. Regression checks must continue covering seeking, remote
controls, fallback, chapter transitions and suspension/resume. On-device Power
Profiler data is still needed to attribute the reported warmth and quantify any
power savings.

## Implemented after the audit

- Removed periodic position messages, their Rust event variant and the unused
  stored playback time. Retained the 250 ms chapter-boundary check and file-end
  notifications so aligned chapters and separate files still advance.
- Removed periodic Now Playing publication. Metadata now refreshes on player
  state changes (including waiting/recovery), ready/duration events, chapter
  changes and completed seeks, as well as explicit playback commands. Seek
  completion runs on the main queue with a generation guard, preventing old
  completions from changing a newer session. Paused seeks update actual elapsed
  time without relying on another playback tick.
- Removed account/study half-second redraw requests and account worker-wait
  redraw checks. Workers already request a repaint when they finish. Account
  timers now schedule the actual next deadline: thirty seconds for clean sync,
  two seconds for dirty reading progress, and the existing login/revocation
  deadlines. Returning to the reader still forces an immediate refresh. A final
  scheduling pass after rendering accounts for reading changes made in that frame.
- Study still follows a validated account refresh. Changes from another device
  can take up to the new clean interval to appear while the app remains open.
  HTTP client pooling remains a separate follow-up.

Regression checks:

```sh
bash scripts/test-native-audio.sh
scripts/rust.sh test --locked -p cross-canon-desktop
```

The durable real AVPlayer probe first failed with six metadata publications and
six reader wakeups over 1.5 seconds. After the fix both counts were zero while
audio time continued advancing. It also verifies finite duration, paused and
playing seeks, chapter metadata, pause/resume, direct player state changes and
cleared metadata on stop. The companion probe passes continuous chapter
advancement, fallback and continuation between two actual MP3 files. These Mac
checks do not substitute for physical iPhone interruption/background testing.

The sync regression test first failed with an idle repaint deadline of about
483 ms. It now passes with a deadline near thirty seconds when clean, two seconds
when reading is dirty (including a change after the frame's initial tick), no
timer while a worker is busy, and the correct login poll/expiry deadlines.
All seventy native tests passed; four opt-in tests were ignored. The iPhone
Release library builds successfully. Formatting and whitespace checks pass.

Evidence: `.tmp/energy-audit/regression-before.log`, `regression-after.log`,
`chapter-files-after.log`, `sync-before.log`, `sync-after.log`,
`native-tests-after.log`, and `ios-build-after.log`.

The original three-second repro was rerun against the fixed production adapter:

```text
ENERGY_AUDIT {"seconds":3,"unusedPositionEvents":0,"metadataUpdates":0,"rustWakeups":0,"playing":true}
```

## iPhone installation

After the user confirmed the phone was on the same Wi-Fi, CoreDevice discovered
the paired iPhone 14 Pro over `localNetwork`. Xcode's signed Release app passed
signature verification and was installed over `com.crosscanon.mobile`, preserving
the app's data container. CoreDevice confirmed successful launch with PID 27673.
No website or database deployment was needed for this native-only update.

The retained artifact is `dist/ios/audio-energy/Cross Canon.ipa`, SHA256
`e18b57040685a84b4919411d868785ad6f829d2ed5a68d53ddfbf2bd05b2288a`.
Build, discovery, installation and launch receipts are under
`.tmp/energy-audit/ios-app-build.log`, `devices-now.json`, `phone-install.json`,
`phone-launch.json`, and `ios-artifact.json`. At that point physical-device power
had not been measured. The subsequent [background-audio profile and scheduler
fix](native-background-audio-profile-2026-11-13.md) records the real-device
measurements, the dominant remaining event-loop defect and its verified fix.
