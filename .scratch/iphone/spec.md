# Cross Canon for iPhone

The user requested a mobile version of the native Rust app, with iPhone first.
Reuse the Rust-rendered reader and shared Rust library, existing local texts,
embeddings and audio timestamps. Bundle all reading texts and keep offline
reading, navigation, keyword search and reader settings independent of a server.
Semantic/similar search uses the existing production Rust API; recordings use
the existing URLs and offsets. Do not rebuild any data artifacts or change the
production server.

Provide a native iPhone application target and reproducible simulator/device
build instructions. Adapt reader controls, navigation, dialogs and typography
for phone widths and touch. Respect the device safe area and retain focused
passage persistence. Preserve desktop behavior and styling.

Build and run in the iPhone simulator when Xcode setup permits; validate bundled
artifacts and Rust behavior locally regardless. Report any simulator/device
signing or Apple setup requirements explicitly. App Store/TestFlight publication
is outside this request; do not claim device installation without verification.
