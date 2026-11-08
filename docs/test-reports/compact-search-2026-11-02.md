# Compact native search — 2026-11-02

This iteration is superseded by the user's direction to follow mobile web.
See [the mobile web alignment](mobile-web-search-ux-2026-11-02.md): the form now
scrolls with full passages, and the abbreviated previews have been removed.

The user could see only part of one search result because the query area and
controls used too much of the iPhone display.

- Phone search uses a single-line query field, tighter form spacing and a
  nearly full-height dialog inside UIKit's safe areas. Desktop uses a two-line
  query field. Both retain the explicit online-index/keyword mode labels.
- Phone results show four-line previews. Tap the text or “Read full passage” to
  reveal the full passage and existing context/similarity/copy actions. Full
  passage text and search ranking are unchanged. Desktop results remain expanded.
- Similar-passage source text is compact on phones; filters scroll within their
  remaining space. The query supports keyboard submission and dismisses focus
  when submitted.
- Search results have their own scrolling region, keeping controls visible.
  It uses the remaining screen height, including on short landscape displays.

The existing native search layout test failed before the fix with only 245
points of result space on a 320 × 850 display. After the fix it checks at least
55% of the viewport for results and multiple visible entries at 320/393 widths
on 700/850-height displays. It also checks landscape and desktop, stable controls
during scrolling, and clicking “Read full passage” to expand a result.

The native suite, clippy with warnings denied, formatting and diff checks pass.
The repository's `npm run verify` passes using isolated ports 13015/13016.
The signed ARM64 iPhone Release build succeeds. Native host screenshots were
visually inspected at `docs/screenshots/ios-search-compact-phone.png` and
`docs/screenshots/ios-search-desktop.png`; the phone image is a macOS layout
preview, not a physical iPhone capture.

The Release update was installed on the connected iPhone 14 Pro, preserving
application data. The local desktop app and portable ZIP under `dist/` were
rebuilt, signed and verified against the complete bundled text library.
The phone was locked, so iOS denied automatic launch; opening the installed
update requires unlocking the phone.
