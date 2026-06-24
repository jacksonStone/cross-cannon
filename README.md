# Cross Cannon

Public Remix 2.16 app for `crosscanon.com`.

Cross Cannon accepts a user's question and returns related Scripture only. It does not write an answer, commentary, or summary. Results are mixed verse and chapter passages from a persisted libSQL/Turso-compatible index.

## How It Works

1. The user submits a question from the Remix route in `app/routes/_index.tsx`.
2. `app/lib/rate-limit.server.ts` limits each IP address to 5 searches per minute. Behind the reverse proxy it reads `X-Forwarded-For`.
3. `app/lib/search.server.ts` embeds the question with OpenAI when `OPENAI_API_KEY` is configured.
4. The app searches the persisted `passages` table in libSQL/SQLite:
   - vector search when embeddings are available
   - stored-vector brute force fallback if needed
   - FTS/LIKE lexical fallback for local testing or no embedding key
5. The response renders about 10 Scripture passages. The only returned content is passage reference and Bible text.

The index is built ahead of time by `scripts/index-bible.ts`. It stores both verse-level and chapter-level passages, so search results can include either.

## Local Development

```bash
npm install
npm run smoke:index
npm run dev
```

Open:

```text
http://127.0.0.1:3005
```

`npm run smoke:index` builds a small local database from `data/sample-bible.json`. It is only for testing the app path; it is not the real Bible index.

Useful checks:

```bash
curl -I http://127.0.0.1:3005/

curl -X POST 'http://127.0.0.1:3005/?index' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'question=fear and comfort'
```

Production build/start locally:

```bash
npm run build
PORT=3005 npm run start
```

## Environment

```text
PORT=3005
DATABASE_URL=file:./storage/crosscannon.db
OPENAI_API_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=1536
TURSO_AUTH_TOKEN=
BIBLE_JSON_PATH=/home/ubuntu/cross-cannon-data/bible.json
```

Use `file:./storage/crosscannon.db` for local SQLite/libSQL. For Turso, set `DATABASE_URL` to the Turso/libSQL URL and set `TURSO_AUTH_TOKEN`.

## Full Bible Index

The source Bible JSON is Jackson's public repo:

```text
https://github.com/jacksonStone/Bible_as_JSON
https://raw.githubusercontent.com/jacksonStone/Bible_as_JSON/main/bible.json
```

Build the full index from a downloaded JSON file:

```bash
mkdir -p /home/ubuntu/cross-cannon-data
curl -L https://raw.githubusercontent.com/jacksonStone/Bible_as_JSON/main/bible.json \
  -o /home/ubuntu/cross-cannon-data/bible.json

DATABASE_URL=file:./storage/crosscannon.db \
OPENAI_API_KEY=your_key_here \
npm run index:bible -- /home/ubuntu/cross-cannon-data/bible.json
```

If `OPENAI_API_KEY` is blank, the importer still creates the passage and text-search tables, but no embeddings are stored. That is fine for local smoke testing. Real semantic search requires indexing with the same embedding configuration used at runtime.

Supported importer shapes:

- flat arrays with `book`, `chapter`, `verse`, `text`
- `{ "books": [{ "name": "...", "chapters": [...] }] }`
- object maps like `{ "Genesis": { "1": { "1": "..." } } }`

## Deployment

This repo includes:

- `deploy.sh` for building and syncing the app on the Ubuntu box
- `cross-cannon.service` for systemd
- default port `3005`

The shared reverse proxy should route:

```text
crosscanon.com:3005
```

The systemd service expects the app at:

```text
/home/ubuntu/cross-cannon
```

## Current Status

The committed app runs locally, builds successfully, and can return results from the smoke-test database. The full Bible embedding index has not been generated yet; run the full indexing command above with an OpenAI key before expecting real semantic results.
