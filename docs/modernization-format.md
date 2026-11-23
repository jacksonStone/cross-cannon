# Durable modernization overlays

`scripts/classics_modernization.py` owns encoding, source validation, expansion
and application. Authoring batches and frozen review evidence can retain their
full original/modernized text. Durable overlays under
`data/public-domain/christian-classics/modernization/` store only exact changes.
The publisher and importer expand them against an existing immutable Chapter.
Published reading assets and their Rust/browser loaders keep their existing format.

## Format 2

Each file is compact UTF-8 JSON with a single trailing newline. Top-level keys
appear in the following order:

```json
{"format":2,"workId":"classics:example","chapterId":"classics:example:1","sourceSha256":"<64 hex digits>","resultSha256":"<64 hex digits>","reviewedSegments":2,"legacyLayout":"work-first","edits":[[1,[[3,3,"new"]]]]}
```

An edit is `[segmentNumber, operations]`; an operation is
`[originalByteOffset, deletedByteLength, insertedText]`. All offsets address the
same original UTF-8 string, before any operation is applied. Operations are in
increasing order and cannot overlap or split a Unicode code point. For example,
`[3,3,"new"]` turns `é old 😇.` into `é new 😇.`. The accent occupies two bytes.
An omitted segment retains its exact original text. Segment numbers need not be
consecutive. Zero edits is a complete reviewed Chapter with no textual changes;
an absent overlay is not evidence of review. Partial review remains in the
existing progress records rather than a complete-Chapter overlay.

Source and result hashes are SHA-256 over ordered arrays of
`[segmentNumber, text]`, serialized with Python
`json.dumps(records, ensure_ascii=False, separators=(',', ':')).encode('utf-8')`,
without a trailing newline. There is no Unicode or whitespace normalization.
The source hash pins unchanged segments, numbering and order as well as edited
text. The result hash pins the complete expanded modernized text. The explicit
reviewed segment count must equal the source Chapter count. The decoder rejects
unknown formats/fields, stale sources, duplicate or unknown segments, invalid
spans, empty modernizations and incomplete/corrupt results before applying any
change. Publication retains its existing trimming of modernized text.

## Review identity and migration

`legacyLayout` is `work-first` or `chapter-first`. It preserves the historical
order of the `workId` and `chapterId` keys when reconstructing a legacy overlay,
followed by `entries`. Each entry has `verse`, `originalText`, `modernizedText`
in that order. Legacy approved bytes use `json.dumps(overlay, ensure_ascii=False,
indent=2)` with one trailing newline. The existing corpus uses these two layouts.

Review checks reconstruct those exact legacy bytes and compare their SHA-256
with the existing independent approval receipt. They do not trust a claimed old
hash in the compact file. New approvals can instead pin the exact canonical
compact file bytes. Formatting of compact files is canonical and validated
on load. Changed text cannot pass an old approval simply by updating its result
hash. Frozen receipts, drafts and quotation evidence remain intact.

```bash
npm run compact:christian-classics-modernization             # dry run
npm run compact:christian-classics-modernization -- --write  # convert
```

The command also accepts `--root <checkout>` for an integration worktree. It
preflights every overlay against the catalog and proves exact expanded entries
and approved bytes before replacing any file. Unrecognized historical formatting
is refused rather than silently assigned a new approval identity. Each replacement
is atomic and preserves permissions. Both formats remain readable, so a stopped
conversion can resume; another conversion of complete compact files writes nothing.
Use one writer at a time. The command neither publishes nor touches databases.

New overlays produced by `apply:church-fathers-modernization -- --overlay ...`
use the shared Python encoder. Full-text editorial batches remain accepted,
and generated audit documents still show both versions for review.
