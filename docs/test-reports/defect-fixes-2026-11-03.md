# Cross-platform defect corrections — 3 November 2026

Corrected the five defects identified in the [comparison](cross-platform-2026-11-03.md). Changes are verified locally; production web and the physical iPhone have not been updated.

| Defect | Correction | Verification |
| --- | --- | --- |
| Desktop search pushes results below excessive whitespace | Bound the horizontal action row's height. The first full result now appears below the form in the initial desktop viewport. | The renderer regression fails before and passes after; [updated screenshot](../screenshots/correct-defects-2026-11-03/native-desktop-search.png). |
| Native Clear all resets the canon | Clear match/book/author filters while retaining the current canon. | Actual egui control replay retains Catholic after Clear all. |
| Native hidden book filters return after switching canons | Apply canon changes through one method that removes unsupported selected books. Search, Jump, and Settings use it. | Catholic → Protestant → Catholic no longer restores Sirach. |
| Web Back loses the search | Retain each reader's response, focused source, dialog state and body position by browser history entry. Bound the in-memory cache to sixteen entries per reader. Internal cross-corpus result links now use Remix navigation so the page and cache survive. | Browser journeys restore the original query and all ten ordered results, including repeated Forward/Back, at desktop and phone widths. No search resubmission is needed. |
| Fathers Jump ignores Escape | The working tree already contained the shared Escape-dismiss hook. Verified that existing correction in the current local web app. | Desktop and 390 × 844 browser interaction both dismiss the picker. The corrected code is included in the verified web build. |

The native filter badge also now follows the web count: selected books/authors plus a non-default match count; the canon itself is not counted.

The search-history cache is tab-local memory and clears on a full reload. It neither stores search history on the server nor changes search requests/ranking. Fresh responses drive result transitions; restoring an entry retains its remembered open/closed state. The cache waits for passage text readiness before restoring the search-body position. Browser automation must let scroll/navigation settle before clicking a context action; an initial replay clicked during animated scrolling and hit the backdrop instead. The corrected recipe checks the actual history behavior.

Evidence:

- Native regressions: [before](correct-defects-2026-11-03/native-before.log), [after](correct-defects-2026-11-03/native-after.log). Three defect assertions changed from failing to passing; offline recovery and keyword/validation checks continue to pass.
- Full native suite: **24 passed, 1 opt-in live comparison ignored**. [Log](correct-defects-2026-11-03/native-suite.log).
- Native clippy with warnings denied: passed. [Log](correct-defects-2026-11-03/clippy.log).
- `npm run verify`: passed, including **97 web unit tests**, typecheck, Rust API tests/release build, production web build, both reader search POSTs, and text/resource/range-audio checks. [Log](correct-defects-2026-11-03/verify.log).
- Desktop and phone browser history checks: [desktop](correct-defects-2026-11-03/history-desktop.json), [phone / production build](correct-defects-2026-11-03/history-mobile.json). [Reusable browser recipe](../../scripts/e2e-search-history.cua.mjs).
- Closing Search, switching to Fathers, and returning with Back also preserves the deliberately closed state. [Record](correct-defects-2026-11-03/history-closed.json).
- Updated desktop package and portable ZIP: `dist/Cross Canon Desktop.app` and `dist/Cross Canon Desktop.zip`; signature and complete bundled library validation pass. [Log](correct-defects-2026-11-03/desktop-package.log).
- Corrected iOS Simulator app builds, installs and launches. [Log](correct-defects-2026-11-03/ios-build.log). [Form preview](../screenshots/correct-defects-2026-11-03/ios-search.png), [results preview](../screenshots/correct-defects-2026-11-03/ios-search-results.png).
- Formatting, script syntax and diff checks pass. Temporary search-history tracing was removed.

Existing unrelated working-tree changes were retained. No database/cache update, scripture indexing, audio rebuild, production deployment or physical-phone installation was performed. The iOS previews are actual Simulator app framebuffers; physical keyboard, touch feel and device frame pacing are not certified by these checks.
