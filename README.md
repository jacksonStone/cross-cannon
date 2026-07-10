(This was vibe coded, be warned!)

# Cross Cannon

Public Remix app for `crosscanon.com`.

Cross Cannon searches Scripture by theme and returns Scripture only. It does not
generate commentary, answers, summaries, or application text. The runtime search
returns paragraph-level passage IDs from a persisted libSQL/SQLite index, and
the browser loads the full passage text from a versioned static scripture cache.

## What The App Does

1. The index route in `app/routes/_index.tsx` is intentionally thin. It wires
   the route loader/action to search feature modules, loads the browser
   scripture cache, and composes the reader, search form, and results
   components.
2. `app/features/search/search-request.server.ts` handles Search Requests from
   both reader routes, preserving their form/result contracts while keeping
   validation, corpus selection, canon/book/author scope, and result shaping in
   one module.
3. The route action rate-limits each client IP to 5 searches per minute before
   handing form data to the Search Request module.
4. `app/lib/search.server.ts` embeds the query with OpenAI when an API key is
   configured, searches broad result sets through the persisted vector index,
   and scores small selected-book searches exactly within those books.
5. Search responses contain passage metadata only. The UI joins result IDs to
   text loaded from `/scripture-cache/<version>.json`, highlighting the best
   verse when verse embeddings indicate a stronger match than the full paragraph.
6. The reader stores the current passage ID rather than a scroll offset. It
   renders a bounded chapter window around the current passage, includes prior
   chapters for backtracking, expands the window as the user scrolls up or down,
   and preserves scroll position when chapters are prepended.
7. A service worker retains the Scripture reader and lets readers download
   complete, text-only Early Christian Works for offline reading from the
   reader tools menu.

The current index shape is paragraph-only. The `paragraph_verses` table stores
individual verse text and embeddings for highlight selection inside each
returned paragraph.

The UI defaults to the Protestant canon. Catholic mode searches the Protestant
canon plus Tobit, Judith, Wisdom, Sirach, Baruch, Greek Daniel, Greek Esther,
1 Maccabees, and 2 Maccabees. Orthodox mode adds 1 Esdras, 2 Esdras,
3 Maccabees, 4 Maccabees, Prayer of Manasseh, and Psalm 151.

## Project Navigation

Start with these files when changing app behavior:

```text
app/routes/_index.tsx                         page composition, loader/action
app/features/passage-reader/PassageReader.tsx immersive reader, dynamic chapter window
app/features/passage-reader/chapter-index.ts  passage reference parsing and chapter grouping
app/features/passage-jump/PassageJump.tsx     book/chapter/verse jump modal
app/features/reader-navigation/               Reader Links and Scripture Reader Navigation adapter
app/features/search/search-request.server.ts  cross-corpus Search Request handling
app/features/search/useSearchDialogState.ts   cross-corpus Search Dialog state and filter behavior
app/features/search/SearchForm.tsx            textarea, submit button, filters button
app/features/search/FilterModal.tsx           canon/match/book filter modal
app/features/search/useSearchFilters.ts       localStorage and filter state
app/features/search/SearchResults.tsx         passage result cards
app/features/search/canons.ts                 canon book lists and canonical sorting
app/features/search/types.ts                  shared search feature types
app/features/scripture/                       browser scripture cache resource and lookup helpers
app/features/offline/                         reachability and Early Christian Work downloads
app/lib/search.server.ts                      embedding/vector search engine
app/lib/scripture-cache.server.ts             static scripture cache metadata/routes
app/entry.server.tsx                          production cache warmers
```

Keep route files small. If a future feature is about searching, filtering, or
displaying passage results, prefer adding it under `app/features/search/`
instead of growing `app/routes/_index.tsx`.

For upcoming passage-specific features, `SearchResults.tsx` is the current
attachment point for result-card UI. New Search Request modes belong in
`app/features/search/search-request.server.ts`; lower-level embedding and
ranking behavior belongs in `app/lib/search.server.ts`.

Reader Links use `/reader/:passageId` for Scripture and
`/church-fathers?chapter=...&passage=...` for Early Christian Works. Explicit
jumps create browser history; selecting a Passage replaces the current link;
passive scrolling only persists Reader Location.

## Local Development

Requirements:

- Node.js `>=20.15.0`
- npm
- optional `OPENAI_API_KEY` for semantic embeddings
- optional `sqlite3` CLI for `scripts/index-remaining-books.sh`

Install dependencies and build a small local test index:

```bash
npm install
npm run smoke:index
npm run dev
```

Open:

```text
http://127.0.0.1:3005
```

`npm run smoke:index` uses `EMBEDDING_PROVIDER=mock` and
`data/sample-bible.json`. It is useful for checking the app path without
calling OpenAI or building the full Bible index.

Useful checks:

```bash
npm run verify
npm run verify:offline
npm run verify-prod
npm run ship
```

For UI changes, capture relevant desktop and mobile screenshots before deploy
and share them for preview. Save preview artifacts under `docs/screenshots/`
and embed them with markdown image links so they render directly in chat.

`npm run verify` is the one-shot local verification command. It typechecks,
builds the Remix app using the existing scripture cache artifacts, starts the
production server, waits for it to respond, smoke-checks the homepage,
smoke-checks a search POST, and then stops the server process. Use
`VERIFY_PORT=<port>` if port `3005` is already in use.

`npm run verify:offline` builds the production app, starts it on an isolated
local port, and runs the Puppeteer offline-reader journey. The journey exercises
atomic service-worker updates, whole-Work download progress and cancellation,
interrupted-update resume, manual priority over background refreshes, quota
recovery, missing-Chapter eviction and repair, failed-origin behavior, direct
Reader Links, downloaded-only navigation, removal, and mobile/desktop offline
UI without requiring a separately running server.

`npm run verify-prod` smoke-checks production without building or starting
anything locally. It checks the remote `cross-cannon` systemd service over SSH,
checks the production homepage, and submits a real search POST against
`https://www.crosscanon.com`. It expects `EC2_PEM_PATH` and `EC2_PUBLIC_IP` for
the remote service check. Use `PROD_URL=<url>` to point it at another deployed
host, `VERIFY_PROD_SERVICE=<service>` for another systemd unit, or
`VERIFY_PROD_SKIP_REMOTE=1` for public HTTP checks only.

`npm run ship` is the standard release path: it runs `npm run verify`, then
`./deploy.sh`, then `npm run verify-prod`.

Manual smoke checks against a running dev or production server:

```bash
curl -I http://127.0.0.1:3005/

curl -X POST 'http://127.0.0.1:3005/?index' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'question=fear and comfort&matchCount=10'
```

Production build/start locally:

```bash
npm run build
PORT=3005 npm run start
```

`npm run build` only builds the Remix app. It does not rebuild the browser
scripture cache and should not be used as an implicit database update step.
Production runtime database maintenance is also disabled unless
`CROSS_CANNON_UPDATE_DB=1` is set.

To explicitly refresh the browser scripture cache from the active database, run:

```bash
npm run update-db:scripture-cache
```

That command sets `CROSS_CANNON_UPDATE_DB=1`, reads the active database, and
writes:

```text
scripture-cache/<version>.json
scripture-cache/<version>.json.gz
scripture-cache/manifest.json
```

The cache route serves these artifacts with long-lived immutable cache headers
and gzip when the browser accepts it.

## Early Christian Audio Alignment

The Early Christian reader links remote audio instead of downloading MP3s into
the app. Audio tracks do not always map cleanly to parsed Chapter names, so audio
support is produced as a Chapter Audio Alignment selected by exact CCEL Work ID:

```bash
npm run build:church-fathers-audio-alignment -- --work-id npnf101:vi
npm run build:church-fathers-audio-alignment -- --work-id npnf102:iv
npm run build:church-fathers-audio-alignment -- --work-id anf09:xii.iv
```

Use `--track <file-name>` or `--limit <count>` for an incremental run,
`--book <number>` to select one Book inside a Work, `--dry-run` to inspect the
selection without OpenAI, and `--reset` to discard the selected Work's existing
alignment. Runs merge into the existing artifact unless `--reset` is present:

```bash
npm run build:church-fathers-audio-alignment -- \
  --work-id npnf101:vi \
  --track confessions_01_11-19_augustine_64kb.mp3

npm run build:church-fathers-audio-alignment -- \
  --work-id npnf102:iv \
  --book 1 \
  --limit 1 \
  --dry-run
```

The shared module downloads each selected track to a temp file, retries remote
downloads, uses Archive.org mirrors when available, and automatically chunks
oversized audio with `ffmpeg`. It sends audio to OpenAI `whisper-1` with
`verbose_json` and word timestamps, archives the raw response under
`storage/church-fathers-audio/transcripts/`, then applies the selected Work's
Alignment Policy. Cached transcript JSON is reused on later runs.

The deployed browser asset is:

```text
public/church-fathers-preview/confessions-audio-alignment.json
```

It has this shape:

```json
{
  "chapters": {
    "npnf101:vi.I_1.XIV": {
      "audioUrl": "https://archive.org/download/confessions_augustine_0911_librivox/confessions_01_11-19_augustine_64kb.mp3",
      "confidence": 0.8888888888888888,
      "endSeconds": 695.3,
      "label": "Book 01, Chapters 11-19",
      "startSeconds": 591.9
    }
  },
  "generatedAt": "2026-07-02T00:00:00.000Z",
  "source": "https://archive.org/details/confessions_augustine_0911_librivox"
}
```

Treat `audioUrl`, `startSeconds`, and `endSeconds` as the playback contract.
Track labels and parsed chapter names are metadata only; do not assume they
align exactly.

Work-specific Chapter-ID parsing, matching preference, hints, confidence, and
offset adjustments live in small Alignment Policy adapters under
`scripts/audio-alignment-policies/`. Source URLs, tracks, and output artifact
names live in `data/public-domain/church-fathers/audio-sources.json`.

On production startup, `app/entry.server.tsx` warms the indexed-books cache.
The browser loads the full immutable scripture cache before enabling reader and
search controls that need passage text.

## Environment

Common runtime variables:

```text
PORT=3005
DATABASE_URL=file:./storage/crosscannon.db
OPENAI_API_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-large
OPENAI_EMBEDDING_DIMENSIONS=1536
```

Indexer-specific variables:

```text
BIBLE_JSON_PATH=data/bible.json
INDEXING_JOBS_DATABASE_URL=file:./storage/indexing-jobs.db
EMBEDDING_PROVIDER=mock
```

Use `file:./storage/crosscannon.db` for the local SQLite database.

The indexer stores the active embedding model and dimensions in
`scripture_embedding_config`. Runtime search reads that metadata before
embedding queries so query vectors use the same model and dimension count as the
stored passage and verse vectors.

## Full Bible Index

The expected source file is Jackson's public Bible JSON:

```text
https://github.com/jacksonStone/Bible_as_JSON
https://raw.githubusercontent.com/jacksonStone/Bible_as_JSON/main/bible.json
```

Download it locally:

```bash
curl -L https://raw.githubusercontent.com/jacksonStone/Bible_as_JSON/main/bible.json \
  -o data/bible.json
```

Build or resume the full paragraph index:

```bash
OPENAI_API_KEY=your_key_here \
DATABASE_URL=file:./storage/crosscannon.db \
INDEXING_JOBS_DATABASE_URL=file:./storage/indexing-jobs.db \
npm run index:bible -- data/bible.json --passage-type paragraph
```

Useful indexer flags:

```text
--reset                     clear runtime passages before indexing
--resume                    resume the latest unfinished matching job
--limit <n>                 index only n passages
--book <name>               index one book
--db <path-or-file-url>     runtime DB path
--jobs-db <path-or-file-url> indexing jobs DB path
--no-archive                skip local DB archive copies
--skip-index-rebuild        skip final vector index rebuild
--rebuild-indexes-only      rebuild vector indexes and exit
```

For a parallel book-by-book run:

```bash
OPENAI_API_KEY=your_key_here \
INDEX_PARALLEL_BOOKS=5 \
DATABASE_PATH=storage/crosscannon.db \
INDEXING_JOBS_DB=storage/indexing-jobs.db \
scripts/index-remaining-books.sh
```

After indexing, explicitly rebuild the browser scripture cache, then rebuild the
app bundle:

```bash
npm run update-db:scripture-cache
npm run build
```

To add or resume the Catholic deuterocanonical books without resetting the
existing Protestant index, archive the DB first and then run the indexer per
book with `--no-archive --skip-index-rebuild`; rebuild indexes once at the end:

```bash
for book in "Tobit" "Judith" "Wisdom" "Sirach" "Baruch" \
  "Daniel (Greek)" "Esther (Greek)" "1 Maccabees" "2 Maccabees"; do
  npm run index:bible -- data/bible.json \
    --db storage/crosscannon.db \
    --jobs-db storage/indexing-jobs.db \
    --passage-type paragraph \
    --book "$book" \
    --no-archive \
    --skip-index-rebuild
done

npm run index:bible -- data/bible.json \
  --db storage/crosscannon.db \
  --jobs-db storage/indexing-jobs.db \
  --no-archive \
  --rebuild-indexes-only
```

To add or resume the additional Orthodox books, use the same pattern for:

```text
1 Esdras
2 Esdras
Prayer of Manasseh
Psalm 151
3 Maccabees
4 Maccabees
```

If `OPENAI_API_KEY` is blank, the importer still creates passages and
`paragraph_verses`, but no OpenAI embeddings are stored. That is fine for smoke
testing. Real semantic search requires indexing with the same embedding
configuration used at runtime.

Supported Bible JSON shapes:

- flat arrays with `book`, `chapter`, `verse`, `text`
- `{ "books": [{ "name": "...", "chapters": [...] }] }`
- object maps like `{ "Genesis": { "1": { "1": "..." } } }`

## Deployment

This repo includes:

- `deploy.sh` to build, package, copy, install production dependencies, and
  restart the service on the Ubuntu box
- `cross-cannon.service` for systemd
- default port `3005`

The reverse proxy should route:

```text
crosscanon.com -> 127.0.0.1:3005
```

The systemd service expects:

```text
WorkingDirectory=/home/ubuntu/cross-cannon
EnvironmentFile=/home/ubuntu/.ubuntu-env
PORT=3005
```

`deploy.sh` packages `build`, `public`, `scripture-cache`, `package.json`,
`package-lock.json`, and `README.md`. It preserves an existing remote
`/home/ubuntu/cross-cannon/storage` directory during deploys, so the production
database must already exist on the server or be copied there separately.

Normal deploys and `npm run ship` do not opt into production database
maintenance. Set `CROSS_CANNON_UPDATE_DB=1` only for an explicit DB update task.

Required deploy environment variables on the machine running `deploy.sh`:

```text
EC2_PEM_PATH=/path/to/key.pem
EC2_PUBLIC_IP=<server-ip-or-host>
```

## Current Local State

As of June 25, 2026, this checkout contains:

- `data/bible.json`
- `storage/crosscannon.db`
- `storage/indexing-jobs.db`
- generated scripture cache version `6dca027513ce9a26`
- 81 indexed books: Protestant, Catholic, and Orthodox canon options
- generated scripture cache includes the Orthodox additions from `data/bible.json`
- 8,360 cached paragraph passages

Those local artifacts are large and operationally significant. Rebuild the cache
with `npm run update-db:scripture-cache` after changing the runtime database.
