# Henry Read work crash — 2026-11-12

The catalog navigation test stopped after the Read action changed Reader
Location. It never rendered the newly opened Work. The following frame laid out
every chapter of Henry, retaining 127,359 text galleys at once. The deterministic
host reproduction peaked at 4,354,064,384 resident bytes (8,147,108,160 peak memory
footprint). This strongly supports iOS memory termination; the phone's actual
termination report has not yet been retrieved because Xcode reports it unavailable.

Reproduction command (first run red, before the fix):

```sh
scripts/rust.sh test --locked --release -p cross-canon-desktop --lib reading_henry_from_catalog_bounds_first_frame_text_layout -- --nocapture
```

First-frame text layout fell from about 3 seconds / 127,359 galleys to about
7–8 ms / 432 galleys. The same isolated host memory probe then peaked at
764,477,440 resident bytes. These numbers include loading the full source-artifact
library in the test process; they are not measurements of the physical iPhone.
Probe logs: `.tmp/henry-reader-memory-before.log`,
`.tmp/henry-reader-memory-after.log`.

The native reader now starts with the requested chapter and adjacent chapters.
It adds chapters near the viewport edges and retains the existing measured
geometry cache for off-screen chapters. Jumps and reflow reset the chapter window
around the saved Passage. Prepending compensates by the exact measured chapter
height and discards the temporary displaced layout pass. A pending location update
then records the actual visible Passage after compensation.

Regression coverage drives the actual catalog Read action through the first
reader frame, then opens Proverbs 16 and the final Henry chapter at phone and
landscape widths and restores saved Reader Location. A second real-Henry test
checks exact prepend compensation, stable subsequent offset, correct visible
chapter identity, and appending without moving the viewport.

Preventing recurrence: catalog navigation checks must render the destination,
and large Works must be included alongside the shorter Fathers fixtures. The
reader remains the shared seam for catalog opens, Reader Links, saved locations,
and search result navigation.

## Final verification

- Native suite: 43 passed, four existing live/performance checks ignored. Existing
  mock-server tests require socket access and pass outside the filesystem sandbox.
- Signed device Release and Simulator Release builds succeeded. Original app and
  extracted IPA signatures verified with the Mac's signing trust store.
- Installed the fix into Simulator and opened Henry Genesis 1 through the actual
  iOS reader. Process remained alive; screenshot visually verified at
  `docs/screenshots/henry-reader-fix/henry-genesis-phone.png`.
- Signed update: `dist/ios/henry-reader-fix/Cross Canon.ipa` (60,255,596 bytes).
  Device build: `/private/tmp/crosscanon-henry-device-build/Build/Products/Release-iphoneos/Cross Canon.app`.
- Installed the signed update on the connected iPhone 14 Pro and launched Henry
  Genesis 1. Its process (21733) remained alive in the subsequent device check.
  Receipts: `.tmp/henry-phone-install.json`, `.tmp/henry-phone-launch.json`,
  `.tmp/henry-phone-processes.json`.
