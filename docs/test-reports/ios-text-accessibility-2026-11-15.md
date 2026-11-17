# iOS text accessibility and UI review — November 15, 2026

This records the device/simulator checks and their limits. Historical screenshot
paths identify the original ignored captures; superseded previews were removed
during repository cleanup. Regenerate current UIKit previews with
`bash scripts/test-ios-accessibility.sh`.

## Follow-up: commentary unexpectedly opens the keyboard

Reproduced with the simulator software keyboard enabled after selecting native
reader text and opening commentaries. The commentary dialog requests no IME.
When its UITextView resigned first responder, UIKit promoted the enclosing
winit UIKeyInput rendering view to first responder and opened the keyboard.
egui's IME state was already disabled, so its normal transition-based keyboard
handling did not undo this native promotion.

The reader-to-dialog handoff now releases that inherited host responder.
An actual editor can still request the host through the normal IME path.
The UIKit probe now uses a UIKeyInput-capable host matching winit, rather than
a plain UIView. Its new regression failed before the fix and passes afterward;
intentional editor responder focus survives accessibility updates.

Verification: the full UIKit probe and all six focused Rust reader tests passed.
The real commentary render also asserts that it requests no IME. Logs:
`.tmp/ios-accessibility/commentary-keyboard-before.log`,
`commentary-keyboard-final.log`, and `commentary-reader-tests.log`.

The Release simulator app was replayed with the software keyboard enabled:
native word selection → View commentaries has no keyboard; Passage notes still
opens its keyboard; closing notes and reopening commentaries has no keyboard.
Screenshot: `docs/screenshots/ios-text-accessibility/commentary-no-keyboard.png`.
Both simulator and signed device Release builds passed their repaint gates;
the device app also passed strict deep signature verification. Build logs:
`commentary-simulator-build.log` and `commentary-device-build.log` in the same
local log directory.

The iPhone reading flow now uses native selectable UIKit text, preserving the
existing Source Serif typography and shared canonical Passage state. System
text selection supplies Copy, Look Up, Translate and Share; speech actions
follow the device's accessibility settings. UIFontMetrics applies system
Larger Text and Bold Text before the app's own reading-size adjustment.

VoiceOver receives native reading content, visible-line geometry and passage
actions. Shared library, navigation, search and study dialogs expose their
visible controls through a UIKit accessibility bridge. Only the active dialog
or nested filter scope is exposed; stable element identity retains focus
through ordinary redraws. Settings use a native sheet.

## Verification

The full native library suite passed: **80 passed, zero failed, five opt-in
tests ignored**. The run had local loopback access for existing HTTP transport
tests. Log: `.tmp/ios-accessibility/native-tests.log`.

After the final source-preview correction, all six focused reader/accessibility
regressions passed again, including the new long-source test. Log:
`.tmp/ios-accessibility/final-reader-tests.log`. This adds one passing regression
to the earlier full-suite result.

The isolated UIKit app compiles the real adapter and tests Unicode Copy,
selection retained when passage controls appear, canonical jumps, passage and
viewport retention through typography changes and chapter-window growth and
pruning, largest system accessibility text, native settings controls, dark
sheet appearance, speech content and line geometry, keyboard occlusion,
stable dialog elements, action dispatch, scroll targeting, automatic next/previous
page turns, selection release and focus-trap release. It uses fixture passages
and no account or database data.

Run `bash scripts/test-ios-accessibility.sh`. Log:
`.tmp/ios-accessibility/probe-run.log`. Fixture previews are
`docs/screenshots/ios-text-accessibility/native-*.png`.

Additional regressions exercise every shared dialog at 320-point width,
390-point width with a 310-point keyboard, and 844 × 390 landscape; modal
scope isolation; a real commentary-author picker; result activation through
egui's accessibility input; aligned result actions; and bounded chapter
loading in both directions. Both Release builds run the existing redraw
scheduler regression gate. The adapter also passes Objective-C syntax checks
with the production iOS 15 deployment target.

## Hands-on simulator pass

The review uses the full Release app on an iPhone 16e / iOS 26.3 simulator,
with the existing offline library of 495 works and 315,170 passages.

| Area | Checks |
| --- | --- |
| Reader | Scripture, Classics and Fathers; long work names; chapter jumps; modern/original toggle; native long-press selection, Copy and system menu; passage footer and non-Scripture copy menu |
| Library | Collection tabs; title search and clear; filters; empty Favorites and recovery; edition metadata; continue reading; Read this work |
| Jump | Work search; author picker; chapter grid; explicit chapter navigation; outside dismissal |
| Search | Similar-passage request; target collections; author filters and clear-all; Done; results; result selection; View in context |
| Commentary | Scripture source; author picker; changing author; View in context; close and return |
| Study | Direct note action; formatting toolbar; Write/Preview; saving a guest test note; rendered bold; highlight colors; editor and Save above the software keyboard |
| Audio | Play; verified Pause state; pause and return to Play; download library and individual-book expansion; full-library size and opt-in controls |
| Account | Guest sheet; sign-in affordance; outside dismissal; return to reader |
| Settings | All steppers; all four presets and exact saved values; WEB/MSB selection; all four themes; all three canons; connection dialog and Cancel |

No Google sign-in, bulk recording download, production deployment, database
refresh or index rebuild was performed. Study edits were confined to the
simulator's guest test state. Account transport, study deletion and download
pause/resume/failure behavior remain covered by the native suite.

## Corrections found during the pass

- Native selection menus needed the view controller's responder chain and
  restoration after passage-footer layout; the working menu preserves system
  suggested actions.
- Note-editor viewports now account for the actual software keyboard.
- Library search fields reserve their inner margins, retaining clear controls
  inside the dialog.
- Commentary author controls have explicit labels and close after selection.
- Search-result headings stack cleanly on phones; result actions use aligned
  two-column, 44-point rows. Result text has an accessible passage action.
  Long source previews are bounded without changing the complete search input.
- Note-formatting and highlight controls have usable touch targets and
  descriptive/selected accessibility state.
- Native settings steppers have measured bounds. Every selectable row is
  exposed as a button with its selected state. Dark appearance updates both
  the sheet and navigation controller.
- Long reader titles use multiline height measured before the first layout,
  keeping the title below the status area. Chapter captions use caption line
  height rather than body leading.
- Accessibility focus waits for native-menu dismissal; scrolling routes to
  the focused control's viewport even without a preceding touch.
- Automatic VoiceOver reading handles next/previous page requests. Closing
  passage actions releases native selection so chapter loading can continue.
- Application-managed status-bar appearance follows the reader's theme.

## Physical-device release checks

Simulator speech-content and accessibility-action tests do not certify a
person's complete spoken VoiceOver experience. A physical-device reading
check remains necessary, as does the README's ninety-second unplugged,
locked-screen audio/energy check after a framework integration change. That
check includes returning to the reader and investigating sustained CPU above
5% of one core, against the previously measured 0.175% baseline.

The signed Release iPhone artifact is prepared at
`/private/tmp/crosscanon-ios-accessibility-device-20261115/Build/Products/Release-iphoneos/Cross Canon.app`.
Its build log is `.tmp/ios-accessibility-device.log`; the simulator log is
`.tmp/ios-accessibility-build.log`. The generated signed bundle is outside the
synced Desktop directory because Finder metadata there prevented code signing.
The first signed build was installed on the paired iPhone 14 Pro at 11:07 local
time using the existing bundle ID, without uninstalling. Launch succeeded and
process 34844 remained running in the subsequent device query. Receipts:
`.tmp/ios-accessibility/device-install.json`, `device-launch.json` and
`device-processes.json`. No new physical energy capture was obtained; physical
spoken VoiceOver and unplugged background-audio checks remain pending.

## Follow-up: missing tap highlight

The user reported that tapping a Passage no longer visibly highlighted it.
The native view received the selected Passage ID and opened its actions, but
only saved study marks were drawn. Temporary Passage selection had no drawing
path. This was a visual regression missed by the initial checks, which verified
selection state and native word selection without asserting Passage tint.

The isolated real-adapter regression failed with
`FAIL: Tapping a passage must visibly highlight its text even without native word selection`.
The fix updates background attributes only for the previous and newly selected
Passages, retaining native word selection and restoring saved study colors when
selection moves or clears. Reflow reapplies the current selection. The full
UIKit regression now passes, including this failure case, moving selection,
clearing it, exact saved-mark restoration and the existing Unicode/reflow checks.
Log: `.tmp/ios-accessibility/tap-highlight-probe.log`. Fixture image:
Tapped Passage (`docs/screenshots/ios-text-accessibility/native-tapped-passage.png`).
Release build logs: `.tmp/ios-accessibility/tap-highlight-simulator-build.log`
and `.tmp/ios-accessibility/tap-highlight-device-build.log`.

The full Release simulator app was checked with a single real tap: the Passage
received visible tint, and a second tap removed it and closed its action row.
Actual app screenshot (`docs/screenshots/ios-text-accessibility/final-tap-highlight.png`).
The corrected signed build was installed over the existing app on the paired
iPhone at 11:12 local time and launched successfully. Receipts:
`.tmp/ios-accessibility/tap-highlight-install.json` and
`.tmp/ios-accessibility/tap-highlight-launch.json`.

## Follow-up: one control row and chapter responsiveness

The user's Acts screenshot showed the five Passage actions above a separate
library-button row. All six buttons now share a single 44-point bottom row,
with the reference above. Native regression checks cover their shared vertical
center and nonoverlapping 44-point targets at 320-point width. When a Passage
is selected, Classics' Mod/Orig choice moves into Reader tools → Reading text;
the segmented control returns when selection clears.

The delayed header reproduced in the real adapter: scrolling into John 3 left
the header at John 2 until a Rust render callback. Each native paragraph now
carries its canonical chapter title, allowing the header and accessibility
label to update synchronously during scrolling while the shared Reader Location
update is queued. A regression asserts the new title before any Rust callback.
Entering the last loaded chapter also requests prefetch immediately, rather
than waiting until the document's final viewport.

TextKit now retains unchanged chapter text and layout while the chapter window
grows. It replaces only entering/leaving edges, with full replacement retained
for changed text or typography. Matched append operations on the same existing
Acts text in the simulator measured 14.97–25.56 ms for full replacement and
3.37–7.94 ms with reuse. Pruning the leading chapter still measured 22.88–24.16 ms;
there is no claim that pruning or physical-phone frame timing improved by the
same amount. Measurements include JSON delivery and native update work.

The extended UIKit suite passed, retaining its Unicode Copy, selection,
saved highlights, viewport anchoring, typography, chapter growth/pruning,
reading-content and dialog checks. Evidence:
`.tmp/ios-accessibility/reader-responsiveness-probe.log` (red header check),
`responsiveness-header-fix.log` and `responsiveness-after.log` (green).
The optional real-text fixture is `.tmp/ios-accessibility/acts-performance.json`;
run with `IOS_READER_PERF_INPUT` pointing at that file. This fixture is extracted
from the existing immutable Scripture Cache, with no database/cache rebuild.
The probe bundle now builds under `/private/tmp` to prevent synced-folder
metadata from intermittently breaking signing.

The user clarified that the delay was several seconds and might follow Passage
selection. A separate native-selection replay reproduced an actual load blocker:
`scrollViewDidScroll` returned early while native words were selected, suppressing
the next-chapter request. That guard is removed. The incremental path retains
the live word range instead of clearing/reapplying it unnecessarily, and the
regression scrolls across a chapter with selection active, requires immediate
header/prefetch, then delivers the next chapter and checks the exact selected
Unicode words. It passes. Logs: `.tmp/ios-accessibility/selected-chapter-before.log`
(red) and `selected-chapter-after.log` (green). This addresses a blocked request
separately from the smaller measured text-layout cost.

The first attempted installation of these controls/responsiveness changes failed
because CoreDevice reported the paired iPhone unavailable (error 1011). The
failure receipt is `.tmp/ios-accessibility/reader-controls-install.json`. The
11:12 tap-highlight build remained the last confirmed phone installation at
that point; a successful follow-up receipt is required before reporting these
new changes installed.

The full-app scroll pass exposed a second chapter-identity delay: the next
chapter heading was already near the top of the reading area, but the title
waited for its first body paragraph to reach the top. The native reader now
reports that chapter's canonical first Passage when its heading enters the
top quarter of the viewport. Header and shared Reader Location update together
in that scroll callback. This also triggers prefetch at the same boundary.
The exact heading-visible/body-below-top assertion failed before the change
and passed after it, including selected-Passage and selected-word cases.
Evidence: `.tmp/ios-accessibility/chapter-heading-boundary-before.log` and
`chapter-heading-boundary-after.log`. The final UIKit run also retained the
single-row, selection, reflow and chapter-window checks; real Acts append
updates measured 2.97–6.76 ms with layout reuse, and sliding-window updates
22.72–24.10 ms in this simulator run.

The final full-app Release build was checked with a Passage selected while
scrolling from First Clement 1 into 2. The title and accessibility chapter
changed to 2 with the chapter heading in the top reading quarter, while its
first body paragraph was still below it. The next text was already rendered;
the selected Passage tint and six buttons remained present on one row.
Both simulator and signed device builds passed, including the native redraw
scheduler gate. The signed device bundle passed strict codesign verification.
Logs: `.tmp/ios-accessibility/reader-boundary-simulator-build.log` and
`reader-boundary-device-build.log`.

After the user reconnected the phone, the final boundary/selection/single-row
build installed successfully at 11:45 local time and launched on the paired
iPhone 14 Pro. A subsequent process query confirmed the same launched PID
35313 was running. Receipts: `.tmp/ios-accessibility/reader-boundary-install.json`,
`reader-boundary-launch.json`, and `reader-boundary-processes.json`. This
supersedes the unavailable-device attempt and the earlier 11:12 installation.
Hands-on physical-phone scroll timing, spoken VoiceOver and unplugged audio
energy certification remain separate from the simulator checks above.

Actual full-app screenshots, separate from the fixture previews:

- Chapter boundary with selected Passage and one-row actions (`docs/screenshots/ios-text-accessibility/final-chapter-boundary.png`)
- Six actions in one row (`docs/screenshots/ios-text-accessibility/final-single-row.png`)
- Long work title and reader (`docs/screenshots/ios-text-accessibility/final-long-title.png`)
- Landscape with passage actions (`docs/screenshots/ios-text-accessibility/final-landscape.png`)
- Dark settings (`docs/screenshots/ios-text-accessibility/final-dark-settings.png`)
- Bounded source preview and search controls (`docs/screenshots/ios-text-accessibility/final-search.png`)

Speak Selection was enabled in the simulator; its Speak menu action was present
and activated. Look Up opened the system sheet and returned to the same Passage;
dictionary content remained loading, so no dictionary-result claim is made.
Simulator rotation and the app's settings were exercised in both orientations.
Paper, WEB, Protestant and Default reading preferences were restored. The system
preferred-size increase used during inspection was also restored. The isolated
fixture separately exercises the largest accessibility size.

The reading-content implementation follows Apple's
[UIAccessibilityReadingContent protocol](https://developer.apple.com/documentation/uikit/uiaccessibilityreadingcontent)
and its [automatic page-turn contract](https://developer.apple.com/documentation/uikit/uiaccessibilitytraits/causespageturn).

## Follow-up: Speak Screen starts in the preceding Classics chapter

The user confirmed this is iOS Speak Screen / Read & Speak, rather than the
app's recorded-audio command or selected-text Speak. The native reading-content
adapter exposed page content for the viewport but numbered its lines from the
beginning of the entire TextKit chapter window. As a result, asking for reading
line zero returned the cached preceding chapter even after jumping to the next
chapter. The prior speech test only required nonempty content and a shorter
page string, so it missed the mismatch.

Both point-to-line lookup and line content/geometry now enumerate the same
visible glyph range as page content. Line zero and line iteration are relative
to that displayed page, and iteration stops at its boundary. The loaded text,
chapter window, passage selection, typography and layout remain unchanged.

The real UIKit probe now uses a Christian Classics model with distinct chapter
headings, subtitles and prose. It requires speech to start in displayed chapter
2 rather than cached chapter 1, checks attributed/plain agreement, onscreen
line geometry and point lookup, then selects older text and scrolls to chapter
3. Speech must follow chapter 3 and exclude the offscreen prior chapter.
`bash scripts/test-ios-accessibility.sh` failed before the fix and passed after
it, alongside all existing selection, button-row, scrolling and reflow checks.
Logs: `.tmp/ios-accessibility/classics-speech-before.log` and
`classics-speech-after.log`. Temporary diagnostics were removed.

The simulator's Spoken Content settings expose Speak Selection only; the Speak
Screen controller is unavailable there. The adapter's returned speech content
and geometry are verified; audible Speak Screen behavior on the physical phone
still requires confirmation. Apple's protocol describes these methods as
access to content on the displayed page:
[UIAccessibilityReadingContent](https://developer.apple.com/documentation/uikit/uiaccessibilityreadingcontent).

Both Release targets built successfully, including the native redraw scheduler
gate; the device bundle passed strict codesign verification. The full simulator
app reopened the saved Matthew Henry Classics location with normal reading
layout (screenshot (`docs/screenshots/ios-text-accessibility/final-classics-speech-reader.png`)).
Build logs: `.tmp/ios-accessibility/classics-speech-simulator-build.log` and
`classics-speech-device-build.log`.

The follow-up bundle installed on the paired iPhone 14 Pro at 11:54 local time
(`.tmp/ios-accessibility/classics-speech-install.json`). The initial launch
attempt was denied because the device was locked; the failure is recorded in
`classics-speech-launch.json`. Installation succeeded independently of that
launch failure.
The 11:56 retry was also denied as Locked (`classics-speech-launch-retry.json`).
The user can open the installed update after unlocking and restart Speak Screen;
there is no successful launch or audible-output verification for this follow-up
yet.

## Follow-up: original icons and native-selection copying

The user preferred the earlier reader icons and requested removal of redundant
copy buttons. UIKit now renders the original vector paths from `icons.rs` for
highlight, note, commentary, similarity and close, and the earlier vertical-dot
tools and collection controls from the shared reader. The original rounded
borders on the tools and collection controls are restored. Buttons retain their
44-point targets, accessibility names, theme tint and single-row arrangement.

The non-Scripture copy-only More menu is removed, leaving highlight, note,
similarity and close alongside the collection control. Scripture retains its
commentary button. The iOS search-result actions also omit Copy; the desktop
actions are unchanged. Native selected-text Copy, Look Up, Translate and Speak
remain available through the system menu.

The real UIKit suite passed, including exact Unicode Copy through the native
text view, speech page identity, chapter loading, selection retention, reflow
and the 320-point single-row check. All six focused Rust accessibility/dialog
tests also passed. Logs: `.tmp/ios-accessibility/original-icons-probe.log` and
`original-icons-rust-tests.log`.

Both Release builds and the native redraw scheduler gate passed; the signed
device bundle passed strict codesign verification. The actual full app showed
the restored icons and five visible Classics controls (highlight, note,
similarity, close, collection) in one row, with no copy-only More button.
Full-app screenshot (`docs/screenshots/ios-text-accessibility/final-original-icons-classics.png`).
Logs: `.tmp/ios-accessibility/original-icons-simulator-build.log` and
`original-icons-device-build.log`.

The update installed on the paired iPhone 14 Pro at 14:21 local time
(`.tmp/ios-accessibility/original-icons-install.json`). Automatic launch was
denied because the phone was locked (`original-icons-launch.json`); the update
is installed and can be opened after unlocking. No successful physical launch
is claimed for this build.

After the user unlocked the phone, launch succeeded at 14:30 local time. A
subsequent process query confirmed PID 35553 was running. Receipts:
`.tmp/ios-accessibility/original-icons-launch-unlocked.json` and
`original-icons-processes-unlocked.json`.

The user then clarified that the books icon for switching collections was an
improvement. The final control keeps `books.vertical` for that action while
retaining the earlier custom passage icons, vertical-dot tools control and
selection-only Copy. The UIKit suite passed again with that adjustment
(`.tmp/ios-accessibility/books-icon-probe.log`).

The final books-icon Release targets built and passed strict codesign
verification. The native-only proposed source was also exported over HEAD into
an isolated temporary checkout, including its required native prerequisites,
and `cargo check --locked --offline --target aarch64-apple-ios` passed there.
No uncommitted web source was included. Evidence:
`.tmp/ios-accessibility/native-clean-checkout-check.log`,
`books-release-simulator-build.log`, and `books-release-device-build.log`.
Final controls (`docs/screenshots/ios-text-accessibility/final-books-icon-release.png`).

The final books-icon build installed at 14:36 local time
(`.tmp/ios-accessibility/books-release-install.json`). The phone had locked
again by launch time, so that launch was denied as Locked
(`books-release-launch.json`). The preceding original-icon build was verified
running after unlock, but this final books-icon launch is not yet verified.

The books-icon release subsequently launched at 14:39 local time. A process
query confirmed PID 35650 remained running. Receipts:
`.tmp/ios-accessibility/books-release-launch-retry.json` and
`books-release-processes.json`. This supersedes the locked launch attempt.
The separately staged native-prerequisite tree also passed an isolated iOS
compile (`native-prerequisite-check.log`).

## Follow-up: give more of the iPhone screen to reading

The user's Imitation of Christ screenshot showed a large two-line title and a
permanent bottom row for Mod/Orig and the collection control. The header now
uses an 18-point base title, at most two measured lines, with compact spacing.
The Imitation of Christ fits the 44-point header at normal text size. Books and
Reader tools sit beside the title, retaining 44-point touch targets. Long titles
remain available in their full accessibility labels and the chapter chooser.

The bottom row is absent while reading normally. Modernized/Original choices
are always available under Reader tools → Reading text. Selecting a Passage
reveals its single-row actions; status/error messages remain visible when
present. The text view extends to the bottom safe area otherwise. Extra text
container padding is reduced from 20/70 points to 8/16, with the existing body
font size, line spacing, reading width and Larger Text scaling preserved.

The real UIKit suite passed from an isolated checkout, including the updated
long-title, 320-point action-row, selection, chapter and speech checks. It now
requires the unselected reading viewport to use at least 88% of safe-area height
and checks that Mod/Orig remain available without a bottom switch. The test
runner also creates its output directory on a fresh checkout. Evidence:
`.tmp/ios-accessibility/compact-reading-clean-probe.log`.

The full-app compact layout was inspected in The Imitation of Christ 2. Its
title fits one header row, the books control and tools remain reachable, and
the reading text continues to the bottom safe area. Reader tools → Reading
text exposed both Modernized and Original choices. Selecting a Passage showed
its four controls in one bottom row. Previews:
reading (`docs/screenshots/ios-text-accessibility/final-compact-reading.png`) and
passage actions (`docs/screenshots/ios-text-accessibility/final-compact-passage-actions.png`).

The landscape pass caught a delayed model overwriting the native chapter title
with the preceding chapter. A real-adapter regression reproduced this by
delivering an older chapter model after scrolling. Native layout now suppresses
intermediate scroll reports while resizing/reflowing. Once stable, the visible
canonical Passage reconciles the title and shared Reader Location. An older
model receives the current location again; acknowledgement stops further
events. The regression failed before the fix and the full UIKit suite passed
afterwards, including an acknowledgement/no-redraw-loop assertion. Evidence:
`.tmp/ios-accessibility/stale-chapter-before.log` and `stale-chapter-after.log`.

The final Release builds passed, including the redraw scheduler gate, and the
device bundle passed strict codesign verification. The full-app replay opened
Imitation 2, selected a Passage, rotated to landscape and returned to portrait;
the chapter title remained 2 throughout. Clearing selection restored the full
bottom reading area, and scrolling continued in chapter 2. The simulator was
returned to portrait. Evidence: `reader-release-simulator-build.log`,
`reader-release-device-build.log`, and
final landscape (`docs/screenshots/ios-text-accessibility/final-compact-landscape.png`).

This final compact/rotation-corrected build installed and launched on the paired
iPhone 14 Pro at 15:01 local time. A subsequent process query confirmed the
launched app remained running. Receipts:
`.tmp/ios-accessibility/reader-release-install.json`, `reader-release-launch.json`
and `reader-release-processes.json`. These supersede the earlier books-icon
build and its launch receipts. Audible Speak Screen output, physical scrolling
timing and unplugged audio energy remain separate from the automated and
simulator verification recorded here.
