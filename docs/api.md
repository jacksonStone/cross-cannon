# Search and resource API

The unified Rust server exposes these routes on its primary listener
(`http://127.0.0.1:3005` locally) and optional compatibility listener. Production
uses `https://www.crosscanon.com`.

```bash
curl http://127.0.0.1:3005/r/api/health
curl http://127.0.0.1:3005/r/api/books
curl http://127.0.0.1:3005/r/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"fear and comfort","mode":"keyword","corpus":"scripture","limit":10}'
```

`POST /r/api/search` accepts:

| Field | Contract |
| --- | --- |
| `query` | Theme or keyword text, at most 2,000 characters |
| `sourceId` | Existing Passage ID for similarity, instead of `query` |
| `mode` | `keyword` (default) or `semantic`; `sourceId` always uses stored vectors |
| `corpus` | `scripture`, `early-christian`, `christian-classics`, or omitted |
| `canon` | `protestant` (default), `catholic`, or `orthodox` |
| `books` | Optional existing Book/Work IDs, at most 100 |
| `authors` | Up to three existing authors for semantic Work searches |
| `web` | `true` requests refined display metadata; requires one semantic target corpus |
| `limit` | Integer 1–100, default 10 |

Responses contain `mode`, `elapsedMs`, `results` and optional selected `source`.
The compact result contract returns Passage IDs, Chapter IDs, references, corpus
and scores. `web:true` adds Scripture verse highlights or the best matching
Work paragraph per Chapter, preserving indexed source IDs. Display text comes
from original imported passages; no generated commentary is returned.

Keyword and cosine scores are different measures. Similarity reuses existing
stored paragraph/verse vectors without a provider request. Theme search embeds
only the new query using the indexed model/dimensions; missing provider
configuration returns an explicit 503. Cross-Collection similarity requires
matching embedding configurations. Search accepts 16-KiB bodies, four concurrent
requests and at most 30 paid query embeddings per minute globally.

Legacy URLencoded/multipart form POSTs at `/`, `/church-fathers` and
`/christian-classics/read` retain their validation, 5–40 match count, canon/Book/
author scopes, calibrated match strength and source/result fields. They share
a five-request-per-minute IP budget. Successful form responses include
`X-Cross-Canon-Search: rust`. These call the same Rust search path.

`GET /api/classic-commentary?book=John&chapter=3&verseStart=16&verseEnd=16`
returns original commentary Work/Chapter metadata whose source verse coverage
overlaps the selection. Quotation-only Scripture blocks are excluded; this is
coverage lookup, not semantic search.

Public immutable text routes and original/continuous audio support GET and
HEAD. Audio retains existing byte ranges, with bounded file streaming. Existing
`/r/api/resources/` resource aliases remain valid. Browser assets negotiate
prebuilt Brotli/gzip representations, use representation-specific ETags and
serve content-addressed files immutably; mutable release metadata revalidates.

Search CORS is isolated to the public API. Account/progress/study/native-login
routes have separate authentication, same-origin and private-cache policies;
see [Google login](google-login.md) and [personal study](personal-study.md).
