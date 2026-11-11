# Christian Classics iPhone release — 2026-11-11

- Signed Release build succeeded for physical iPhone, bundle `com.crosscanon.mobile`.
- Bundle includes 495 books / 315170 passages, including all four Classics.
  Existing text artifacts are packaged; no databases or recordings were rebuilt.
- All 30 native tests passed; four pre-existing live-network/performance tests
  remain explicitly ignored. Regressions cover three saved collection locations,
  Classics links, favorites, offline search, remote result mapping, touch modal
  dismissal and 320/393-point layouts.
- Simulator Release build passed. Collection chooser and offline Imitation of
  Christ reader were captured under `docs/screenshots/christian-classics/` as
  `native-collections-iphone.png` and `native-classics-reader-iphone.png`.
- Signed app installed successfully on the paired iPhone 14 Pro at 15:21 local
  time. Installation receipt: `.tmp/classics-ios-phone-install.json` and `.log`.
  No uninstall was performed. Automatic launch was denied because iOS was locked;
  physical-device interaction remains to be checked after unlocking.
- Signed archive: `dist/ios/christian-classics/Cross Canon.ipa`. Archive contents
  were extracted to a temporary directory and their code signature verified.
  This is a development-signed device build, not an App Store/TestFlight upload.

The first hosted API build is already deployed and verified. A follow-up source
snapshot containing these final mobile UI changes and a workflow trigger
refinement was blocked by automatic approval review: publishing new source to
the public GitHub branch requires explicit approval. Those changes remain local.
Do not retry publication through an alternate route without resolving approval.
