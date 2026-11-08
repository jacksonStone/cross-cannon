# Chapter heading follows passive reading — 2026-11-02

The user reported that scrolling into another Chapter left the reader heading
unchanged. The native replay reproduced this on a phone-width viewport: saved
Reader Location reached Genesis 2 while the toolbar still displayed Genesis 1.

`remember_location` updated the saved Passage but left `active_chapter_id` tied
to the most recent explicit navigation. It now derives the active Chapter from
the remembered Passage's metadata. The reader requests a repaint when the
Chapter changes because the toolbar is drawn before the body; this also updates
the heading when a drag/flick ends exactly at a Chapter boundary.

The fix uses Passage/Chapter IDs as the source of truth. It does not infer
Chapter numbers from scroll offsets, create navigation history, or trigger a
scroll target when the heading changes. Toolbar audio actions now receive the
Chapter currently being read as well.

Regression command:

```sh
scripts/rust.sh test --locked -p cross-canon-desktop chapter_heading_follows_visible_passages_when_scrolling_both_directions -- --nocapture
```

Before the fix it failed: “expected Genesis 2 at width 393, active chapter
Genesis:1.” After the fix it passes forward and backward across actual
boundaries in Genesis and First Clement, at 393- and 1000-point widths. It
checks the text painted inside the toolbar, not chapter labels in the body,
and verifies that passive reading does not add history or initiate navigation.

Static Chapter 2 previews are under `docs/screenshots/chapter-heading-{phone,desktop}.png`.
These are native host renders opened at Chapter 2; the replay above establishes
the scrolling behavior. They are not physical iPhone screenshots.

The native suite passes (16 tests, one opt-in production comparison ignored),
as do clippy with warnings denied, formatting, diff checks and `npm run verify`.
The local desktop application and portable ZIP were rebuilt and signature/library
checks pass. The development-signed ARM64 Release iPhone build also succeeds.

After the user reconnected the iPhone 14 Pro, the signed Release update was
successfully installed and launched on 2026-11-02. Installation preserved the
existing application data. The chapter-heading behavior is covered by the
rendered scrolling replay above; physical installation/launch is a separate check.
