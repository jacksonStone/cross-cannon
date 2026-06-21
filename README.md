# Cross Cannon

Public Remix 2.16 scripture retrieval app for `crosscannon.com`.

Users submit a question and receive related Scripture passages only. The app does not generate an answer. It embeds the question when `OPENAI_API_KEY` is configured, searches a persisted libSQL/Turso passage index, and falls back to lexical search for local development.

## Local Development

```bash
npm install
npm run smoke:index
npm run dev
```

The local Remix dev server runs on:

```text
http://127.0.0.1:3005
```

On this machine, `npm run dev` mirrors the app into `/private/tmp/cross-cannon-remix-dev` and runs the real Remix 2.16 Vite dev server there. The Desktop workspace path causes esbuild's package resolver to hang, while the same Remix app runs normally from `/private/tmp`.

Useful local checks:

```bash
curl -I http://127.0.0.1:3005/
curl -X POST 'http://127.0.0.1:3005/?index' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'question=fear and comfort'
```

Production build also uses the temp mirror and copies artifacts back into `./build`:

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

For Turso, set `DATABASE_URL` to the Turso/libSQL URL and `TURSO_AUTH_TOKEN` to the database token.

## Indexing

Use the local or server-side Bible JSON:

```bash
npm run index:bible -- /path/to/bible.json
```

The public source repo is:

```text
https://github.com/jacksonStone/Bible_as_JSON
```

The raw JSON URL is:

```text
https://raw.githubusercontent.com/jacksonStone/Bible_as_JSON/main/bible.json
```

On the Ubuntu box, download it outside the app checkout and index it:

```bash
mkdir -p /home/ubuntu/cross-cannon-data
curl -L https://raw.githubusercontent.com/jacksonStone/Bible_as_JSON/main/bible.json -o /home/ubuntu/cross-cannon-data/bible.json
cd /home/ubuntu/cross-cannon
npm run index:bible -- /home/ubuntu/cross-cannon-data/bible.json
```

The importer supports:

- flat arrays with `book`, `chapter`, `verse`, `text`
- `{ "books": [{ "name": "...", "chapters": [...] }] }`
- object maps shaped like `{ "Genesis": { "1": { "1": "..." } } }`

When `OPENAI_API_KEY` is set, indexing persists embeddings into the `passages` table. Without the key, it still builds the text index for local testing.

## Rate Limit

Search actions are limited to 5 requests per minute per IP address. The limiter reads `X-Forwarded-For` first for reverse-proxy deployments.

## Deployment Notes

The service file expects the app at `/home/ubuntu/cross-cannon` and runs on port `3005` behind the shared reverse proxy. Add this mapping to `DOMAINS_TO_PORTS` in the Ubuntu env file:

```text
crosscannon.com:3005
```
