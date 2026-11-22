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
other Books. Playback uses the selected translation: WEB retains its existing
continuous recordings; MSB streams the chapter recordings published by
[MajorityBible.com](https://majoritybible.com/index.html) at OpenBible.com.
`public/scripture-translations/msb-audio.json` pins the 66 Book filename prefixes
and complete 1,189-Chapter coverage checked against the publisher's directory.
MSB playback never falls back to a different translation. Changing translation
replaces active Scripture playback; paused playback restarts in the new translation
on the next Play. Optional offline audio downloads currently contain WEB recordings.

Download the complete MSB recordings and index only their eight-second openings:

```bash
npm run prepare:msb-audio -- --download-only
npm run prepare:msb-audio
```

The recordings stay unchanged under ignored `storage/audio/MSB/`. On localhost,
browser playback uses `/audio/msb/` and the Rust server serves these copies with
byte ranges; missing copies redirect to the publisher. Hosted playback retains
the publisher URL. Shared playback uses
`public/msb-audio-offsets.json` to start at the word-ending timestamp of “Audio
Bible,” preserving the book/chapter announcement. This minified map contains only
chapter IDs and offsets in seconds, for example `{"Genesis:1":2.46}`. Fetch it at
`/msb-audio-offsets.json`; prebuilt Brotli/gzip encodings and five-minute HTTP
caching keep transfers small. Detailed transcripts and provenance remain in
`public/scripture-translations/msb-audio-offsets.json`. Uncertain offsets remain null
and play from zero; `docs/research/msb-audio-offset-review.md` lists them.
No silence or extra padding is required after the phrase. Missing or conflicting
word timings remain on the review list without another API call.

Preparation uses eight download workers and four transcription workers by default
(`--jobs` and `--transcription-jobs`). `--limit` scopes an initial trial without
discarding other indexed chapters. It requires curl, ffmpeg, ffprobe, and
`OPENAI_API_KEY` for transcription. Only decoded mono WAV windows contained in the
first eight seconds are uploaded; full recordings never go to transcription. The existing timestamp-capable
`whisper-1` API costs $0.006/minute: 1,189 × 8 seconds is approximately $0.9512.
It is deprecated with a scheduled February 26, 2027 shutdown; this explicit
maintenance tool uses it for word timestamps, which the cheaper mini model does
not supply. See [OpenAI pricing](https://developers.openai.com/api/docs/pricing#transcription-and-speech)
and [timestamp support](https://developers.openai.com/api/docs/guides/speech-to-text#timestamps).

Every download receipt, source checksum, raw transcript, offset, and API cost
reservation is saved atomically under `storage/audio/MSB/.work/`. The aggregate
offset/review files refresh after every chapter. Rerun the same command to resume;
completed chapters use their cached results, including uncertain ones. Interrupted
uploads without saved responses require review and are never silently retried.
Use `--reanalyze` to apply updated matching rules to cached transcripts without
making any transcription requests.
`--retry-with-context` gives older uncertain transcripts one explicit retry with
the current recording context; both transcript variants remain cached. The prompt
describes an English chapter recording and its announcements without supplying the
target phrase or chapter text. Already completed current-context results are reused.
The SDK has automatic retries disabled; `--retry-errors` explicitly retries failed
or interrupted requests, while `--max-cost` defaults to a cumulative $1.25 cap
including all recorded request attempts. It is a duration-based estimate, not a
provider billing receipt. No database, embedding, or deployment task is involved.

Retry the saved review cohort with an intro-focused transcription pass:

```bash
npm run prepare:msb-audio -- --retry-review --transcription-jobs 6 --max-cost 1.50
```

This round snapshots its chapter IDs and previous results in
`storage/audio/MSB/.work/intro-focus-v2-session.json`. Each request keeps time zero
and ends in the long gap after the chapter heading when one is detectable, never
after the eighth second. A dictionary-style prompt names Audio Bible, the book,
and chapter. Original transcripts stay intact under their original filenames;
retry clips, responses, and pending requests have separate profile names.
Confidence is evaluated only on the introduction, so later verse/silence errors
do not invalidate a confident opening. A high no-speech score alone does not
reject a good decode. The matcher compares all cached word-ending timestamps:
it retains usable older evidence when a retry is worse and flags
conflicting boundaries rather than selecting one. Previously confirmed chapters
outside the cohort are preserved. Repeating this command resumes the same round
without sending its completed requests again. Add `--reanalyze` to recompute
that cohort using only its cached responses.

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
