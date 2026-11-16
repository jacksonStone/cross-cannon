# Physical iPhone background-audio profile — November 13, 2026

## Reproduction

The user played audio on their paired iPhone 14 Pro (iOS 27.0.1), with the phone
locked or another app open. Instruments attached to Cross Canon PID 27747,
executable UUID `6DD904EB-C0D9-3FBC-829F-108C0923FC3B`. This was the subsequent
reader-menu/Markdown release, rather than the earlier audio-cleanup binary;
the earlier audio cleanup is present in the current source.

Two real-device Power Profiler captures reproduced excessive main-thread CPU
use, including after the user unplugged the USB cable and continued over Wi-Fi:

| Capture | Measured CPU interval | App CPU time | One-core utilization | GPU impact | Thermal state |
| --- | ---: | ---: | ---: | ---: | --- |
| USB, charging | 120.00 s | 100.80 s | 84.00% | 0 | Nominal, then Fair at 31.69 s |
| Wi-Fi, unplugged | 90.99 s | 77.05 s | 84.68% | 0 | Fair throughout |

CPU utilization is summed `qos-duration` divided by the union of its wall-time
intervals, not a percentage of all six phone cores. Independent sampled stacks
agree: 101.82 of 101.86 sampled CPU seconds in the first recording, and 77.11 of
77.13 seconds in the second, belonged to the app's main thread. The stacks are
dominated by CoreFoundation run-loop timer/observer handling and winit's
`control_flow_end_handler`, including repeated `CFRunLoopTimerSetNextFireDate`.
Audio worker activity was tiny by comparison. GPU and networking power impact
were negligible; this was not a sustained rendering/decoder hotspot.

In the unplugged recording, the whole-device instantaneous power estimate
averaged 40.75% battery capacity/hour (range 24.97–53.01). This is not an
app-attributed drain rate, a measured hour of battery loss, or a battery-life
prediction. Charging correctly yielded zero overall power in the USB capture.
Xcode also prevents normal Apple-silicon sleep during connected profiling, so
these numbers are useful for controlled comparisons, not normal-use battery life.
See Apple's [Power Profiler documentation](https://developer.apple.com/documentation/xcode/measuring-your-app-s-power-use-with-power-profiler).
Thermal state is an OS category, not a surface-temperature measurement.

## Isolated scheduler defect

Ranked candidates were an overdue repaint deadline, a non-sleeping background
event loop, and a profiler-induced effect. The installed eframe 0.31.1 redraw
scheduler sets `ControlFlow::Poll` after consuming a due redraw request. When no
future deadline remains, it never resets that control flow. A hidden iOS window
can withhold `RedrawRequested`, leaving the loop polling instead of sleeping.

This matches [upstream issue 8326](https://github.com/emilk/egui/issues/8326) and
the sleeping-policy fix in [PR 8398](https://github.com/emilk/egui/pull/8398).
That upstream report concerns Wayland; it is supporting implementation evidence,
not proof of the iPhone cause. The iPhone before/after measurement is required.

The actual scheduling policy was extracted, without changing behavior first,
and tested with a redraw callback that never delivers another event. Both the
single hidden-window case and the final consumed deadline failed:

```text
left: Poll
right: Wait
```

The backport consumes due redraw requests without polling, retains future
deadlines, and explicitly returns `Wait` when the queue is empty. Both regression
tests now pass. A licensed, pinned copy of eframe 0.31.1 under
`rust/desktop/vendor/eframe` avoids changing the egui/wgpu API stack. Only
`src/native/run.rs` differs in its implementation; `UPSTREAM.md` records source,
scope, test command and removal condition. Cargo uses this path for all native
targets and excludes it as an independent workspace member.

## Evidence and commands

Capture (use a unique output path for each recording):

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun xctrace record \
  --template 'Power Profiler' --device 00008120-00025D9C1E40C01E \
  --attach 'Cross Canon' --time-limit 90s --output playback.trace
```

Targeted scheduler regression:

```sh
scripts/rust.sh test --locked -p eframe --lib --no-default-features \
  --features glow,default_fonts,persistence,x11,wayland,accesskit repaint_tests
```

Raw traces, XML tables, the reference-resolving XML analysis script, summaries
and build logs are retained under `.tmp/energy-audit/`. Principal baseline files:
`phone-playback-power.trace`, `phone-playback-wireless-power.trace`,
`usb-summary.json`, `wireless-summary.json`, `framework-red.log` and
`framework-green.log`. No phone contents unrelated to app diagnostics were used.

## On-device validation of the backport

The signed Release app passed strict signature verification and was installed
over the existing bundle, retaining app data. The user restarted the same audio,
kept USB unplugged and confirmed background playback before the repeat capture.
The recorded executable UUID `AA6304CD-0C17-3716-A61C-3F04677B9A8E` matches the
signed build; PID 27974 was the target.

| Unplugged background playback | Before | After |
| --- | ---: | ---: |
| CPU measurement interval | 90.99 s | 91.01 s |
| App CPU time | 77.05 s | 0.159 s |
| One-core CPU utilization | 84.68% | 0.175% |
| Sampled main-thread CPU time | 77.109 s | 0.013 s |
| Mean CPU power-impact score | 12.333 | 0.067 |
| Thermal state during capture | Fair | Nominal |
| Whole-device power estimate, % capacity/hour | 40.75 | 4.91 |

The per-process CPU reduction is 99.79% in this scenario. The polling stacks
disappeared. Sampled CoreMedia timebase-synchronization updates span 1.90 through
91.60 seconds in the after recording, supporting ongoing audio rather than an
idle/stopped app. The result isolates the scheduler defect as the dominant
measured app CPU cost during background playback.

Both captures used the same phone and Power Profiler. Whole-device estimates
include other processes and differ in display brightness (4% before, 0% after).
The phone had time to cool during the build break and started the after recording
in Nominal state. Thus neither the power ratio nor the thermal-category change
should be presented as a controlled measurement of battery-life improvement or
cooling speed. This is a short before/after trace, not a long battery rundown.

Validation completed:

- Both actual scheduler regression tests failed before the fix and pass after it.
- All seventy native tests passed; four opt-in tests were ignored.
- The physical iPhone Release app built, signed, installed and launched.
- The repeated physical-device background-audio trace confirms the large CPU
  reduction and the intended executable UUID. No production debug instrumentation
  was needed. Formatting and whitespace checks pass.

Retained installable archive: `dist/ios/background-audio-loop/Cross Canon.ipa`,
SHA256 `b5aea89f45ef22ab305e96c6f97b58bf0e49c0168b8693d3784646d12109a9e5`.
Additional evidence in `.tmp/energy-audit/`: `phone-background-fixed-power.trace`,
`fixed-summary.json`, `background-loop-native-tests.log`,
`background-loop-ios-build.log`, `background-loop-phone-install.json`,
`background-loop-phone-launch.json` and `background-loop-artifact.json`.
The subsystem XML exporter crashed once; a sequential retry succeeded. CPU/QoS,
thermal and sampled-stack exports succeeded independently.

## Prevention

Headless layout/frame benchmarks cannot expose an iOS event-loop polling bug.
The scheduler regressions now run automatically before the Mac packager's build
and before an iPhone Release build, via `scripts/test-native-repaint.sh` (also
`npm run test:native-repaint`). The guard checks both required tests passed; a
dependency upgrade that removes them cannot silently succeed with zero tests.
Xcode's iOS SDK/target variables are cleared for the host-side test process.

The real gate passed directly and under an iOS SDK environment. An isolated
harness exercised the actual Mac and iPhone build scripts with a failing test,
missing tests and passing tests: both paths stopped before the build in the first
two cases, and proceeded to the build only after both tests passed. Evidence:
`.tmp/energy-audit/repaint-build-gate.log`, `repaint-build-gate-ios-env.log` and
`release-gate-boundaries.log`. Shell syntax and whitespace checks passed.

The user subsequently confirmed audio played normally throughout the final
ninety-second capture, completing functional confirmation of the comparison.

Real-device power validation remains a release check when changing the UI event
loop or its dependencies: repeat unplugged background audio, including locking
the phone and returning to the reader. Investigate sustained CPU above 5% of one
core over a ninety-second background interval, compared with the fixed 0.175%
baseline. A phone is required for this check; the host-side gate cannot detect
every OS-specific or future energy regression. Remove the local framework copy
when a tested dependency upgrade includes the upstream fix, preserving the
regression coverage. No broader architectural rewrite is needed for this defect.

## Foreground follow-up

The user asked whether foreground use could have similar inefficiencies and
offered the unlocked reading screen without audio. The attempted sixty-second
Power Profiler capture did not start: Instruments timed out waiting for the
device, and a subsequent CoreDevice process query returned error 1011 (device
unavailable). No foreground CPU/GPU measurements were obtained. The user was
asked to reconnect over USB; charging would mask overall battery power but
still allow app CPU/GPU profiling.

The same corrected scheduler is used in foreground and background. A source
review found the remaining reader repaint requests tied to scrolling/settling,
chapter-window changes, navigation, worker completion and scheduled account
deadlines. Search displays an animated spinner while work is pending. This
review does not establish foreground power efficiency or replace a device trace.
Evidence: `.tmp/energy-audit/phone-foreground-reading-power.log` and
`foreground-processes.json`. Foreground measurements remain pending.

### Subsequent successful wireless foreground capture

After the user confirmed the same Wi-Fi, CoreDevice discovery and app queries
succeeded. Direct Instruments attachment still failed by name and PID. Holding
a read-only CoreDevice connection open did not resolve that failure; a combined
system capture also failed and contained no usable data. Launching the native
app through Instruments succeeded and produced a valid iPhone trace. No USB
connection, app reinstall or service restart was needed.

The trace targets Cross Canon PID 28152, executable UUID
`ED5F2A86-5FB8-380B-BA63-28581A0DC4F7` in the subsequent note-editor-layout build.
The user confirmed scrolling or tapping during the capture, so it must be
interpreted as mixed interactive use, not a stationary-reading benchmark.

- Trace duration: 62.13 seconds; CPU counters cover 59.99 seconds.
- App CPU time: 8.50 seconds, averaging 14.18% of one core across startup,
  foreground interactions and background periods.
- Lifecycle confirms foreground periods at 3.08–5.07 s, 14.14–18.15 s and
  33.97–62.13 s; intervening background periods must not be called foreground.
- CPU counters during the final foreground interval (34.75–61.76 s) average
  18.67% of one core, including the user's interactions.
- Sampled UI painting accounts for about 3.74 CPU seconds. The previous hot
  `control_flow_end_handler` and `CFRunLoopTimerSetNextFireDate` stacks account
  for only 0.055 and 0.053 sampled CPU seconds, respectively. The former
  background polling pattern did not recur.
- Thermal state remained Nominal throughout. GPU power-impact score was nonzero
  during this interactive trace; it is not a GPU-utilization percentage.
- Startup, library loading and state serialization also appear in sampled
  stacks. The full capture does not isolate their steady-reading cost. The
  measured peak physical footprint is about 1191 MiB, consistent with the large
  in-memory text library, but no memory optimization was attempted here.

This provides no evidence of a comparable sustained foreground event-loop spin.
It does not establish a quiet-reading or foreground-audio baseline, nor rule out
other foreground optimization opportunities. No additional application changes
were made based on this mixed trace.

Evidence under `.tmp/energy-audit/`: `phone-foreground-launch.trace`,
`foreground-reading-toc.xml`, `foreground-summary.json`, and the exported
`foreground-*.xml` tables. Earlier unsuccessful captures remain clearly separate
from this successful one.
