# Readable public-domain English Bible options

Research date: 2026-11-12. Scope: credible additions to Cross Canon's existing World English Bible, emphasizing ordinary reading. Public domain/CC0 is distinguished from merely free access. Readability recommendations below are editorial judgments, not measured reading levels or claims of superior translation accuracy.

User's subsequent constraint: recommend only complete Old and New Testament translations. OEB and NT-only historical translations are excluded from the active shortlist. Complete here means 66-book coverage, not the app's expanded Catholic/Orthodox book scopes.

## Complete-translation shortlist

| Translation | Coverage and reuse | Fit for Cross Canon |
| --- | --- | --- |
| **Berean Standard Bible (BSB)** | Complete 66-book Bible. Official terms dedicate Berean texts to the public domain as of April 30, 2023, linking to CC0; all uses permitted, attribution appreciated rather than required. | **First addition to evaluate:** contemporary phrasing, a complete alternative to WEB, and clean official developer downloads. |
| **New Heart English Bible (NHEB)** | Official PDF's indexed front matter explicitly dedicates it to the public domain; its contents list the 39 OT and 27 NT books. No deuterocanon appears in that edition. | A credible modern option, but its stated adaptation from WEB means less independent stylistic breadth than the name alone suggests. Verify and pin the obtainable edition before importing. |
| **Majority Standard Bible (MSB)** | Complete 66-book Bible; BSB OT plus Byzantine Majority NT, under the same explicit Berean public-domain terms. | Similar reading voice to BSB; primarily a textual-tradition choice rather than an independent stylistic option. |

Sources: [BSB terms](https://berean.bible/terms.htm), [BSB downloads](https://berean.bible/downloads.htm), [NHEB official PDF](https://nheb.net/files/NHEB.pdf), [OEB official project](https://openenglishbible.org/).

## BSB

The official download page offers current full-Bible text, XLSX, USFM, USJ, USX, and EPUB, plus translation tables in XLSX/TSV. The terms permit commercial use and adaptations; the project requests that altered texts use a different name. Preserve a pinned source version and attribution in edition metadata. [Downloads](https://berean.bible/downloads.htm), [Terms](https://berean.bible/terms.htm)

The 66-book coverage does not supply Catholic/Orthodox deuterocanonical books. Keep WEB available for those books rather than presenting missing books as a search failure. [BSB book list](https://ebible.org/engbsb/)

## NHEB

The indexed official PDF identifies a May 31, 2025 update. Its foreword calls NHEB an adaptation of WEB and describes revised Hebrew/Greek base texts; this is more than a renamed WEB edition, but remains in the same translation family. Its public-domain declaration is explicit, although the publisher's following sentence describes publishing the unchanged text. [Official front matter and contents](https://nheb.net/files/NHEB.pdf)

**Retrieval limitation:** during this research the project homepage rendered almost empty, the main PDF could not be parsed through the web tool, and older PDF variants returned 404. The evidence above comes from indexed extracts of the official PDF. An eBible NHEB edition was not verified. Do not treat an unverified third-party module as the authoritative current text. Recheck downloadable source and edition identity before implementation. [Project](https://nheb.net/)

## OEB

The release is genuinely incomplete: eBible's current contents list Genesis, Joshua, Ruth, Esther, Psalms, the twelve Minor Prophets, and the complete NT—44 books. No deuterocanonical books are listed. US and Commonwealth spellings are available, including USFM source downloads. [Current contents](https://ebible.org/engoebus/), [Official releases](https://openenglishbible.org/)

Its preface describes modernizing older public-domain translations against public-domain source texts; the NT develops the Twentieth Century New Testament. CC0 permits reuse and adaptation; changing the name or disclosing alterations is requested rather than a license condition. [Official release preface](https://openenglishbible.org/oeb/2025.6/OEB-2025.6-US.html)

## Other options worth distinguishing

- **Majority Standard Bible:** complete 66-book alternative with the BSB OT and a Byzantine Majority Text NT. It shares Berean's explicit public-domain terms and is described as stable. Useful if textual tradition is a deliberate option; less additional stylistic breadth after BSB. [Official project](https://majoritybible.com/), [Terms](https://berean.bible/terms.htm), [Book list](https://ebible.org/engmsb/)
- **WEB Updated:** public-domain modern English, including the deuterocanon in the full edition; uses LORD/GOD for the divine name rather than classic WEB's Yahweh. A possible edition refresh, rather than a distinct new translation family. [Edition and downloads](https://ebible.org/details.php?id=engwebu), [Complete contents](https://ebible.org/engwebu/)
- Historical KJV/ASV/Douay editions do not answer the main contemporary-readability goal. Weymouth is an NT-only historical option. BBE is excluded from the strong shortlist pending exact edition/jurisdiction verification. These exclusions are scope decisions, not blanket statements about reuse rights.

Recommendation: evaluate **BSB first**, retain WEB for existing broad-canon coverage, and sample NHEB before prioritizing it. MSB is another complete option if textual tradition matters. A small comparison using narrative, poetry, epistles, and difficult OT passages will establish the desired reading voice more reliably than marketing descriptions.

## Verified reading samples: Philippians 4:11–12

BSB:

> I am not saying this out of need, for I have learned to be content regardless of my circumstances. I know how to live humbly, and I know how to abound. I am accustomed to any and every situation—to being filled and being hungry, to having plenty and having need.

[BSB text](https://ebible.org/engbsb/PHP04.htm)

NHEB:

> I'm not saying this because I am in need, for I have learned to be content in any circumstance. I know what it is to be in need, and I know what it is to have a lot. In any and all circumstances I have learned the secret, whether full or hungry, whether having a lot or being in need

[NHEB text](https://biblehub.com/nheb/philippians/4.htm), a verified accessible reading copy with explicit public-domain attribution. This resolves reading-sample access, but does not establish a pinned authoritative bulk download. Verse 12 has no terminal punctuation in this displayed source.

MSB:

> I am not saying this out of need, for I have learned to be content regardless of my circumstances. I know how to live humbly, and I know how to abound. In any and every situation I have learned the secret of being filled and being hungry, of having plenty and having need.

[MSB text](https://biblehub.com/msb/philippians/4.htm)

## Comparison against Cross Canon's current WEB

Checked the actual active artifact `scripture-cache/98c414bddc31ea96.json` on 2026-11-12, rather than assuming it exactly matches every current online WEB revision.

- Philippians 4:11: “Not that I speak because of lack, for I have learned in whatever state I am, to be content in it.” BSB/MSB and NHEB express the same thought in different English; the samples above illustrate the style differences.
- Matthew 17:21 is present: “But this kind doesn’t go out except by prayer and fasting.” MSB retains verse 21; BSB puts this reading in a footnote and skips from verse 20 to 22 in its main text; NHEB's displayed main text also skips verse 21. [BSB](https://biblehub.com/bsb/matthew/17.htm), [MSB](https://biblehub.com/msb/matthew/17.htm), [NHEB](https://biblehub.com/nheb/matthew/17.htm)
- 1 Timothy 3:16 has “God was revealed in the flesh” in the current WEB cache. MSB has “God appeared in the flesh”; BSB has “He appeared in the flesh”; NHEB has “He was revealed in the flesh.” The BSB/MSB footnotes explicitly identify the God/He difference as a textual variant. [BSB](https://biblehub.com/bsb/1_timothy/3.htm), [MSB](https://biblehub.com/msb/1_timothy/3.htm), [NHEB](https://biblehub.com/nheb/1_timothy/3.htm)

WEB describes its NT as generally using the Byzantine Majority Text, while retaining some ASV decisions; MSB explicitly uses the Robinson-Pierpont Byzantine Majority Text. That supports describing MSB as closer to WEB's general NT textual tradition, not promising identical verse coverage or wording. [WEB FAQ](https://ebible.org/eng-web/webfaq.htm), [MSB project](https://majoritybible.com/)

Normal chapter/verse references usually align. The concrete Matthew example shows that an omitted main-text verse does not cause the remaining chapter to be renumbered. These examples establish that the differences include both English wording and manuscript readings; they are not an exhaustive comparison or a claim that one translation is inherently more accurate.
