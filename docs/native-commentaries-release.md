# Native verse commentaries — 2026-11-12

Scripture selections in both native apps show exactly **Similar passages** and
**View commentaries**. Commentary lookup matches book, chapter, and overlapping
verse ranges from the bundled source index. It requires no online search.

## Builds and installation

- macOS Release bundle rebuilt and signed at `dist/Cross Canon Desktop.app`;
  portable archive: `dist/Cross Canon Desktop.zip`.
- iOS simulator Release build passed and was installed on the booted iPhone 16e
  simulator. Native screenshots verified both verse actions and the commentary
  view, with the search API deliberately pointed at an unreachable loopback port.
- Signed iPhone Release build passed using the existing development team.
  App: `/private/tmp/crosscanon-commentaries-device-build/Build/Products/Release-iphoneos/Cross Canon.app`.
- Installed successfully on the paired iPhone 14 Pro, preserving the existing
  bundle identifier and app data. Receipt:
  `.tmp/verse-commentaries-phone-install.json`, sequence 3648.
- Signed device archive: `dist/ios/verse-commentaries/Cross Canon.ipa`.
  Its extracted code signature was verified with the Apple trust store available.
- The physical iPhone was locked, so automatic launch was denied after successful
  installation. Open the app after unlocking. The Mac was also locked; the older
  running desktop instance must be quit and reopened to load the rebuilt app.

## Verification

The six native catalog tests passed against each actual packaged library using
`CROSS_CANON_TEST_LIBRARY`: desktop bundle and signed iPhone bundle. They cover
the two-action phone/desktop UI, offline lookup, exact book/chapter matching,
inclusive verse overlaps, absent coverage, and bundled paragraph indexes.
Both libraries contain all 495 books / 315170 passages. The source catalog
packaging tests passed as well; no databases or source artifacts were regenerated.

Native previews are under `docs/screenshots/verse-commentaries/`:
`native-{desktop,ios}-{actions,commentaries}.png`.
