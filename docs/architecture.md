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
  User["Browser User"] --> Root["Index Route /"]
  User --> ReaderRoute["Reader Route /reader/:passageId"]

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
  ScriptureLibrary --> PassageLookup["Shared passageLookup Map"]

  Root --> PassageReader[PassageReader]
  Root --> SearchModal[Search modal]
  ReaderRoute --> PassageReader

  SearchModal --> SearchForm[SearchForm]
  SearchModal --> SearchResults[SearchResults]
  PassageReader --> PassageJump[PassageJump]
  SearchForm --> PassageJump

  SearchForm --> Action
  SearchResults --> PassageLookup
  SearchForm --> PassageLookup
  PassageReader --> ChapterIndex[buildChapterIndex]
  PassageJump --> JumpIndex[buildJumpIndex]

  Action --> RateLimit[rateLimit by client IP]
  RateLimit --> SearchServer[handleSearchRequest]
  SearchServer --> Filters[parseSearchFilters]
  SearchServer --> SearchEngine["app/lib/search.server.ts"]

  SearchEngine --> OpenAI["OpenAI embeddings if configured"]
  SearchEngine --> DB[("SQLite / libSQL passage index")]
  SearchEngine --> FTS["FTS lexical fallback"]
  SearchEngine --> Vector["Vector similarity / cached embeddings"]

  DB --> IndexedBooks
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
  participant SearchServer as search.server.ts
  participant SearchEngine as search.server engine
  participant DB as SQLite/libSQL
  participant OpenAI
  participant UI as SearchResults

  User->>SearchForm: Submit theme query or similar passage
  SearchForm->>IndexAction: POST /?index form data
  IndexAction->>IndexAction: rateLimit(client IP)
  IndexAction->>SearchServer: handleSearchRequest(formData)
  SearchServer->>SearchServer: parse canon/books/matchCount
  SearchServer->>DB: validate indexed books

  alt Theme search
    SearchServer->>SearchEngine: searchScripture(question, limit, books)
    SearchEngine->>OpenAI: embed query if API key configured
    SearchEngine->>DB: vector search / cached embeddings / FTS fallback
  else Similar passage search
    SearchServer->>SearchEngine: searchSimilarScripture(sourcePassageId)
    SearchEngine->>DB: load source embedding + neighbors
  end

  SearchEngine-->>SearchServer: passage IDs + score metadata
  SearchServer-->>IndexAction: SearchActionData JSON
  IndexAction-->>UI: results metadata
  UI->>UI: join IDs to full passage text via passageLookup
```

## Reader Flow

```mermaid
flowchart TD
  InitialPassage[readerPassageId] --> PassageReader
  PassageReader --> ChapterIndex["buildChapterIndex(passages)"]
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

  PassageReader --> Audio[Chapter audio button]
  PassageReader --> PassageActions[Similar passages action]
  PassageReader --> PassageJump[Jump modal]
```

## Build, Deploy, And Verification

```mermaid
flowchart LR
  Dev[Local workspace] --> Verify[npm run verify]
  Verify --> Typecheck[tsc --noEmit]
  Verify --> Build[npm run build]
  Verify --> LocalServer[Start production server locally]
  Verify --> LocalSmoke["HEAD / + POST search"]
  Verify --> StopServer[Stop local server]

  Build --> RemixBuild["remix vite:build"]
  RemixBuild --> BuildDir["build/client + build/server"]

  Dev --> UpdateDbCache["npm run update-db:scripture-cache"]
  UpdateDbCache --> CacheScript["scripts/build-scripture-cache.ts"]
  CacheScript --> DB[("Local active DB")]
  CacheScript --> CacheArtifacts["scripture-cache/*.json + *.gz + manifest"]

  Dev --> Deploy["./deploy.sh"]
  Deploy --> Package["Zip build/public/scripts/cache/package files"]
  Package --> SCP[SCP to Ubuntu box]
  SCP --> Remote["/home/ubuntu/cross-cannon"]
  Remote --> PreserveStorage["Preserve remote storage/"]
  Remote --> NpmCi[npm ci --omit=dev]
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
  Search UI, filters, result rendering, server-side form/search handling.

app/features/passage-reader/
  Reader layout, chapter windows, scroll preservation, passage actions.

app/features/passage-jump/
  Book/chapter/verse navigation modal.

app/lib/
  Database setup, scripture cache server metadata, embeddings, search engine,
  rate limiting, audio chapter helpers.

scripts/
  Index/build/download/deploy-adjacent operational scripts plus verification.
```
