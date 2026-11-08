# Native Jump, touch scrolling, and search icons — 2026-11-03

Compared the live production web app at 393 × 852 with the native phone layout, including both Scripture and Early Christian Jump dialogs. References and native previews are in `docs/screenshots/` (ignored by git).

| Area | Web reference and native behavior |
| --- | --- |
| Scripture Jump | Compact JUMP / Choose a passage header, Close, Canon, Book, Chapter grid, Verse grid. Chapter selection leaves Verse choices open. Verse selection opens the local passage. |
| Works Jump | Choose a work, Find work, Author, a bounded list of title/author cards with favorites, then chapter buttons. Chapter selection opens the local work. Long work titles truncate inside their card. |
| Dialog space | Header stays fixed; the body uses the space below it. Safe-area insets are honored on iOS. History moved to reader tools; Copy link remains on a selected passage. |
| Icons | Vector magnifier, filter sliders, Jump arrow, play/pause, Close, and favorite star avoid missing emoji/font glyphs. Search actions retain their text labels; icon-only controls have accessible labels. |
| Search modes | Search Index (Online) and Search Keywords remain explicit. Search and passage reading contracts are unchanged: keyword search and text/navigation are local; semantic matching can use the online index. |

## Reproduction and scrolling fix

The previous controller replaced its release velocity with the final finger-up displacement. Replaying a steady 1,200 point/second flick followed by a two-point finger-up movement produced only **19.78 points** of motion over the next 200 ms. The new regression initially failed:

```text
scripts/rust.sh test --locked -p cross-canon-desktop lifting_a_finger -- --nocapture
A 1200 pt/s flick must not brake to the tiny finger-up delta: coasted 19.7771 points
```

Release velocity now uses recent motion history, including coalesced events, rather than one final noisy sample. The same regression passes with more than 130 points of coast. Existing held-finger, cancellation, touch-to-stop, and 60/120 Hz distance checks pass.

Jump, work lists, Book/Author menus, settings, and filter lists now use touch-aware viewports too. Native PointerGone previously cleared egui's built-in release velocity. Nested viewports assign a gesture to the innermost starting area; popup menus prevent the containing modal from capturing that gesture. A replay through actual nested egui ScrollAreas verifies dragging and post-release coast while the other viewport remains stationary. Tapping to stop a moving search does not activate its buttons.

## Verification

- Native suite: **19 passed, 1 ignored** (online search comparison is opt-in).
- `scripts/rust.sh clippy --locked -p cross-canon-desktop --all-targets -- -D warnings`: passed.
- `scripts/rust.sh fmt --all` and `git diff --check`: passed.
- `npm run verify`: passed, including web and reader search POSTs, Rust resource routes, local text, and range audio checks. No cache/DB update or web deployment performed.
- Layout/navigation regression checks that chapter columns stay within the screen bounds and checks both corpora at 320, 393, and 1000 pixels wide. It verifies visible chapter controls, Scripture chapter selection, and immediate local work navigation.
- Release iPhone build succeeded; strict codesign verification passed and the provisioning profile authorizes the paired phone. Signed app: `/private/tmp/crosscanon-phone-jump-build/Build/Products/Release-iphoneos/Cross Canon.app`.
- Desktop package: `dist/Cross Canon Desktop.app` and ZIP, with local library validation.

## Limits and installation

Screenshots are native macOS renders at phone dimensions, alongside actual mobile web captures; they are not physical iPhone screenshots. Gesture replays verify motion behavior, not physical display frame pacing. Smoothness on the iPhone still needs confirmation after installing this update.

After the iPhone reconnected on 2026-11-03, installation of the verified Release build succeeded. CoreDevice launched `com.crosscanon.mobile` successfully. Existing app data was preserved. Physical scrolling feel still needs user confirmation.

## Preview files

- `../screenshots/mobile-web-jump-reference.png`
- `../screenshots/mobile-web-work-jump-reference.png`
- `../screenshots/native-mobile-jump-icons.png`
- `../screenshots/native-mobile-work-jump-icons.png`
- `../screenshots/native-mobile-search-icons.png`
- `../screenshots/native-mobile-reader-icons.png`
- `../screenshots/native-desktop-work-jump-icons.png`
