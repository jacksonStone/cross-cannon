# Native catalog parity — 2026-11-12

User confirmed the native iPhone app is the target. The web has a separate Remix
catalog UI; native previously offered three collection buttons that navigated
immediately. Title/author discovery was inside Jump, with a 12/24-work cutoff.
The native API adapter also discarded the complete Classics excerpt and rebuilt
the old sentence fragment from local text.

## Implemented

- Library stays open while browsing Bible / Fathers / Classics. It preserves the
  current Reader Location until a work or Continue reading is selected.
- Immediate title/author/type/tradition lookup; every matching work is available.
  Query words can appear in any order. Clear search, counts and empty states.
- Favorites, original work/author labels, Classics genre filters, chapter counts,
  saved-place resume, and a suggested starting work for an unvisited Collection.
- Edition view includes tradition, date, translator where supplied, edition,
  rights and the source link. It can open the work directly.
- Jump also searches title or author and no longer truncates matches.
- Native Classics results preserve the server's complete paragraph and exact
  Scripture reference. Packaged offline results use source paragraph boundaries
  and verse coverage while retaining local modernized text, original passage IDs,
  source IDs, scores and links. Older bundles retain honest chapter labels.
- New offline catalog contains 414 Work editions and all 2,580 Classics chapters
  in 4.34 MiB, without copying passage text or embeddings. It supplements the
  existing binary library; no binary format or database migration. Both iOS and
  desktop packaging include this metadata through the shared builder.

## Verification and installation

- Native suite: 41 passed, four pre-existing live-download/performance tests
  ignored. New checks cover keyboard input and 320/393/1000-point layouts,
  browsing without changing Reader Location, author/genre/favorites filtering,
  uncapped results, and the exact Proverbs 16 screenshot paragraph offline.
- `python3 scripts/test-native-catalog.py`: two passed, including full real-source
  catalog coverage and metadata-only packaging.
- Simulator Release and signed physical-device Release builds succeeded.
- Simulator interaction confirmed Classics browsing, typing Henry to get one
  result, favoriting/filtering it, readable edition/source details, and opening
  the selected Henry work. Preview artifacts: `docs/screenshots/native-catalog/`.
- Signed app installed on the connected iPhone 14 Pro with the existing
  `com.crosscanon.mobile` identifier, preserving app data. Launch succeeded.
  Receipts: `.tmp/catalog-phone-install.json`, `.tmp/catalog-phone-launch.json`.
- Portable development-signed archive: `dist/ios/native-catalog/Cross Canon.ipa`.
  Extracted the IPA into a clean temporary directory and verified its code
  signature, bundled metadata coverage, and absence of resource-fork entries.
- Logs: `.tmp/catalog-simulator-build.log`, `.tmp/catalog-device-build.log`.

## Earlier web/API shipment in this task

- Hosted Rust source snapshot: `1684d40e780d31b648dcdf2479e0a8bdb2ace020`.
- Healthy API release: `20261112T132750Z-0d837acf`.
- Web release: `20261112T133725-f6b25570d1`.
- `npm run ship` and production verification passed. The first web attempt stopped
  before activation because a regression needed excluded raw XML. That source
  check now remains local while production checks all 1,189 shipped Henry assets.
- Production Classics manifest matches local; recovered Isaiah/Malachi metadata
  and the exact screenshot's corrected Proverbs 16:1 source were verified live.
- These subsequent native UX changes were built locally and installed on the
  phone; no second server release or database update was required.
