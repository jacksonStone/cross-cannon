# Cross Cannon Architecture

This document maps the key runtime, search, reader, build, deploy, and
verification flows in Cross Cannon.

## Rendering

GitHub renders these Mermaid diagrams directly in the file preview.

Local options:

```bash
# Open the HTML renderer in a browser.
open docs/architecture.html

# Or render a single Mermaid file to SVG/PNG with Mermaid CLI.
npx -y @mermaid-js/mermaid-cli -i docs/runtime-architecture.mmd -o docs/runtime-architecture.svg
npx -y @mermaid-js/mermaid-cli -i docs/runtime-architecture.mmd -o docs/runtime-architecture.png

# Render every diagram and create docs/cross-cannon-architecture.png.
npm run render:architecture
```

VS Code also renders this file with an extension such as
`Markdown Preview Mermaid Support`.

## Runtime Architecture

```mermaid
flowchart TD
  User["Browser User"] --> EdgeProxy["Go reverse proxy"]
  EdgeProxy -->|"React pages / data / actions"| Root["Index Route /"]
  EdgeProxy --> ReaderRoute["Reader Route /reader/:passageId"]
  EdgeProxy -->|"/r/api"| Rust

  Root --> Loader[Index loader]
  Root --> Action[Index action]
  ReaderRoute --> ReaderLoader[Reader loader]

  Loader --> IndexedBooks[getIndexedBooks]
  Loader --> CacheInfo[getScriptureCacheInfo]
  ReaderLoader --> CacheInfo

  Root --> ScriptureLibrary[useScriptureLibrary]
  ReaderRoute --> ScriptureLibrary

  ScriptureLibrary --> BrowserCache["/scripture-cache/:version.json"]
  BrowserCache --> FullPassageCache["Full browser passage cache"]
  BrowserCache --> EdgeProxy
  EdgeProxy -->|"Text / metadata / audio paths"| RustResources["Rust /r/api/resources"]
  RustResources --> ExistingFiles["Existing text, gzip, metadata and recordings"]
  ScriptureLibrary --> PassageLookup["Shared passageLookup Map"]

  Root --> PassageReader[PassageReader]
  Root --> SearchModal[Search modal]
  ReaderRoute --> PassageReader

  SearchModal --> SearchForm[SearchForm]
  SearchModal --> SearchResults[SearchResults]
  SearchForm --> SearchDialogState[Cross-corpus Search Dialog state]
  PassageReader --> PassageJump[PassageJump]
  SearchForm --> PassageJump

  SearchForm --> Action
  SearchResults --> PassageLookup
  SearchForm --> PassageLookup
  PassageReader --> ScriptureNavigation[Scripture Reader Navigation adapter]
  ScriptureNavigation --> ChapterIndex[buildChapterIndex]
  PassageJump --> JumpIndex[buildJumpIndex]

  Action --> RateLimit[rateLimit by client IP]
  RateLimit --> SearchRequest[Search Request module]
  SearchRequest --> Filters[canon / books / authors]
  SearchRequest --> SearchEngine["Rust adapter → loopback /r/api/search"]

  SearchEngine --> Rust["R Cross Cannon / Axum"]
  Rust --> OpenAI["OpenAI: new theme query embedding only"]
  Rust --> DB[("Existing SQLite vectors, read-only")]
  Rust --> Vector["Exact scoring + existing paragraph/verse refinement"]
  Rust --> IndexedBooks
  TextArtifacts["Existing immutable text artifacts"] -. catalog fallback .-> IndexedBooks
  DB --> StartupPassages
  DB --> CacheBuild[buildScriptureCachePayload]
  CacheBuild --> StaticCache["scripture-cache manifest/json/gzip"]
```

## Scripture Readiness

```mermaid
stateDiagram-v2
  [*] --> Loading
  Loading --> Ready: immutable cache loaded
  Loading --> Error: cache request fails

  note right of Ready
    Reader, search, jump modal,
    result text, similar passage actions,
    and passage lookup all use the same
    complete scripture cache.
  end note
```

## Search Flow

```mermaid
sequenceDiagram
  participant User
  participant SearchForm
  participant IndexAction as / action
  participant SearchRequest as Search Request module
  participant SearchEngine as Rust /r/api/search
  participant DB as Existing SQLite vectors, read-only
  participant OpenAI
  participant UI as SearchResults

  User->>SearchForm: Submit theme query or similar passage
  SearchForm->>IndexAction: POST /?index form data
  IndexAction->>IndexAction: rateLimit(client IP)
  IndexAction->>SearchRequest: handleSearchRequest(formData)
  SearchRequest->>SearchRequest: validate and prepare Search Request
  SearchRequest->>SearchEngine: validate catalog /r/api/books

  alt Theme search
    SearchRequest->>SearchEngine: semantic query, target, books/authors, web=true
    SearchEngine->>OpenAI: embed new query using indexed model/config
    SearchEngine->>DB: read existing verse / best-paragraph vectors
  else Similar passage search
    SearchRequest->>SearchEngine: sourceId, target, books/authors, web=true
    SearchEngine->>DB: exact selected paragraph vector + refinement
  end

  SearchEngine-->>SearchRequest: passage IDs + score metadata
  SearchRequest-->>IndexAction: existing route-specific JSON
  IndexAction-->>UI: results metadata
  UI->>UI: join IDs to full passage text via passageLookup
```

## Reader Flow

```mermaid
flowchart TD
  InitialPassage[readerPassageId] --> ScriptureNavigation[Scripture Reader Navigation adapter]
  ScriptureNavigation --> ChapterIndex["buildChapterIndex(passages)"]
  ChapterIndex --> Chapters[Chapter windows]
  Chapters --> RenderedRange[Rendered chapter range]

  RenderedRange --> InitialScroll[Initial scroll settling]
  InitialScroll --> RAF[bounded requestAnimationFrame loop]
  InitialScroll --> Fonts[document.fonts.ready if available]

  UserScroll[User scrolls] --> ExpandWindow[Expand rendered chapter window]
  ExpandWindow --> Prepend[Preserve scroll when prepending chapters]
  ExpandWindow --> Append[Append next chapters near bottom]

  UserPosition[Reading anchor] --> LocationReport[onLocationChange]
  LocationReport --> LocalStorage[remember reader position]

  ExplicitJump[Explicit jump] --> ReaderLink[Reader Link]
  ReaderLink --> BrowserHistory[Back / Forward]
  PassageSelection[Passage selection] --> ReaderLink
  UserScroll -. no URL update .-> ReaderLink

  PassageReader --> Audio[Chapter audio button]
  PassageReader --> PassageActions[Similar passages action]
  PassageReader --> PassageJump[Jump modal]
```

## Build, Deploy, And Verification

```mermaid
flowchart LR
  Dev[Local workspace] --> Verify[npm run verify]
  Verify --> Typecheck[tsc --noEmit]
  Verify --> RustChecks["Rust API tests + release build"]
  RustChecks --> LocalRust["Start loopback Rust API"]
  Verify --> Build[npm run build]
  Verify --> LocalServer[Start production server locally]
  Verify --> LocalSmoke["HEAD / + web POST results and Rust header"]
  Verify --> StopServer[Stop local web and Rust servers]

  Build --> RemixBuild["remix vite:build"]
  RemixBuild --> BuildDir["build/client + build/server"]

  Dev --> RustSnapshot["Publish compiler-input snapshot on dedicated build branch"]
  RustSnapshot --> RustCI["GitHub Actions queue; working checkout/index unchanged"]
  RustCI --> RustContainer["Hosted Linux Docker: pinned Rust image, linux/amd64"]
  RustContainer --> RustArtifact["Tested binary + systemd unit + checksums"]
  RustArtifact --> RustRelease["Commit-specific public release artifact"]
  RustRelease --> RustUpload["Download + verify + upload; shared deploy lock"]
  RustUpload --> RustReplace["Replace single managed Rust instance"]
  RustReplace --> RustHealth["Search/resource checks; rollback on failure"]

  Dev --> UpdateDbCache["npm run update-db:scripture-cache"]
  UpdateDbCache --> CacheScript["scripts/build-scripture-cache.ts"]
  CacheScript --> DB[("Local active DB")]
  CacheScript --> CacheArtifacts["scripture-cache/*.json + *.gz + manifest"]

  Dev --> Deploy["./deploy.sh"]
  Deploy --> Package["Zip build/public/scripts/cache/package files"]
  Package --> SCP[SCP to Ubuntu box]
  SCP --> Remote["/home/ubuntu/cross-cannon"]
  Remote --> PreserveStorage["Preserve remote storage/"]
  Remote --> NpmCi[npm ci --omit=dev --legacy-peer-deps]
  NpmCi --> Restart[systemctl restart cross-cannon]
  Restart --> RuntimeDbGuard["DB maintenance skipped unless CROSS_CANNON_UPDATE_DB=1"]

  Restart --> VerifyProd[npm run verify-prod]
  VerifyProd --> Systemd[SSH systemctl is-active + journalctl]
  VerifyProd --> LiveHead["HEAD https://www.crosscanon.com/"]
  VerifyProd --> LivePost[POST production search]
```

## Ownership Boundaries

```text
app/routes/
  Thin Remix route wiring: loaders, actions, page composition.

app/features/scripture/
  Browser scripture cache loading, shared readiness state, passageLookup.

app/features/search/
  Search UI, shared Search Dialog state, filters, result rendering, and
  server-side Search Request handling.

app/features/reader-navigation/
  Reader Links and the Scripture Reader Navigation adapter.

app/features/passage-reader/
  Reader layout, chapter windows, scroll preservation, passage actions.

app/features/passage-jump/
  Book/chapter/verse navigation modal.

app/lib/
  Database setup, scripture cache server metadata, embeddings, search engine,
  rate limiting, audio chapter helpers.

scripts/
  Index/build/download/deploy-adjacent operational scripts, shared Early
  Christian Work audio alignment, plus verification.
```

## Continuous Audio Playback

`app/features/audio/` owns the Scripture audio session,
chapter timestamps, original-recording fallback, and Media Session controls.
The Scripture reader adapts its chapter index to this player and does not
advance between files inside a combined book. Early Christian playback is
unchanged in the initial Bible-only rollout. Reader state follows audio time when
JavaScript is active again.

`scripts/build-continuous-audio.ts` preserves originals on the Mac mini and
creates a separate AAC file per book/Work from decoded source samples.
`public/continuous-audio.json` is a small timestamp manifest independent of the
scripture cache and database. `audio.continuous.$fileName.ts` forwards to Rust,
which streams content-addressed files from production storage with byte ranges.
Derived media is uploaded separately before the normal application release;
original recordings and source mappings remain available for rollback.


## Christian Classics

`app/features/work-reader/` configures the existing Work reader for Early
Christian Works and Christian Classics. The routes are thin adapters; chapter
rendering, navigation, selected Passage links, settings, Jump, search, audio
availability, and offline Work downloads share the existing implementation.
`/christian-classics` provides the browsing view and `/christian-classics/read`
opens the reader. Collections retain independent Reader Locations and favorites.

`scripts/import-christian-classics.py` verifies pinned raw sources and emits the
same book index, manifest, and immutable Chapter assets as Early Christian Works.
Commentaries additionally retain Scripture chapter/verse coverage. The Scripture
reader’s “View commentaries” action matches the selected book, chapter, and
overlapping verse ranges to show indexed notes. The native reader uses the same
coverage from its bundled catalog without an online search.

`npm run index:christian-classics` explicitly indexes these artifacts with the
shared indexer into `storage/christian-classics.db`. Rust loads this optional
third corpus read-only, preserving collection-specific author filters and vector
scoring. Existing Scripture and Early Christian databases are unchanged. A
normal deploy preserves production storage, so deploying this feature requires
separately provisioning the indexed Classics database before release.
