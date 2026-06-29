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
2. `app/features/search/search.server.ts` ensures the database schema exists,
   reads and caches indexed books from the `passages` table, validates search
   form data, scopes searches by canon/books, and returns paragraph result
   metadata.
3. The route action rate-limits each client IP to 5 searches per minute before
   handing validated form data to the search feature module.
4. `app/lib/search.server.ts` embeds the query with OpenAI when an API key is
   configured, searches paragraph passages by vector similarity, and falls back
   to stored-vector brute force or FTS/LIKE lexical search.
5. Search responses contain passage metadata only. The UI joins result IDs to
   text loaded from `/scripture-cache/<version>.json`, highlighting the best
   verse when verse embeddings indicate a stronger match than the full paragraph.
6. The reader stores the current passage ID rather than a scroll offset. It
   renders a bounded chapter window around the current passage, includes prior
   chapters for backtracking, expands the window as the user scrolls up or down,
   and preserves scroll position when chapters are prepended.

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
app/features/search/search.server.ts          server-side search form handling
app/features/search/SearchForm.tsx            textarea, submit button, filters button
app/features/search/FilterModal.tsx           canon/match/book filter modal
app/features/search/useSearchFilters.ts       localStorage and filter state
app/features/search/SearchResults.tsx         passage result cards
app/features/search/canons.ts                 canon book lists and canonical sorting
app/features/search/types.ts                  shared search feature types
app/features/scripture/                       browser scripture cache resource and lookup helpers
app/lib/search.server.ts                      embedding/vector/FTS search engine
app/lib/scripture-cache.server.ts             static scripture cache metadata/routes
app/entry.server.tsx                          production cache warmers
```

Keep route files small. If a future feature is about searching, filtering, or
displaying passage results, prefer adding it under `app/features/search/`
instead of growing `app/routes/_index.tsx`.

For upcoming passage-specific features, `SearchResults.tsx` is the current
attachment point for result-card UI, while any server-side related-passage
lookup should live in a separate search feature server module unless it belongs
inside the lower-level engine in `app/lib/search.server.ts`.

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
npm run verify-prod
```

For UI changes, capture relevant desktop and mobile screenshots before deploy
and share them for preview. Save preview artifacts under `docs/screenshots/`
and embed them with markdown image links so they render directly in chat.

`npm run verify` is the one-shot local verification command. It typechecks,
builds the scripture cache and Remix app, starts the production server, waits
for it to respond, smoke-checks the homepage, smoke-checks a search POST, and
then stops the server process. Use `VERIFY_PORT=<port>` if port `3005` is
already in use.

`npm run verify-prod` smoke-checks production without building or starting
anything locally. It checks the remote `cross-cannon` systemd service over SSH,
checks the production homepage, and submits a real search POST against
`https://www.crosscanon.com`. It expects `EC2_PEM_PATH` and `EC2_PUBLIC_IP` for
the remote service check. Use `PROD_URL=<url>` to point it at another deployed
host, `VERIFY_PROD_SERVICE=<service>` for another systemd unit, or
`VERIFY_PROD_SKIP_REMOTE=1` for public HTTP checks only.

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

`npm run build` runs `scripts/build-scripture-cache.ts` before the Remix build.
That script reads the active database and writes:

```text
scripture-cache/<version>.json
scripture-cache/<version>.json.gz
scripture-cache/manifest.json
```

The cache route serves these artifacts with long-lived immutable cache headers
and gzip when the browser accepts it.

On production startup, `app/entry.server.tsx` warms the passage embedding cache
and indexed-books cache. The browser loads the full immutable scripture cache
before enabling reader and search controls that need passage text.

## Environment

Common runtime variables:

```text
PORT=3005
DATABASE_URL=file:./storage/crosscannon.db
TURSO_AUTH_TOKEN=
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

Use `file:./storage/crosscannon.db` for local SQLite/libSQL. For Turso, set
`DATABASE_URL` to the Turso/libSQL URL and set `TURSO_AUTH_TOKEN`.

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
--skip-index-rebuild        skip final FTS/vector index rebuild
--rebuild-indexes-only      rebuild FTS/vector indexes and exit
```

For a parallel book-by-book run:

```bash
OPENAI_API_KEY=your_key_here \
INDEX_PARALLEL_BOOKS=5 \
DATABASE_PATH=storage/crosscannon.db \
INDEXING_JOBS_DB=storage/indexing-jobs.db \
scripts/index-remaining-books.sh
```

After indexing, rebuild the browser scripture cache and app bundle:

```bash
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

If `OPENAI_API_KEY` is blank, the importer still creates passages,
`paragraph_verses`, and text-search tables, but no OpenAI embeddings are stored.
That is fine for smoke testing. Real semantic search requires indexing with the
same embedding configuration used at runtime.

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
with `npm run build` after changing the runtime database.
