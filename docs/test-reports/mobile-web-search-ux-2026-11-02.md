# Native search aligned with mobile web — 2026-11-02

The user identified the mobile web app as the correct UX reference. This
supersedes the preceding compact-search iteration.

## Reference observed

Inspected `https://www.crosscanon.com` at 393 × 852 using its actual reader
toolbar, search submission and Filters dialog. Used the query “More money More
Problems” and compared the same native results.

- “Find passages” and Close stay fixed while the body scrolls.
- The Jump control, Bible/Fathers target dial, query and actions scroll away
  with the results. The form does not permanently reserve result space.
- Passages display in full. Tapping reveals context and similarity actions;
  it does not expand abbreviated text.
- Filters open in a separate dialog with Close, Clear all and Done.
- References/translation and match strength precede readable serif text, with
  subtle left rules and separators instead of boxed preview cards.

Saved references under `docs/screenshots/mobile-web-search-{results,filters}-reference.png`.
The implementation sources `SearchForm.tsx`, `SearchResults.tsx`, `FilterModal.tsx`
and the mobile CSS were checked against the live behavior.

## Native changes

- A single search-body scroll area contains form and full results; the header
  stays above it. Removed the separate fixed-form/result-pane arrangement and
  the four-line previews/“Read full passage” action.
- Uses the shared touch velocity/deceleration controller so iOS can flick the
  entire search body and touch to stop it, without selecting a passage.
- Uses a multiline sans-serif query, Jump shortcut, Bible/Fathers target dial
  and full-width phone actions. Preserves the explicitly requested online-index
  versus local-keyword labels and all search request/filter behavior.
- Filters use a separate modal and preserve the search body's scroll position.
- Full passages use the web's 1.62 text line-height, compact uppercase metadata,
  painted match dots, separators and a left match-strength rule. Passage taps
  reveal the existing context, same/cross-corpus similarity and copy actions.

## Verification

`search_matches_mobile_web_scrolling_and_full_passages` exercises real render
frames at 320/393-point phone widths, 700/850-point heights, landscape and desktop.
It verifies the shared large viewport, fixed header, form moving out of view,
unabridged text, unchanged text geometry after selection, separate filter footer
and preserved search position on filter dismissal.

Native host preview artifacts:

- `docs/screenshots/native-mobile-web-search-form.png`
- `docs/screenshots/native-mobile-web-search-results.png`
- `docs/screenshots/native-mobile-web-search-desktop.png`

These previews are rendered by the native macOS host, not captured from the
physical phone. Device installation and launch are recorded separately from
the automated rendering and touch checks.

The native suite passes (15 tests, one opt-in production comparison ignored).
Clippy with warnings denied, formatting, diff checks and `npm run verify` pass.
The development-signed ARM64 iPhone Release build succeeds. The shared desktop
app and portable ZIP were rebuilt, signed and validated against all 491 Books
and 150,073 Passages in the existing local artifacts.
The signed Release update was successfully installed on the connected iPhone
14 Pro, preserving its application data.
Automatic launch was denied because the phone was locked; unlock is required
to open the installed update.
