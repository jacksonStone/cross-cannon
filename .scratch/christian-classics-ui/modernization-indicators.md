# Native modernization indicators checkpoint

- Shared Work reader: compare original and modernized paragraph tokens using the web reader's LCS matching and preserve exact displayed text.
- Cache changed ranges only for paragraphs near the viewport, bounded to avoid library-wide diff work.
- Original mode and Scripture remain unmarked; background tint does not change text metrics.
- Focused Rust regression tests and parent-owned simulator/device verification follow implementation.
- Implemented in `rust/desktop/src/reader.rs`; changed words use a 7% ink tint (10% in dark mode). The cache holds at most 256 paragraphs and is reset with reader layout changes.
- Focused `scripts/rust.sh test -p cross-canon-desktop modernization_tests --lib` passed (3 tests). Simulator and device checks remain parent-owned.
- Availability regression now checks modernized Imitation chapter 1 and unmodernized Matthew Henry chapter 1; the focused availability test passed.
- Punctuation-only tokens intentionally produce no indicator, following the requested preference; unlike the web helper's fallback, a newly inserted standalone punctuation token is not marked.
- Declared Rust static library, packaged native library, and scripture manifest outputs in the always-running iOS Xcode script phase so incremental builds can track generated resources. Project plist lint passed; parent owns Xcode and signature verification.
- Refined marks to match the web's warm accent at 7% (10% dark), painting rounded font-height word boxes behind the galley instead of full line-height backgrounds. Four focused modernization tests pass, including Unicode/newline mapping and exclusion of added leading; simulator/device visual review remains parent-owned.
- Replaced translucent renderer blending with an opaque sRGB paper/accent mixture: Paper RGB 243/236/232, Dark 45/39/35. Five focused modernization tests pass, including these colors.
