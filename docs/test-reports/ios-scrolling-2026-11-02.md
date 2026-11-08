# iOS scrolling — 2026-11-02

The user reported clunky scrolling on the installed iPhone build.

## Reproduced causes

- The reader processed every Chapter and Passage of a Book every frame. A
  phone-width Psalms replay retained 601 text layouts. The regression command
  `scripts/rust.sh test --locked -p cross-canon-desktop phone_scroll_work_stays_bounded_on_long_books -- --nocapture`
  failed before the fix. An isolated host baseline measured 4.45 ms/frame.
- A replay of the native adapter's Touch/Pointer event sequence followed a drag
  but failed to coast after release. The adapter emits PointerGone at finger-up,
  clearing the velocity used by egui's built-in kinetic scrolling. The regression
  `phone_flick_coasts_and_touch_stops_it` failed before the touch fix.

## Changes

- Retain exact Chapter/Passage geometry and skip off-screen content, including
  its text layout and allocations. Read immutable library text by reference.
  Invalidate geometry on Book, width, font, line-height, scale, text version,
  theme or selection changes. Use stable Passage interaction IDs.
- Fix wrapping to the viewport width. Previously a wide child could expand a
  later paragraph's width by a point, changing its line count when earlier
  content was skipped. A distant Psalm jump now agrees with an uncached layout
  after width, font-size and text-version changes.
- Track touch release velocity separately from mouse input. Use exponential
  deceleration independent of refresh rate; stop immediately on a new touch.
  Do not treat a drag or a momentum-stopping tap as Passage selection. Ordinary
  taps still select Passages. Held releases, cancellation and secondary touches
  do not launch a stale flick. Explicit navigation cancels touch momentum.
- Build the physical phone update with Xcode's Release configuration, enabling
  Rust release optimization rather than installing the previous Debug build.

## Verification

- Native suite: 15 passed, one opt-in production search comparison ignored.
  Touch tests cover drag, release/coast, touch-to-stop, stopping-tap suppression,
  ordinary selection, held/cancelled gestures and 60/120 Hz distance consistency.
- Warm Psalms replay retains 18 text layouts after the fix. The isolated first
  run measured 0.25 ms/frame; the full-suite run measured 0.44 ms/frame under
  concurrent build load. These are host CPU measurements, not iPhone FPS claims.
- Distant-jump geometry matches after width/font/text changes at 320, 393 and
  700 point widths. Existing saved-focus, reader-link, tools, navigation, search
  and audio regressions pass.
- Native clippy with warnings denied, formatting and diff checks pass.
- `VERIFY_PORT=13015 VERIFY_RUST_PORT=13016 npm run verify` passes, including
  web search and unchanged local resource/audio routes.
- Signed ARM64 Release device build succeeds. Installation on the connected
  iPhone 14 Pro succeeds without removing application data. The initial launch
  attempt was denied because the phone was locked; unlock is required to open
  this updated build.
- Desktop and phone-size native preview artifacts were visually inspected:
  `docs/screenshots/ios-scroll-desktop-layout.png` and
  `docs/screenshots/ios-scroll-phone-layout.png`. These are macOS-rendered
  previews, not physical iPhone screenshots.

Touch replay verifies behavior through the real reader render path. Perceived
scrolling smoothness and on-device frame pacing still need hands-on assessment
on the phone; installation/launch alone cannot establish those results.
