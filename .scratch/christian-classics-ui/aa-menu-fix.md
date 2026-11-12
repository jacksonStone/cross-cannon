# Aa menu diagnosis

Scope: Native settings dialog on phone; preserve existing settings and outside-tap dismissal. Baseline simulator screenshot pending. Building a deterministic egui rendering check before diagnosing.

Initial harness: `scripts/rust.sh test -p cross-canon-desktop phone_settings_content_fits_viewport -- --nocapture` passed. This bounds-only check did not reproduce the reported visual problem and is not yet a valid regression test. Awaiting simulator baseline to identify the exact symptom.

Baseline simulator shows invisible slider rails, crowded unframed themes, and a 3+1 preset wrap. The actual egui test now fails deterministically at 320: preset coordinates put three labels on the first row and one on the second. Hypotheses shared with parent: intrinsic-width wrapping, low-contrast inactive slider fill, and unframed intrinsic-width themes respectively.

The baseline failure confirmed intrinsic wrapped button widths caused the 3+1 layout. Egui's slider implementation paints the rail with inactive widget fill, which the app theme sets equal to the panel; a local contrasting fill addresses this. The settings menu now uses equal-sized theme/preset buttons, scoped contrasting slider rails, and viewport-based scroll height. `scripts/rust.sh test -p cross-canon-desktop phone_settings_content_fits_viewport -- --nocapture` passes at 320 and 393, after failing on the 3+1 baseline. Simulator screenshot/touch verification is pending from parent.

Follow-up: simulator showed the viewport ending halfway through Line spacing. The 393×852 test with 59/34 safe-area insets reproduced the clipping; filling the settings scroll viewport fixed it. User then requested web parity, so the menu now follows the web order and styling: compact preset buttons, four split-color theme swatches, and full-width labeled sliders, with native extras in More. The body cap keeps the outer panel approximately 498 points. `scripts/rust.sh test -p cross-canon-desktop phone_settings_ -- --nocapture` passes both the 320/393 layout test and the safe-area test, including all three visible rails. Final simulator screenshot is pending from parent.

Final validation: web-style menu screenshot saved as `docs/screenshots/christian-classics/native-web-style-aa-menu-iphone.png`; all Text/Spacing/Width controls visible. `npm run verify` passed and 38 native tests passed (4 pre-existing ignored). Device build passes strict code signature verification. Actual web reference styles measured from ReaderSettingsPanel; native-only preferences remain under More.

Installed and launched on the connected iPhone at 19:40 local time. Receipts:
`.tmp/web-aa-parity-phone-install.json` and `.tmp/web-aa-parity-phone-launch.json`.
The regression loop now covers the actual phone safe area, visible rails,
web-style control order and outside dismissal. No temporary debug logging remains.
