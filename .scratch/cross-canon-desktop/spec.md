# Cross Canon Desktop and R Cross Cannon

User request: rewrite Cross Canon as a native Rust desktop application, match the
existing visuals and compare the running applications beside each other. The user
confirmed Rust-rendered native UI, without a webview.

- Product: Cross Canon Desktop. Bundle local copies of every existing Scripture
  and Early Christian text. Reading must not request texts from a server.
- Service: R Cross Cannon, a Rust API mounted at `https://crosscanon.com/r/api`.
- Reuse existing scripture caches, chapter assets, embedding databases, and audio
  timestamp/alignment manifests byte for byte. Do not regenerate them.
- Preserve the existing web app and unrelated working changes.
- Persist focused passage IDs; hide verse numbers except on selected passages.
- Match paper/sepia/dark/contrast themes, serif reading typography, narrow centered
  column, quiet chapter boundaries, reader controls, jump, and passage selection.
- Desktop supports local keyword search. Theme/similar semantic search uses the Rust
  API; only query embeddings may call OpenAI, using the indexed model/dimensions.
- Package and document a runnable macOS app, shared Rust core, API, isolated service,
  deployment/proxy integration, meaningful offline/API tests, and real screenshots.
