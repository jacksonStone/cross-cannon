# Modernization checkpoint — installed on phone

## Completed

- The Imitation of Christ: ALL 114 chapters / 2,357 source segments modernized
  with Terra and reviewed per chapter. Original text, verse IDs, source notes,
  metadata and numbered citation markers preserved.
- 114 validated overlays saved under
  `data/public-domain/christian-classics/modernization/`.
- Final generated Classics version: `7250461ea13fa85e`.
- Native shared Work reader marks changed words with a subtle tint. Original
  mode is unmarked. Differences are cached for visible/nearby paragraphs.
- `npm run verify` passed; native tests 34 passed / 4 pre-existing ignored;
  overlay/immutable-asset tests 3 passed. Final chapter opened in simulator.
- An independent 12-passage Book3 sample review found no concrete issues; this
  does not claim a full-book independent review.
- Xcode incremental-signing issue fixed by declaring generated script outputs.
  Rebuilt device app passes strict signature validation.

## Phone state / next action

The complete updated app was installed and launched successfully on the connected
iPhone at 19:17 local time. All 114 modernized chapters and subtle word indicators
are now included. Receipts: `.tmp/imitation-complete-phone-install.json` and
`.tmp/imitation-complete-phone-launch.json`. No uninstall was performed.

- Signed ready app:
  `/private/tmp/crosscanon-classics-modernized-device-build/Build/Products/Release-iphoneos/Cross Canon.app`.
- Saved archive: `dist/ios/christian-classics/Cross Canon.ipa` (verify/extracted
  code-signature checked). App path also `.tmp/imitation-complete-ios-app-path.txt`.
- Device: `99122BBA-02E4-5298-A0B8-157B763D96A9` (iPhone 14 Pro).
- Set `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` for xcrun.
- When reachable, use `xcrun devicectl device install app --device <id> <signed app>`
  and launch `com.crosscanon.mobile`. Preserve app data; never uninstall.
- If /tmp app was removed, extract the IPA to /private/tmp and verify its signature
  before installation. It is a development-signed build, not OTA/TestFlight.

## Durable records

- `PROGRESS.json`: validated coverage and published asset count.
- `check-progress.py`: read-only coverage/original validation command.
- Chapter drafts/reviews/audits: `books-1-2-4/`, `book-3/`,
  `book-3-tail-and-4/`; Book4tail is in `book-3/book4tail/`.
- Sample chapter1 batch/review/audit and side-by-side preview remain at root.
- `independent-quality-review.md`: exact spot-check keys.
- Implementation/recovery details: `../christian-classics-ui/modernization-plan.md`
  and `modernization-indicators.md` in that directory.

No production deploy, database/index regeneration, audio work or GitHub source
publication was performed. Earlier public-source push approval restriction is
still unresolved; do not retry through an alternate publication route.

## Latest installed visual refinement

At 19:40 local time, installed and launched the refined mobile app:
- Aa copies the web's preset/theme-swatch/labeled full-width-slider layout;
  native-only options are collapsed under More, no oversized title/header.
- Modernized word marks use rounded font-height boxes and an opaque sRGB
  paper/accent composite matching web's 7% warm tint (10% in dark mode).
- 38 native tests passed, 4 pre-existing ignored; npm run verify passed.
- Receipts `.tmp/web-aa-parity-phone-install.json` and launch counterpart.
- Updated signed IPA saved at the same dist path. No production/GitHub push.
