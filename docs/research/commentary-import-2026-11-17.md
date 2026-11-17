# JFB, Keil–Delitzsch and Treasury of David import

Requested 2026-11-17. Adds three commentaries to Christian Classics; leaves
Henry, Wesley, Catena and Imitation identities and reviewed overlays intact.

## Sources

Exact download URLs, SHA-256 hashes and rights declarations are recorded in
[`sources.json`](../../data/public-domain/christian-classics/sources.json).
Raw sources remain ignored local authoring inputs. Reproduce text with
`npm run import:christian-classics -- --download`; this does not open a database.

| Work | Pinned source | Chapter coverage |
| --- | --- | --- |
| Jamieson–Fausset–Brown | CCEL ThML XML, 1871 one-volume text, expanded electronic edition by Ernie Stefanik; metadata explicitly Public Domain | 66 books, 1,189 chapters |
| Keil–Delitzsch | CrossWire **KD 2.0**, 2022-08-03; UTF-8 OSIS, ZIP/KJV zCom4; module configuration explicitly Public Domain | 39 OT books, 929 chapters |
| Treasury of David | CrossWire **TDavid 2.1**, 2022-06-05; Spurgeon Archive transcription, UTF-8 OSIS, ZIP/KJV zCom4; explicitly Public Domain; Psalm 119:1 exposition supplemented from print | 150 Psalms, including Psalm 119 |

[JFB electronic edition](https://www.ccel.org/ccel/jfb/jfb/JFB00H.htm),
[KD source catalog](https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=KD),
[Treasury source catalog](https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=TDavid).
The KD module's current configuration identifies Wikisource as its text source;
its older About paragraph still mentions a BibleWorks edition. Preserve this
distinction rather than presenting the older description as the current source.
Historical English translators are not reliably named by that package, so the
import does not invent a translator attribution.

## Coverage and source peculiarities

- JFB has book introductions and additional divisions that repeat chapter
  identities. Merge those into the appropriate chapter rather than duplicating
  chapter IDs. Retain book introductions with chapter 1. Only `scripCom` sets verse
  coverage; references cited inside a paragraph do not. Five `scripCom` markers
  occur inside paragraphs: beginning markers apply to that paragraph, trailing
  markers apply to the following paragraph.
- A zCom4 record can be linked to several verses. Decode once per chapter,
  retaining the linked range, rather than repeating the same explanation at
  every verse. Book introductions are retained at chapter 1 without a verse map.
- KD sometimes files a note on verses 1–3 at verse 3 (Psalm 23). Use a valid
  leading source reference to recover 1–3. Some upstream OSIS endpoints transpose
  chapter/verse, such as `2Sam.22.5-2Sam.7.5`; in those cases retain the correct
  linked KJV index range. Do not interpret later cross-references as coverage.
- Treasury stores a whole Psalm at verse 1. Its own numbered verse headings set
  paragraph coverage, including `Ver.` abbreviations, with section headings resetting coverage. Quoted authors
  and preaching hints remain in the text. Invalid source labels (Psalm 13's
  “Verse 8”, Psalm 92's “Verses 14–16”) and noncontiguous labels remain readable
  without an invented continuous verse match.
- The packaged Psalm 119 jumps from its introduction to verse 2. A reviewed
  transcription of the verse 1 exposition on printed pages **139–141** restores
  Spurgeon's own explanation. The source PDF is pinned in `sources.json`, and
  `psalm119-opening.json` records the scope and checked text. This does not claim
  to recover every omitted quotation or preaching hint from the printed edition.
  The printed page images were visually checked, rather than importing raw OCR.
- OSIS paragraph milestones, headings, table rows, Hebrew/Greek text and inline
  footnotes are retained. Whitespace inside XML is not itself a paragraph break.
  Full text remains historical English; this task does not modernize it.

## Capacity measurements

Before import, a single local release Rust server reached **860,733,440 bytes**
peak RSS through startup and a health request. With the first complete import,
the same executable reached **1,134,936,064 bytes**, a **261.5 MiB increase**.
These are macOS comparisons, not a Linux peak guarantee. Production's service
cap is **1,200 MiB**; its observed peak before this import was **1,108,447,232
bytes** (about 1,057 MiB). Adding the measured delta would exceed that cap.

Read-only production inspection found **1,905 MiB physical RAM**, **613 MiB
available**, **424 MiB host swap used**, **198 MiB service swap**, and **3.2 GiB
free disk**. This initially suggested a RAM increase under the preload-everything
design. The user clarified that these commentaries need direct verse lookup,
not new semantic indexes. The implementation now avoids their resident text
entirely: `metadata.searchIndexed: false` keeps only their Book/Chapter metadata
in `Library::load_server`, and the existing resource/commentary routes read a
requested chapter from disk. Native/build loaders retain the complete texts.
No instance, volume or service-limit changes were made.

The final metadata-only release server reached **845,152,256 bytes** peak RSS
while checking Psalm 23:1, Matthew 11:28 and Psalm 119:1 and opening the returned
chapter resources. This is comparable to the **860,733,440-byte** original
startup baseline; it does not show the former 261.5 MiB preload increase. The
health endpoint has **498 Books, 315,170 resident Passages and 23,896 vectors**:
three additional Books, with resident text and vector counts unchanged. These
local macOS results support keeping the existing EC2 size for this addition.

For existing indexed works, the runtime loads reading text and **chapter-level**
commentary vectors in RAM.
Passage vectors remain in SQLite and are read during refined searches; a large
index on disk does not imply loading every passage vector into memory. Source
ZIP download sizes do not measure either runtime memory or search DB size.

The expanded native package serializes to **613,805,104 bytes** before compression
and about **75.9 MB** after zstd compression. This legitimately exceeds the old
512 MiB decoder ceiling. The full-library decoder now retains a **768 MiB**
bounded expansion limit, and the lossless round-trip test budgets **90 MB** for
the compressed seven-Classics package. Browser reading still uses the compact
identity index and chapter fragments.

| Added Work | Chapters | Words (whitespace count) | Sentence passages |
| --- | ---: | ---: | ---: |
| JFB | 1,189 | 1,885,567 | 33,220 |
| Keil–Delitzsch | 929 | 4,357,027 | 47,733 |
| Treasury of David | 150 | 2,149,798 | 44,788 |

Total: **2,268 chapters, 8,392,392 words, 125,741 reader passage groups**. These are
counts of this imported digital text, not estimates from printed page counts.

## Validation and publication

Text-source coverage, linked records, source-derived ranges, paragraph boundaries,
Unicode and Psalm 119 are covered by importer regression tests. The native
catalog and shared Rust artifact checks include all seven Classics / 4,848
chapters. The existing search DB is unchanged. An initially started embedding run
used an isolated database copy; it was stopped after the user's clarification and
was never activated or published. The semantic indexer now skips these Works.
Publishing them requires only static text/browser artifacts and the Rust server,
without a new search DB, embeddings, or schema migration.

Final local validation passed: 11 importer tests, 2 native catalog tests, 6 shared
core tests, 36 API/account tests, TypeScript checks, and the standard production
build/browser/HTTP/resource/account checks. The browser build was retried after
concurrent reader edits changed its input fingerprint; the final build and all
remaining verification phases passed. Direct HTTP checks found and opened all
three new Works at Psalm 23:1 and Psalm 119:1, plus JFB at Matthew 11:28. The
previous four Works' catalog entries remain byte-for-byte equivalent as JSON.
Production publication uses the standard `npm run ship` release path.
