# eframe 0.31.1: sleeping redraw scheduler backport

Pinned source: crates.io eframe 0.31.1, SHA256
`d0dfe0859f3fb1bc6424c57d41e10e9093fe938f426b691e42272c2f336d915c`.
Upstream tag: <https://github.com/emilk/egui/tree/0.31.1/crates/eframe>.
Retains the upstream MIT and Apache-2.0 licenses.

Cross Canon uses this local dependency to avoid a broad egui/wgpu upgrade while
backporting the sleeping event-loop policy from
<https://github.com/emilk/egui/pull/8398> (upstream commit `b42d2ef`).
The original report targets Wayland; our real iPhone trace showed the same
polling code burning roughly 85% of one CPU core during background audio.
The on-device before/after capture reduced app CPU from 84.68% to 0.175% of one
core while background audio continued. See
`docs/test-reports/native-background-audio-profile-2026-11-13.md` in the repo.

The scheduler changes are confined to `src/native/run.rs`: consume due redraw requests
without setting `ControlFlow::Poll`, and always select `Wait` when no future
deadline exists. `request_redraw` schedules presentation; background iOS windows
may withhold the corresponding event, so the loop must be able to sleep.
The actual scheduling policy is extracted into a function with regression tests
for a withheld redraw and multiple deadlines. No hidden-window rendering or
unrelated upstream refactors are included.

The iOS native text adapter additionally uses a small default `App::platform_output_hook`
in `src/epi.rs`, called by `src/native/epi_integration.rs` after egui completes its
layout passes. This exposes the final accessibility tree to the UIKit adapter;
other apps keep the default no-op. It neither requests repaint nor changes the
scheduler. Preserve this hook (or an upstream equivalent) when upgrading the
framework. The adapter keeps native accessibility elements stable by widget ID
and sends activation back through egui's accessibility actions.

Run the targeted framework tests from the repository root:

```sh
scripts/rust.sh test --locked -p eframe --lib --no-default-features \
  --features glow,default_fonts,persistence,x11,wayland,accesskit repaint_tests
```

`npm run test:native-repaint` runs these checks and verifies neither was silently
removed or filtered out. The Mac packager and iPhone Release build invoke that
guard before compiling the app; failures block those release paths.

Remove this copy and return to registry dependencies when upgrading to an egui
release containing the upstream fix, after repeating background audio profiling.
