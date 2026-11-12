# Christian Classics modernization checkpoint

User: “Do it. And use Terra to conserve on tokens. Update as you go so that you don’t get stuck if tokens run out.”

## Authorized next slice

The preceding proposal was a single chapter of The Imitation of Christ for
style review before processing the whole work. Start with chapter
`classics:imitation:book-1.1` (20 numbered source segments). Do not silently
modernize all commentaries before the user has seen the sample.

## Active work

- Terra agent `modernize_classics_sample`: exact-original batch, second editorial
  review, readable preview under `.scratch/christian-classics-modernization/`.
- Terra agent `classics_modernization_support`: reuse existing Fathers assembler
  with explicit chapter scope, durable reviewed overlay, immutable Classics
  republishing, and native Original/Modernized availability.
- Parent: integrate reviewed sample, validate originals and hashes, run appropriate
  checks, prepare phone review if feasible. Save this checkpoint after each stage.

## Constraints and known state

- Preserve existing unrelated/earlier Christian Classics web changes.
- No API spending, embedding regeneration, database maintenance, or audio work.
- Never change bytes behind an existing content-hashed chapter URL.
- Keep originals and passage IDs; reviewed modernizations are optional overlays.
- The phone update preceding this task installed and launched at 15:29 local time.
- GitHub source publication is still blocked by automatic approval review pending
  explicit approval of public source disclosure. Do not retry a push indirectly.
- Last healthy hosted API binary: snapshot 23453943665168c476abe55c7c6b97ea28072217;
  production release 20261111T211317Z-eb6738c8. No new API binary needed just to
  prepare a local/mobile modernization sample.

## Applied sample

- Terra drafted and reviewed all 20 source segments; final review issues: none.
- Exact-original validated overlay saved at
  `data/public-domain/christian-classics/modernization/imitation-book-1-chapter-1.json`.
- Local publisher created `classics_imitation_book-1.1.aa28565706426e72.json`.
- New Classics manifest version: `65f302fc3670d9d2`.
- Previous asset `...2534332b93554daa.json` hash is unchanged. Original texts,
  notes, source metadata and passage identities verified unchanged.
- Audit: `.scratch/christian-classics-modernization/audit-book-1-chapter-1.md`.
- Next: verify, signed native build, simulator check, phone sample install.

## Verification and device update

- `npm run verify` passed, including typecheck, Rust integration tests, release
  builds and web/search/resource smoke checks.
- Native library tests: 31 passed, 4 existing live/performance tests ignored.
- Overlay/immutable-asset fixture tests: 3 passed.
- Signed physical iPhone and simulator Release builds succeeded.
- Sample app installed successfully on paired iPhone 14 Pro at 15:46 local time;
  receipt `.tmp/classics-modernized-phone-install.json`.
- Signed app remains at
  `/private/tmp/crosscanon-classics-modernized-device-build/Build/Products/Release-iphoneos/Cross Canon.app`.
- Only Book 1 Chapter 1 is modernized. Next action after style feedback: continue
  Imitation in explicit reviewed chapter batches, saving overlay and checkpoint
  after each batch. Remaining works have not been modernized.
- No production deploy, DB changes, embedding regeneration or GitHub source push.

## Expanded authorization / resume

User then requested subtle native indicators matching the web app and explicitly
said “And do the other chapters”, followed by “K pick it back up” after a usage
limit interrupted the Terra agents. Full remaining Imitation is now authorized;
no further sample-style approval gate is needed.

- Terra `native_modernized_marks`: bounded visible-paragraph web-equivalent word
  diff marks (Original unmarked), checkpoint modernization-indicators.md.
- Terra `imitation_books_1_2_4`: Book1 chapters2–25, Book2 all12, Book4 all18.
- Terra `imitation_book_3`: all59 Book3 chapters.
- Writers save per-chapter drafts/reviews/audits and validate durable overlays.
  Parent owns focused publication and device builds. Book1chapter1alreadydone.
- On initial resumed audit, 1 of 114 chapters had validated overlay; two agents
  had failed due to usage limit before more content was saved.

## Current resumed implementation / allocation

- Subtle changed-word tint implemented in native shared Work reader; bounded
  near-viewport cache (256 paragraph entries), no indicators in Original mode.
- `npm run verify` passed and native tests: 34 passed / 4 pre-existing ignored.
- Simulator screenshot `docs/screenshots/christian-classics/native-modernized-word-marks-iphone.png`
  shows the faint word marks, matching modernized reading without layout shifts.
- First device-install retry failed because paired iPhone is unavailable. Do not
  claim the marks were installed. Finish content/build and retry if reachable.
- Content allocation rebalanced: books-1-2 writer owns Book1ch2–25 + allBook2;
  book-3 writer owns Book3ch1–40; native_modernized_marks agent now owns Book3ch41–59
  + allBook4 under `book-3-tail-and-4/` scratch checkpoint.
- 38 validated chapters published locally at version `007ec3638174ea7a`; later
  completed overlays remain durable awaiting next focused publication. Canonical
  live counts are in `.scratch/christian-classics-modernization/PROGRESS.json`;
  regenerate with `python3 .scratch/christian-classics-modernization/check-progress.py`.

## All chapters completed

- All 114 chapters / 2357 segments have validated reviewed overlays.
- Final generated Classics version: `7250461ea13fa85e`.
- Original text, segment identities, source metadata/notes and numbered citation
  markers preserved. Final pronoun/obsolete-verb scan passed.
- Independent sample review: 12 Book3 segments, no concrete issues found;
  exact keys in independent-quality-review.md (not a full-book independent review).
- Final signed device/simulator builds and post-publication verification running;
  logs `.tmp/imitation-complete-*`. iPhone still unavailable at last check.

## Final build issue detected and being fixed

Completed content verification passed; simulator opens Book4Chapter18. Device
Xcode incremental build skipped CodeSign after its untracked script replaced
library/native-library.bin, so explicit signature validation correctly rejected
the app. Do not install or archive that unsigned resource state. Terra is adding
script output dependencies in the Xcode project; parent will refresh the /tmp
project mirror, rebuild and verify the signature before release.

## Ready for installation

- Corrected Xcode incremental build re-signed the changed native-library resource;
  strict code signature verification passed on the rebuilt device app.
- Complete app is ready at the signed /private/tmp path; saved IPA under
  `dist/ios/christian-classics/Cross Canon.ipa`.
- Phone remains unavailable, so installation of all chapters/indicators is pending.
- Canonical current summary: `.scratch/christian-classics-modernization/CHECKPOINT.md`.

## Phone deployment completed

Connected iPhone update installed and launched successfully at 19:17 local time.
Receipts: `.tmp/imitation-complete-phone-install.json` and launch counterpart.
All 114 chapters and changed-word indicators are now on the phone.
