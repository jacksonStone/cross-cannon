# Christian Classics import sources

Audited 2026-11-11 against publisher catalogs, raw downloadable files, and source-maintainer metadata. These findings concern the exact digital editions below. The underlying historical English texts are public domain in the United States; the explicit source grants below also resolve reuse of their electronic transcriptions. Full raw downloads inspected in `/tmp/classics-*`; application data has not been changed by this research.

## Recommended sources

| Work | Exact machine-readable download | Reuse evidence | Expected text structure |
| --- | --- | --- | --- |
| The Imitation of Christ, Thomas à Kempis, William Benham translation | [Gutenberg HTML](https://www.gutenberg.org/cache/epub/1653/pg1653-images.html), [UTF-8 text](https://www.gutenberg.org/cache/epub/1653/pg1653.txt) | [Gutenberg ebook 1653 catalog](https://www.gutenberg.org/ebooks/1653) identifies Benham and explicitly marks this edition public domain in the USA. The file includes Gutenberg license/trademark terms. | Four books, 114 chapters: 25 + 12 + 59 + 18. HTML book headings have anchors `book01`…`book04`; chapter headings are `h3` with anchors `chap01`…`chap114`, restarting Roman display numbering per book. |
| Matthew Henry's Complete Commentary on the Whole Bible | CCEL [mhc1.xml](https://www.ccel.org/ccel/h/henry/mhc1.xml), [mhc2.xml](https://www.ccel.org/ccel/h/henry/mhc2.xml), [mhc3.xml](https://www.ccel.org/ccel/h/henry/mhc3.xml), [mhc4.xml](https://www.ccel.org/ccel/h/henry/mhc4.xml), [mhc5.xml](https://www.ccel.org/ccel/h/henry/mhc5.xml), [mhc6.xml](https://www.ccel.org/ccel/h/henry/mhc6.xml) | **Each inspected XML file** has `DC.Rights`: “Public domain. May be copied and distributed freely.” All identify Logos, Inc. as source; unabridged and carefully proofed. [CrossWire MHC catalog](https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=MHC) independently marks its CCEL/Logos-derived edition Public Domain. | Six volumes, 66 Bible books, **1,189 chapter divisions**. Each book is a `div1`, each chapter a `div2` titled `Chapter <Roman>`. Volume chapter counts: 187 / 249 / 243 / 250 / 89 / 171. |
| John Wesley's Notes on the Bible | [CCEL notes.xml](https://www.ccel.org/ccel/w/wesley/notes.xml) | Raw XML `DC.Rights` explicitly says Public Domain, also confirmed by [CCEL's older edition index](https://ccel.org/w/wesley/notes/index.html). [CrossWire Wesley catalog](https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=Wesley) explicitly marks its corresponding Sulu Kelley/Bill Brown-derived module Public Domain. | NT then OT; book `div2`, chapter `div3`, often nested introduction/commentary `div4`. **1,188 identifiable Bible chapters after repairing markup; 2 Samuel 24 is absent.** Preserve this coverage limitation in metadata. See anomalies below. |
| Catena Aurea, Thomas Aquinas | [Pinned OSIS XML](https://raw.githubusercontent.com/Isidore-Guild/catena/aebb0f6b2b313fd3732dab9b7f28714fbe967f40/catena.xml), [live source](https://raw.githubusercontent.com/Isidore-Guild/catena/master/catena.xml) | [CrossWire Catena catalog](https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=Catena) identifies the Newman 1842 translation, compilation and scan checking by Tom Lemmens, Public Domain distribution. Its linked [source repository README](https://github.com/Isidore-Guild/catena) describes the sources, and its [CC0 license](https://raw.githubusercontent.com/Isidore-Guild/catena/master/LICENSE) releases electronic work and a separately translated John preface. | Four Gospel books (`Matt`, `Mark`, `Luke`, `John`), **89 chapters** (28/16/24/21). **821 commentary passage blocks** (283/108/244/186). OSIS namespace; chapters contain `div annotateType="commentary" annotateRef="Matt.1.3-Matt.1.5"`. |

These are full works rather than preview excerpts, subject to the explicitly identified Wesley source gap. The Catena source includes prefaces in addition to all Gospel commentary; the short John preface is Tom Lemmens's modern CC0 translation, not Newman's historical English translation. Either preserve and label that distinction or omit the prefaces consistently.

## Parser reuse and structural anomalies

Reuse text extraction, sentence splitting, normalization, and output chapter/verse types from `scripts/parse-church-fathers.py`, with source-specific structural adapters. Do not apply its complete leaf-division/work-selection rules unchanged: layouts differ materially.

### Henry

- Structural divisions are `div1` and `div2`; bare `div class="Center"` is a formatting wrapper. Treating every bare div as a content division loses book/chapter context.
- The six `div1` book counts are 5 / 12 / 5 / 17 / 4 / 23. Exclude title pages, volume prefaces, indexes; preserve historical book introductions if desired.
- Not all chapters have a clean chapter-level `scripCom`, so infer chapter identity from the containing Bible book and Roman chapter title. Counting only clean chapter references undercounts the complete edition (1,184 vs 1,189).
- `scripCom osisRef="Bible:Gen.1.1-Gen.1.2"` marks commentary passage ranges; `scripRef` denotes a reference cited within the discussion. Do not interpret cited references as the passage being commented on.
- Source text also quotes the biblical passage. Preserve this as source text or distinguish scripture paragraphs; do not silently remove ordinary commentary paragraphs that quote Scripture.
- Volume IV uses empty `scripCom` siblings immediately before `div class="Commentary"`, rather than the enclosing `Bible:<range>` divisions used elsewhere. The importer now associates each marker with its following block, recovering the 250 previously unmapped chapters. All 1,189 Henry chapters have verse coverage; introductory paragraphs remain unassigned where the source supplies no range.
- Classics sentence records retain `sourceParagraph` alongside their stable synthetic sentence positions. Search result display reconstructs complete source paragraphs and labels them with Scripture coverage. Synthetic positions remain navigation/index identifiers and must not be displayed as Bible verse references. This repairs excerpts such as Henry on Proverbs 16:1, previously labeled `16:4-6` and starting with the detached end of `Ps. x. 17.`.

### Wesley

- Most chapters are `div3` headed by Roman numerals; Psalms uses Arabic headings; Obadiah is `Commentary on Obadiah`.
- The source has only 1,162 clean chapter-level `scripCom` markers. This is a markup count, not complete chapter count.
- **Proverbs 11–30 are present as text but lack chapter divisions.** They appear inside Proverbs X's commentary `div4` as plain paragraphs containing only Roman numerals. Split before these 20 paragraphs, creating proper chapter identities. Example: `<p id="ii.xxi.xi.ii-p19">XI</p>` followed by the note on 11:1. The final XXXI resumes a normal div3.
- Leviticus XXVII is present without a chapter-level marker. Single-chapter books sometimes lack chapter-level markers too.
- **2 Samuel ends at XXIII in this edition.** No text for chapter 24 was found. The explicitly PD CrossWire module has the same gap, so changing format alone does not repair it. Do not fabricate text or claim 1,189 chapter completeness. The source is still useful if this one known gap is displayed in edition information.
- Paragraph-leading verse numbers are source verse references, not synthetic reader sentence numbers. Preserve them as metadata when implementing commentary alongside Scripture.
- Historic HTML conversions have other reuse restrictions (e.g. Art Middlekauff's conversion notice); this does **not** override the explicit PD grant in the separately downloadable ThML edition. Use the inspected raw file, not an arbitrary mirror's HTML.

### Catena

- Ignore the `canonical="true"` book attribute in this upstream commentary file: Catena remains Christian Classics, not canonical Scripture.
- Keep the namespace explicit: `http://www.bibletechnologies.net/2003/OSIS/namespace`.
- A commentary block identifies the Bible passage in `annotateRef`; paragraph `hi type="bold"` identifies an attributed Father; `reference osisRef` gives citations inside the paragraph. Preserve attribution text.
- The pinned upstream XML contains **one unmatched closing paragraph tag**, at source line 14982 in the Mark preface. Strict ElementTree parsing fails. An exact, audited repair is safe and leaves the text unchanged:

  ```python
  text = text.replace(
      'saying, My God shall be my strength. And he said, &amp;c.</p>\n</p><p>',
      'saying, My God shall be my strength. And he said, &amp;c.</p>\n<p>',
  )
  ```

  After this one replacement, the complete file passes Python ElementTree parsing. Require exactly one occurrence for this pinned revision; avoid broad recovery parsing that could drop text silently.
- CCEL's own Catena XML has no specific PD grant (`DC.Rights` empty), and [CCEL general policy](https://www.ccel.org/about/copyright.html) requests permission for republication. The explicitly CC0/PD CrossWire-linked transcription avoids that uncertainty. Also, CCEL incorrectly labels the translator William Whiston; do not copy that metadata.

### Imitation

- Remove Gutenberg wrapper/navigation material from displayed reading text while preserving ebook identity and source/license provenance. [Gutenberg license information](https://www.gutenberg.org/policy/license.html) addresses trademark use and plain public-domain text reuse.
- Book headings use `h2`, chapters `h3`, and chapter subtitles `h4`. Footnotes are source references; keep them separate from prose where possible.
- The source contains an introductory note before the four books. Count the 114 actual chapters independently from that introduction.

## Download integrity observed

SHA-256 of the exact downloaded bytes at audit time (preserve these alongside retrieval/source provenance):

```text
imitation.html 9a789b8215bb406288d57cff59051dc4798eb86d9979c6d99480154fa1845b27
catena.xml    b5de1fbb27455de1d016642db269dd03fd65b257b63859570ceea4ac0bb7c223
wesley.xml    c4534a8964bb8900256ade116209e2bb114caab6100b098b20bf68b682e3fdce
mhc1.xml      6eb946647f806f46129001f83013d65c51e40ac59b939ac1c51404aa50375971
mhc2.xml      673fcb4168ad946ab1e6923c0e331cc61e4adca4498fc0ee34cf1507285aa2f7
mhc3.xml      8ba9779eba5d326acbfc9acaccf2ea1fa2d6b5c48b03ab86fc5e80b0bfa5b17e
mhc4.xml      7b6ea0800caa1daab6b0c807f5b95c7567fb5d880290bbe91d848048a80486b2
mhc5.xml      8b0853b116e9a68215a594bafe29f45502d4c766e1f128cbf5fb050f45cf2518
mhc6.xml      296195d09d4fbb1e7516ea77c100dbc87ce37542c3109f9f570c3cf155b594c1
```

The source XML files themselves are roughly 7.5–12.8 MB per Henry volume, 7.6 MB for Wesley, and 6.5 MB for Catena; avoid loading the entire corpus into every browser response.

## Fallback packages

- Explicitly PD SWORD packages: [MHC.zip](https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/MHC.zip), [Wesley.zip](https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/Wesley.zip), [Catena.zip](https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/Catena.zip).
- These are indexed/compressed modules, not raw XML. Prefer the sources above for straightforward source-preserving conversion.
- Wesley's package uses `ModDrv=zCom`, `SourceType=ThML`, ZIP compression by book. [CrossWire's implementation](https://github.com/bibletime/crosswire-sword-mirror/blob/master/src/modules/common/zverse.cpp) describes `.bzs` 12-byte little-endian block records and `.bzv` 10-byte verse records. Python `zipfile`, `struct`, and `zlib` suffice to inspect it if needed; no external package installation is required.
