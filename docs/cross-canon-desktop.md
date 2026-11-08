# Cross Canon Desktop and R Cross Cannon

Cross Canon Desktop is a Rust-rendered desktop reader using egui/eframe, without a
webview, JavaScript runtime, or local HTTP server. R Cross Cannon is an Axum Rust
service mounted at `https://www.crosscanon.com/r/api` (the bare domain redirects
through the existing site configuration).

The [iPhone target](cross-canon-iphone.md) shares this Rust reader and local
library. Its separate Xcode launcher uses Metal while desktop retains OpenGL.

## Run and build

Install Rust 1.88 or newer, then run from this repository:

```sh
scripts/rust.sh run -p cross-canon-desktop
scripts/rust.sh run --release -p r-cross-cannon
scripts/package-desktop.sh
```

The `.app` is generated at `dist/Cross Canon Desktop.app` for the host Mac
architecture, with a portable signed copy in `dist/Cross Canon Desktop.zip`.
Extract the ZIP outside any synced Desktop folder and open it with Finder. Its complete text library lives inside
`Contents/Resources/library`; it does not depend on this checkout, a database,
or a server to read or search keywords. The packager tests library resolution
from `/tmp`. This is a locally signed development app; distribution signing,
notarization, installers, and Windows/Linux packaging are not part of this build.

`scripts/rust.sh` uses the isolated toolchain in `.tmp/` when present and otherwise
uses the normal installed `cargo`. `Cargo.lock` pins the dependencies.

Desktop controls: the upper-right three-dot button opens a floating tools
popover with audio, search, `Aa`, and Jump. Its dots are drawn directly, avoiding
missing font glyphs. Opening or closing tools preserves the title width and
reader position; long titles wrap within a header sized to their actual height. Command-F opens search; Command-J opens jump. Clicking a paragraph reveals
its reference, copy, and similar-passage actions. Click outside a dialog or press
Escape to dismiss it. The lower-right corpus button switches between Scripture
and Early Christian works. Reader settings persist the focused passage, canon,
theme, font size, spacing, column width, and original/modernized text preference.
Scripture defaults to the Protestant canon; all 81 books remain bundled.

## Existing data, unchanged

The shared Rust core reads these existing artifacts directly:

- `scripture-cache/manifest.json` and its versioned passage JSON (8,360 passages).
- `public/church-fathers-preview/books.json` and all referenced chapter JSON
  (410 works, 12,956 chapters, 141,713 reader paragraphs).
- `public/continuous-audio.json` and the three existing Early Christian audio
  alignment manifests. URL, start, and end offsets remain the playback contract.
- The API opens `storage/crosscannon.db` and
  `storage/early-christian-works.db` **read-only**, reusing 21,316 stored Scripture
  paragraph and Early Christian chapter vectors and their embedding config.

Packaging prepares the same losslessly compressed native text/timestamp library
as iOS, preserving every Book, Passage and alignment. It never runs indexers,
cache builders, transcription, alignment, or media builders. Neither databases
nor recordings are packaged into the desktop app. Fonts are bundled under their
included open-source licenses.

Offline: all reading, navigation, settings, and keyword search. Online: semantic
queries, similar passage requests, and playback of recordings not already downloaded
through **Aa → Offline audio** or present in a local developer library.
Semantic responses contain only passage IDs and ranking
metadata; desktop display text always comes from the local library.

Search defaults to **Search Index (Online)**, using the same refined API contract
as the web readers. **Search Keywords** runs entirely against the bundled library.
The mode and corpus choices, query/source, and submit controls remain above a
separate scrolling result list. Filters include canon, Scripture books, up to
three Early Christian authors, and 5–40 matches (default 10). Result cards retain
full local passage text, web verse highlights and calibrated match strengths,
context navigation, copy, and both similarity targets. Early Christian results
resolve the exact indexed paragraph to its local reading range; subsequent
similarity requests preserve the indexed paragraph ID.

On macOS and iOS, native audio uses a thin AVPlayer adapter for progressive/range
loading, retained recordings across aligned chapters, original Scripture recording
fallback, continuous chapter following, and system play/pause/seek/next controls.
iOS also handles interruptions and headphone disconnection and declares background
audio support. Physical-device lock-screen/interruption behavior still needs a
device pass. Other desktop targets retain the Rodio backend. Every backend uses
the existing recording URLs and alignment offsets; no audio artifacts are rebuilt.
Text selection uses paragraph copy.

The reader now restores a separate focused Passage for Bible and Fathers. Jump
includes individual Scripture verses, Fathers author filters and persistent work
favorites. Back/Forward are available in Jump and with Alt-Left/Alt-Right.
Copy reader links use the same HTTPS URLs as the web app; paste one into Jump to
open it locally. The `crosscanon://reader/<passage-id>` and
`crosscanon://church-fathers?chapter=...&passage=...` schemes open the native apps.
HTTPS universal-link association is not configured; HTTPS links remain shareable
web links. The lower-left Mod/Orig control switches Fathers wording directly.

## API contract

```sh
curl http://127.0.0.1:3006/r/api/health
curl http://127.0.0.1:3006/r/api/books
curl http://127.0.0.1:3006/r/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"fear and comfort","mode":"keyword","corpus":"scripture","canon":"protestant","limit":10}'
```

`POST /r/api/search` accepts:

| Field | Meaning |
| --- | --- |
| `query` | Theme or keyword text, at most 2,000 characters |
| `sourceId` | Existing local passage ID for similar passages, instead of query |
| `mode` | `keyword` (default) or `semantic`; sourceId always uses stored vectors |
| `corpus` | `scripture`, `early-christian`, or omitted for both |
| `canon` | `protestant` (default), `catholic`, or `orthodox` |
| `books` | Optional list of existing book/work IDs |
| `authors` | Up to three existing Early Christian author names (semantic search) |
| `web` | `true` returns the existing web reader contracts; requires one semantic target corpus |
| `limit` | 1–100, default 10 |

Results: `{ mode, elapsedMs, results: [{ id, chapterId, reference, corpus, score }] }`.
Scores are cosine similarities for semantic mode and local lexical scores for
keyword mode, not comparable across modes. No generated commentary is returned.

The API normalizes existing float32 vectors in memory and scores them in
parallel with Rayon. It does not replace or rebuild persisted ANN indexes.
Cross-corpus semantic requests require identical model/dimensions in both DBs.
Only *new query* embeddings call OpenAI using that indexed model/configuration.
Similar passage search needs no OpenAI call. A missing key returns an explicit
503 for theme search. Requests are limited to 16 KiB, four concurrent searches,
and 30 paid query embeddings per minute globally. This is an initial shared
budget; it is not an account/authentication system.

Both web readers now send theme and similar-passage searches through the
loopback Rust API, including both cross-corpus directions. Remix still validates
forms and applies canon/book/author filters and match-strength presentation.
`web: true` selects Scripture verse highlights and the best existing Early
Christian paragraph per chapter, with exact selected-source metadata. These
paragraph and verse vectors are read from the existing databases; they are not
regenerated. The native reader now requests this same refined contract. API clients omitting
`web: true` retain the compact ID/score contract.
Successful web search data responses include `X-Cross-Canon-Search: rust`.
Catalog loaders fall back to the existing text artifacts during API outages,
allowing readers to open while search reports an explicit service error.

All non-React resource handlers also run in Rust under `/r/api/resources/`:
Scripture cache JSON/gzip, Early Christian metadata/alignment and Chapter JSON,
and original/continuous audio. The production Go reverse proxy sends `/r/api`
directly to loopback port 3006 and rewrites existing browser resource URLs into
the Rust resource namespace. Node is bypassed. Raw compressed bytes, range
headers, content lengths and cache headers are preserved. Rust streams files in 64 KiB
chunks instead of loading recordings into memory. Cache headers and ETags remain
intact. The localhost-only service-worker test wrapper is also generated in Rust
and remains unavailable on the public host. Resource responses carry
`X-Cross-Canon-Resource: rust`; direct edge responses also carry
`X-Cross-Canon-Upstream: rust`.

`scripts/serve-web.mjs` retains resource forwarding before static middleware for
local development and direct port-3005 compatibility. These shims are unused by
the production API/resource edge routes. React page rendering, page
loader/action orchestration and static build assets remain in Remix/Node.
Production starts `build/server/serve.mjs`; the compiled-build release installs
a systemd drop-in and rolls it back with the server bundle if smoke tests fail.
Start Rust before running browser journeys that download text/audio.
`npm run verify` starts and stops both servers automatically.

Environment:

```text
CROSS_CANON_DATA_DIR=/path/to/existing/artifacts/root
R_CROSS_CANNON_BIND=127.0.0.1:3006
R_CROSS_CANNON_SCRIPTURE_DB=/path/to/existing/crosscannon.db
R_CROSS_CANNON_FATHERS_DB=/path/to/existing/early-christian-works.db
OPENAI_API_KEY=                         # server only
R_CROSS_CANNON_URL=https://www.crosscanon.com/r/api  # desktop override
R_CROSS_CANNON_ORIGIN=http://127.0.0.1:3006         # web bridge, loopback only
```

## Deployment

```sh
scripts/deploy-rust-api.sh
npm run ship
```

The first command packages only Rust source and Cargo manifests/lockfile. It
builds an isolated Linux release on the existing host, smoke-tests it against
existing production artifacts on a temporary port, then switches the
`r-cross-cannon` systemd service. The service reads the web app's existing
artifacts and storage. It runs on loopback port 3006 with a read-only filesystem
sandbox. No databases, recordings, or secrets are uploaded. The previous release
is retained for rollback.

The shared workspace release recipe must include the existing
`data/public-domain/church-fathers/audio-sources.json` test fixture. The small
allowlist correction is recorded in `rust/deploy/ship-audio-metadata.patch`
and was applied to `../administrative_stuff/ship.py` for this release.

The second command is the standard web release. Public API and resource requests
go from the Go edge directly to Rust. React page loaders/actions remain in Remix;
their search actions call Rust over loopback. The resource route
`app/routes/r.api.$.ts` remains a local compatibility bridge.

Direct routing is owned by `../reverse_proxy_extended/cross_canon.go`. Its
Cross Canon paths take precedence over shared reserved suffix handlers, while
other domains and React paths retain their existing upstreams. Keep
`DOMAINS_TO_PORTS` mapping Cross Canon to port 3005 for React; the path rules use
Rust port 3006. Deploy proxy changes separately with
`../reverse_proxy_extended/deploy.sh` (the standard proxy-only release). A failed
Rust connection returns an explicit 503; it does not fall back through Node.

If the shared host cannot reinstall the existing dependencies within its build
memory limit, `scripts/deploy-rust-api-bridge.sh` publishes the locally verified
compiled bridge only. It requires an identical production dependency lockfile,
preserves installed dependencies and existing immutable client assets, backs up
the server bundle, and rolls back on failed smoke checks. This was the release
path used for the initial API publication after the standard remote build failed.
No database or media artifacts are included.

Deploy the Rust service before a web release requiring new API capabilities.
The Rust deployment smoke-tests the web paragraph contract before switching;
the compiled-web fallback verifies a real web search and its Rust header before
accepting the release.

After publishing:

```sh
curl -f https://www.crosscanon.com/r/api/health
curl -f https://www.crosscanon.com/r/api/search \
  -H 'Content-Type: application/json' -d '{"query":"beginning","limit":3}'
```

## Verification and visual comparison

```sh
scripts/rust.sh fmt --all -- --check
scripts/rust.sh clippy --workspace -- -D warnings
scripts/rust.sh test --workspace
npm run verify
NODE_ENV=production CROSS_CANNON_UPDATE_DB=0 BENCHMARK_THEMES=1 \
  node --import tsx scripts/benchmark-rust-search.ts
```

Rust tests load the actual existing library and both read-only databases,
validate full book/chapter/passage counts, audio offsets, canon membership,
float32 decoding, similar-search exclusions, book filters, and HTTP error/result
contracts. A native egui test checks Command-F/Command-J, Escape dismissal,
keyword search with an unreachable API, and headings that follow visible Passage
metadata while scrolling across Chapters without adding history. The package's `--check-library` mode validates a copied bundle without
opening a window or making network calls.

`npm run verify` starts and stops both a release Rust API and the production web
server, then checks an actual web similar-search response. The benchmark uses
identical stored sources and filters, alternates backends, and reports first
requests separately from warmed median/p95 samples. Theme timings include live
query embeddings. Incomplete legacy result sets are marked invalid comparisons;
missing legacy ANN indexes are never rebuilt by verification or benchmarking.

With the existing web app on port 3005, capture the actual native renderer and
compose it beside the browser screenshot:

```sh
CROSS_CANON_FRESH=1 \
CROSS_CANON_SCREENSHOT="$PWD/docs/screenshots/cross-canon-desktop.png" \
CROSS_CANON_EXIT_AFTER_SCREENSHOT=1 \
  target/release/cross-canon-desktop
node scripts/compare-desktop.mjs
```

Previews are saved under the ignored `docs/screenshots/`. `CROSS_CANON_FRESH=1`
prevents preview runs from changing the user's saved reader state.
`CROSS_CANON_PASSAGE=<local ID>` opens a specific passage for comparison.
`CROSS_CANON_PREVIEW=settings|jump|search|search-results|tools|dark` selects a reproducible preview
when `CROSS_CANON_FRESH=1` is set.

## Search parity verification (2026-11-01)

The native search adapter was compared directly with production Remix form
responses, checking every ranked indexed passage ID, result count, verse
highlight, calibrated match strength, and cosine score (tolerance 0.0001).
All eight scenarios passed:

| Search | Scope | Matches |
| --- | --- | ---: |
| Theme: More money More Problems | Scripture, Protestant | 10 |
| Scripture → Scripture | Catholic, Sirach | 5 |
| Theme: More money More Problems | Early Christian, Clement of Rome | 5 |
| Scripture → Scripture | Protestant, John | 5 |
| Scripture → Early Christian | Clement of Rome | 5 |
| Early Christian → Scripture | Orthodox, 1 Esdras | 5 |
| Early Christian → Early Christian | Augustine of Hippo | 10 |
| Theme: More money More Problems | Early Christian, all authors | 10 |

Repeat this optional live check (it sends theme queries and respects the web
rate-limit cooldown):

```sh
scripts/rust.sh test -p cross-canon-desktop live_web_search_parity -- --ignored --nocapture
```

Regular native tests cover the default search mode, HTTP request/result contract,
exact local paragraph range resolution, offline keyword search, keyboard and
touch dismissal, and controls/results sizing while scrolling at 320, 393, and
1000 points wide. The results-sizing assertion reproduces the former collapsed
loading-state viewport before its fix. The request/default assertions reproduce
the former keyword/compact-contract mismatch.

The comparison covers search. Audio differences remain listed above. Keyword
search intentionally requires every query word to occur in the local passage or
reference and shows that rule below the search form.
