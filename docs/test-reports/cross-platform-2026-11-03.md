# Cross Canon comparison — 3 November 2026

Search ranking and result data agree across the tested clients. The remaining gaps are in presentation and state handling: native desktop hides the initial results below unnecessary whitespace, native filters behave differently from web, and production web loses the search when returning from a result. Production Fathers Jump still ignores Escape.

[Open the side-by-side gallery](../screenshots/cross-platform-2026-11-03/comparison.html). It compares Bible and Fathers readers, searches, chapter/work pickers, and settings. [Desktop search board](../screenshots/cross-platform-2026-11-03/desktop-comparison.png) · [Mobile search board](../screenshots/cross-platform-2026-11-03/mobile-comparison.png).

**Scope and evidence.** Production web was exercised in responsive Chromium at 1000 × 900 and 390 × 844. Native desktop was rebuilt from the current working tree. The actual iPhone 16e Simulator app was rebuilt, installed, launched, and rendered using its existing fresh-state QA presets; these are Metal app captures, not desktop phone-size approximations. Its bitmap is 1170 × 2532, representing 390 × 844 points. Desktop app captures are 1003 × 886; the small window-size difference is preserved in the gallery. All native preview runs use non-persistent state. The baseline is commit `54ee9899c0c73f8043b9a6230675b13f3b29a0d3` plus existing working-tree changes. [Source hashes and capture dimensions](cross-platform-2026-11-03/baseline.json) distinguish this audit from the earlier November 1–2 reports.

The Mac remained locked. Hands-on desktop and Simulator input was unavailable, so native interaction findings below use event replays through the real egui renderer in an isolated source copy. They are distinguished from browser interaction and actual iOS rendering. This is not a physical iPhone, Safari, software-keyboard, VoiceOver, touch-feel, or background-audio certification. No app source was changed, device update installed, database/cache rebuilt, or production deployment performed.

**Confirmed findings, in suggested repair order.**

| Priority | Finding | Reproduction and consequence | Evidence |
| --- | --- | --- | --- |
| High | Native desktop search consumes the result area with whitespace | Submit the standard query at desktop width. The query field is followed by a large empty area, then the action row; no result reference appears in the initial viewport. Production web shows the first full passage and the next result. The renderer assertion fails with `Desktop first result reference visible before scrolling: false`. | [Native initial view](../screenshots/cross-platform-2026-11-03/native-desktop-search-form.png), [web initial view](../screenshots/cross-platform-2026-11-03/web-desktop-search.png), [replay log](cross-platform-2026-11-03/native-audit-repros.log). In `dialogs.rs`, the desktop action row uses `with_layout(Layout::left_to_right(Align::Center))`, consuming remaining vertical space. |
| Medium | Native “Clear all” changes the canon | Set Catholic, select Sirach and five matches, then click Clear all. Both clear the book and restore ten matches. Web retains Catholic; native changes to Protestant. The native control replay fails the web-parity assertion. Native resets the shared reader canon even when clearing Fathers filters. | [Browser observations](cross-platform-2026-11-03/browser-observations.json), [native replay](cross-platform-2026-11-03/native-audit-repros.log). |
| Medium | A hidden native book filter silently returns | Select Sirach in Catholic, choose Protestant, then return to Catholic. The Protestant request correctly excludes Sirach, but returning to Catholic silently reactivates it. Web prunes the selection when leaving its canon. This can unexpectedly narrow later searches. | Native replay prints `Catholic → Protestant → Catholic: ["Sirach"]`; `useSearchFilters.ts` prunes out-of-canon selections, while native retains them. [Replay log](cross-platform-2026-11-03/native-audit-repros.log). |
| Medium | Production web Back does not restore search results | Search, select the first passage, open Jump to, wait for Luke 16 to load, then press Back. The settled page is `/?index`, with zero search dialogs and zero results. Reopening Search was observed with an empty query and empty results. This interrupts comparing several matches. | [Settled navigation record](cross-platform-2026-11-03/back-navigation.json), [returned page](../screenshots/cross-platform-2026-11-03/web-back-from-result.png). |
| Low | Production Fathers Jump ignores Escape | Open the work picker and press Escape in Find work. The dialog stays open at both desktop and phone widths. Close works. Native dismissal regressions pass. | [Browser observations](cross-platform-2026-11-03/browser-observations.json). The current local `ChapterJump.tsx` already calls `useEscapeDismiss`; this production finding should be rechecked after releasing that existing change. |

The three native defects have executable, deliberately failing assertions. Run `python3 docs/test-reports/cross-platform-2026-11-03/run-native-audit.py` to copy the native sources into `/private/tmp` and replay them without editing the working implementation. The same harness passes online-error recovery and offline keyword/author/validation checks. [Audit assertions](cross-platform-2026-11-03/audit-native.rs).

**Styling and UX comparison.**

| Area | Production web | Native desktop / iOS | Assessment |
| --- | --- | --- | --- |
| Visual language | Warm paper, rust accents, serif passages, sans-serif controls | Same broad palette and typeface family | Recognizably the same product. |
| Desktop search composition | Textarea with actions to its right; results follow immediately | Full-width textarea; action row below, with excessive vertical allocation | Largest visual and usability gap; confirmed defect above. |
| Phone search composition | Fixed header; form and full results scroll together | Same overall model, including full passages | The superseded four-line previews are gone. The shared scrolling/full-text regression passes. |
| Initial phone result visibility | First result metadata begins around 558 CSS px in the measured state | Additional online/keyword mode row and iOS safe-area spacing move the first result farther down | Native offers useful offline capability, but the form still feels taller. Judge the form screenshots before the preview preset that scrolls directly to results. |
| Search body typography | Source Serif 4; responsive 17.6–21.44 px; line-height 1.62 | Semibold serif fixed at 18 points; line-height 1.62 | Mobile sizes are close. Native desktop results are smaller and fit more text per line. |
| Result metadata | Reference, translation/author, and strength can share a desktop row | Strength is always a separate row; metadata uses smaller 10.5–11 point labels | Native spends more vertical space on metadata. |
| Search terminology | Bible: Find passages. Fathers: Find chapters | Find passages for both; an extra Jump shortcut also appears in native Fathers search | Wording and form contents are not identical. |
| Result actions | Jump to; Similar passages; Similar in Fathers / Similar Bible passages | View in context; Similar passages; Find Fathers / Find Bible; Copy | Functions largely align, but labels differ. Native adds direct paragraph copy. OS clipboard contents were not certified. |
| Filters | Canon before Matches; separate dialog; native select/number controls | Matches before Canon; egui dropdown and drag-value control; nested lists | Same main capabilities, different interaction details. Phone numeric-keyboard editing was not exercised. |
| Filter badge | Counts selected books/authors and non-default match count | Also counts a non-Protestant canon for Bible | Catholic + Sirach + five matches yields different badge totals. This is a presentation discrepancy separate from the reset defects. |
| Canon transitions | Unsupported books are removed | Unsupported books are temporarily hidden | Functional discrepancy above; not merely cosmetic. |
| Bible Jump | Canon, Book, Chapter, Verse | Same sequence and verse granularity; native uses larger outlined cells | Native layout/navigation checks pass at 320, 393, and 1000 points. |
| Fathers work picker | Search, author, favorite works, chapters | Same concepts; long card titles truncate | The native picker now stays within phone bounds. Shared layout tests cover both corpora. |
| Settings | Compact popover; presets, themes, text, spacing, width | Similar controls plus canon, original-text and API settings | Native is more crowded and exposes implementation configuration. Four theme choices exist in both. Web Paper/Dark switching and settings dismissal were exercised. |
| Reader navigation | Shareable web routes; browser history | Same HTTPS reader-link format, native history and scheme adapters | Native history/link regressions pass. Web returning from a result loses search state as described above. |
| Offline search | No equivalent local keyword mode in the tested search UI | Entire bundled text library supports keyword searches | Native advantage; keyword and semantic matching intentionally differ. Similarity still requires the online index. |
| Native gestures | Browser scrolling in this audit | Real touch-event/coasting, touch-to-stop and nested-scroll regressions pass | These are behavior replays, not physical screen frame-pacing measurements. |

**Search results and functional checks.**

The existing live test invoked the actual native search adapter and compared it against production Remix forms. All eight scenarios matched every ranked indexed passage ID, result count, selected verse highlight, calibrated strength, and score within 0.0001. It covers Bible/Fathers themes, both same-corpus and cross-corpus similarity directions, Protestant/Catholic/Orthodox scope, Sirach/John/1 Esdras book filters, Clement/Augustine author filters, and five/ten matches. [Eight-case native adapter log](cross-platform-2026-11-03/live-search-parity.log).

Six additional live comparisons exercised the API contract used by native against the production web action. All passed:

| Search | Scope and count | Result / relevance spot check |
| --- | --- | --- |
| anxiety | John + Romans, 5 | Same ordered results; begins John 16:21–24, followed by John 20:12–15 and John 16:30–33. All stay within the selected books. |
| Hope after death | Orthodox, 40 | Same 40 unique passages. First five include Job 17:15–16, 1 Corinthians 15:19–24, Job 14:14–19, and two 2 Esdras passages. |
| God’s mercy, forgiveness & hope? | Catholic, 5 | Apostrophe and punctuation accepted. Same passages beginning Psalms 130:1–7, Psalms 103:8–13, and Micah 7:17–20. |
| Scripture source similarity | John + Romans, 40 | Same 40 ranked results, all within the two-book scope. |
| Scripture → Fathers similarity | Clement + Augustine + Tertullian, 40 | Same 40 ranked indexed paragraphs, all from the requested authors. |
| forgiving enemies | Same three Fathers authors, 5 | Same five results; first is The Enchiridion 74:1–3. |

The HTTP source for the added similarity cases is the first existing Scripture-cache passage, 1 Chronicles 1:1–11; the original eight-case adapter test separately uses Genesis and Clement. These are equivalence and scope tests, not a claim that every semantically relevant passage has been found. The relevance spot checks are qualitatively sensible. Match dots are calibrated absolute cosine bands, so the top-ranked result can still show one dot in both clients.

Nine API rejection cases pass: blank query, overlong query, zero limit, unknown book, unknown author, four authors, unknown source, simultaneous query/source, and an incompatible web/keyword request. Keyword no-match and case/whitespace normalization also pass. The completed expanded matrix is **17 passed, 0 failed**. Early harness assumptions about presentation-only `matchStrength` and book metadata were corrected to match the actual native contract; the final evidence contains the corrected verdicts. [Results](cross-platform-2026-11-03/search-matrix.json), [repeatable harness](cross-platform-2026-11-03/search-matrix.mjs), [initial run log](cross-platform-2026-11-03/search-matrix.log), [completed scoped rerun](cross-platform-2026-11-03/search-matrix-resume.log).

Browser interaction confirmed ten full Bible results for “More money More Problems,” beginning Luke 16:10–14; selection exposes context and similarity actions. Scripture → Fathers search completed with ten results, and clearing its source restored the theme input. Fathers theme search begins with Homilies on First Corinthians 15, followed by On the Duties of the Clergy 66. Filters support separate corpus scopes, a three-author limit, and five to forty matches. The fourth author becomes disabled. Search Escape works; the body scrolls while its header stays fixed. Rate-limit errors display remaining seconds, and searches recovered after the stated cooldown. Tests respect that cooldown rather than bypassing it.

Native online failure against an unreachable API produces an explicit error. Switching to local keywords successfully returns Genesis passages; an impossible keyword produces “No passages found.” Offline “Rome” filtered to Clement returns one passage. Queries outside the native 3–500 character range are rejected. These were exercised through the native app's asynchronous search path, not a substitute keyword implementation.

**Verification summary.**

| Check | Outcome |
| --- | --- |
| `VERIFY_PORT=13715 VERIFY_RUST_PORT=13716 npm run verify` | Pass: 97 web unit tests, typecheck, Rust API tests/release build, production web build, both reader search POSTs, resource/text/range-audio checks. [Log](cross-platform-2026-11-03/verify.log) |
| Existing native regression suite | 19 passed, 1 opt-in test ignored; live test then run separately and passed. Includes navigation, reader state, touch scrolling, nested lists, dismissal, and full search passages. [Log](cross-platform-2026-11-03/native-tests.log) |
| Audit-only native checks | 2 pass, 3 deliberately fail, reproducing the three native defects above. [Log](cross-platform-2026-11-03/native-audit-repros.log) |
| Actual iOS Simulator build/install/launch | Pass. Debug Simulator configuration; not physical-device performance evidence. [Build log](cross-platform-2026-11-03/ios-build.log) |
| Native desktop release build and screenshots | Pass. [Build log](cross-platform-2026-11-03/desktop-build.log), [capture harness](cross-platform-2026-11-03/capture-native.py) |

The full offline-download lifecycle, physical audio/interruption behavior, OS clipboard, real software-keyboard occlusion, Safari-specific behavior, and accessibility remain outside this pass. Rapid theme/dialog interactions occasionally appeared to move the web reader, but a minimized, settled retry preserved Luke 16; this is not counted as a confirmed defect. The resize-only retry also preserved the target passage. Fix the confirmed desktop layout and filter-state differences first, then retest native keyboard/touch behavior with the Mac unlocked and on the physical phone.
