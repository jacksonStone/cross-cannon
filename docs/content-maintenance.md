# Content, indexing and exports

These are explicit authoring/maintenance tasks, separate from ordinary builds,
verification and deployment. Search databases and original recordings never enter
release archives. Use existing immutable artifacts for application work.

Retained TypeScript helpers live under `scripts/lib/`: database/embedding tools,
Scripture cache generation, Work contracts/modernized text and audio metadata.
There is no request-time TypeScript or React application.

## Scripture and search indexes

The source Bible JSON is recorded in
[the source repository](https://github.com/jacksonStone/Bible_as_JSON).
The indexer accepts flat verse arrays, a `books`/`chapters` structure, or a map
of Book → Chapter → verse. `data/bible.json` is the normal local source.

```bash
npm run index:bible -- data/bible.json --passage-type paragraph
# After an explicitly requested index change:
npm run update-db:scripture-cache
npm run build
```

Indexing with `OPENAI_API_KEY` requests paid embeddings. The active model and
dimensions are stored in the database; runtime queries read that configuration.
Do not change dimensions for only part of an index. `EMBEDDING_PROVIDER=mock` is
for isolated fixtures, never for replacing production vectors.

Useful explicit indexer flags include `--book`, `--limit`, `--resume`, `--db`,
`--jobs-db`, `--skip-index-rebuild` and `--rebuild-indexes-only`. `--reset` clears
runtime passages; use it only for an intended replacement or disposable fixture.
The job database defaults separately from runtime text/vector storage. For
book-by-book additions, archive the runtime database first, index selected Books
without resetting, and rebuild indexes once after all additions.

`update-db:scripture-cache` sets `CROSS_CANNON_UPDATE_DB=1` and writes the
content-addressed JSON/gzip pair plus `scripture-cache/manifest.json`. The server
streams those artifacts; it never refreshes them during requests or releases.

## Reading translations

WEB passage IDs and stored vectors remain the search identity. MSB is a
Book/Chapter/verse text projection over that identity, shared by reading, result
text and commentary context. Its 66-Book scope falls back explicitly to WEB for
other Books; existing Scripture recordings remain WEB.

`public/scripture-translations/manifest.json` records the pinned public-domain
eBible USFM source and hash. Reproduce the reading assets from that archive with:

```bash
python3 scripts/import-msb.py /path/to/pinned-source.zip
```

Importing reading text creates no embeddings and opens no database. Source
updates are explicit. See [translation research](research/readable-public-domain-bible-translations.md).

## Early Christian Works and Christian Classics

```bash
npm run parse:church-fathers
npm run build:church-fathers-preview
npm run index:church-fathers
npm run import:christian-classics -- --download
npm run index:christian-classics
# Resume vectors without rewriting unchanged source metadata:
npm run index:christian-classics -- --embeddings-only
```

Classics import sources/hashes and rights are recorded under
`data/public-domain/christian-classics/`; see
[source/edition research](research/christian-classics-import-sources.md).
The collection includes Imitation of Christ, Catena Aurea, Henry, Wesley,
Jamieson–Fausset–Brown (1871 one-volume edition), Keil–Delitzsch (Old Testament)
and Spurgeon's Treasury of David (all 150 Psalms).
Wesley's source lacks 2 Samuel 24; preserve that coverage gap.

The three additional commentaries use pinned CCEL ThML and CrossWire zCom4
sources. The importer reads those packages off-server, deduplicates linked verse
records, and preserves OSIS paragraphs, headings, attributions and inline notes.
Treasury's packaged Psalm 119 skips verse 1. Its opening exposition is restored
from printed pages 139–141 in the reviewed `psalm119-opening.json` supplement;
this does not claim to restore every omitted quotation or preaching hint.
Both `Verse` and abbreviated `Ver.` headings supply verse coverage.
The pinned KJV verse table supplies source numbering; it does not replace the
app's Scripture translation. See the [source audit](research/commentary-import-2026-11-17.md).
Their metadata has `searchIndexed: false`: the server retains Book/Chapter
metadata and reads the requested chapter through the existing verse-commentary
and resource routes. The semantic indexer skips them. Browser fragments and native
packages still contain their complete text for reading and offline keyword scans.

Imports preserve original paragraph boundaries, Scripture verse coverage and
quotation markers. Commentary lookup uses overlapping verse coverage. Search
previews omit standalone Scripture quotations; full reading preserves them as
labelled quotations. Do not display internal sentence positions as Bible verses.
Classics use their own `storage/christian-classics.db`; provision that index
separately from application deployment.

Modernization retains exact original text, stable Passage IDs and reviewed
coverage. The assembler rejects missing/duplicate passages and changed source
text. `--replace` deliberately replaces a prior reviewed overlay. Example:

```bash
npm run apply:church-fathers-modernization -- \
  --work anf09:xii.iv \
  --input /tmp/reviewed-batch.json --review /tmp/review.json \
  --audit /tmp/modernization-audit.md
```

For Classics, supply `--book-index public/christian-classics-text/books.json`,
`--work` and `--chapter`, and persist `--overlay` under
`data/public-domain/christian-classics/modernization/`. Then run
`npm run publish:christian-classics-modernization`. Publication emits a new
content-addressed Chapter without changing Passage IDs or vectors; source
imports reapply durable overlays. The
[modernization prompt](church-fathers-modernization-prompt.md) defines editorial
requirements. `modernize:church-fathers` is the explicit provider-backed alternative.

## Audio alignment and continuous recordings

Recordings and alignment are maintained independently from app releases:

```bash
npm run build:church-fathers-audio-alignment -- --work-id npnf101:vi
npm run build:church-fathers-audio-alignment -- --work-id npnf102:iv --book 1 --limit 1 --dry-run
```

`--track`/`--limit` scope work; `--reset` discards the selected Work's existing
alignment. Cached transcripts are reused. The builder downloads selected tracks,
chunks oversized input with ffmpeg and calls transcription only when necessary.
Work-specific matching policies live under `scripts/audio-alignment-policies/`;
source URLs and track lists live in
`data/public-domain/church-fathers/audio-sources.json`.

The playback contract is `audioUrl`, `startSeconds` and `endSeconds` in each
Chapter's alignment. Labels and Chapter names are descriptive; do not infer
matching timestamps from them. See [audio sources and research](church-fathers-audio-research.md).

Continuous AAC files provide Book-level playback with Chapter timestamps:

```bash
npm run build:continuous-audio -- --bible
npm run build:continuous-audio -- bible-genesis fathers-npnf102-iv
npm run verify:continuous-audio
scripts/sync-continuous-audio.sh
```

The builder needs ffmpeg, curl and source recordings/URLs. It preserves original
recordings and checksums before conversion; `AUDIO_BACKUP_DIR` chooses the backup
snapshot and `AUDIO_ENCODER=aac_at` selects Apple's encoder. PCM sample counts
determine offsets. Generated files live in `storage/audio/continuous/`, with
content-addressed names referenced by `public/continuous-audio.json`.

Upload derived recordings before releasing their manifest. Ordinary deploys
package neither recordings nor backups. Removing manifest entries and redeploying
returns new playback sessions to original recordings without an index/cache
rebuild. Existing sessions retain their current source until restarted.

## Kindle exports

```bash
npm run export:kindle:bible
npm run export:kindle:first-clement
```

Generated EPUBs go under ignored `exports/kindle/` for Send to Kindle. The Bible
uses `data/bible.json`, the public-domain Sinai Christ Pantocrator cover, a
Book-level table of contents and Chapter grids. First Clement includes its
reviewed modernization with changed words marked. Override the Bible paths with
`--input`, `--cover` and `--output`; exports modify no index or runtime account data.
