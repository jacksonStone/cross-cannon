# Church Fathers Audio Research

Research date: 2026-07-06

## Current Inventory

The generated Church Fathers preview index currently contains 410 works and
12,956 parsed chapters in `public/church-fathers-preview/books.json`.

Only two works have audio references wired into the current app/repo:

| Work id | Work | Author | Parsed chapters | Audio status |
| --- | --- | --- | ---: | --- |
| `npnf101:vi` | The Confessions | Augustine of Hippo | 275 | Known LibriVox/Archive.org source for all parsed Confessions chapters. Precise timestamp alignment currently exists for 18 parsed chapters. |
| `anf09:xii.iv` | The First Epistle of Clement to the Corinthians. | Clement of Rome | 65 | BiblicalAudio source exists for chapters 1-3. Current alignment JSON exposes only chapter 1. |

Many more works in our Fathers corpus have public audio archives available
externally. They are not yet represented by app alignment JSON files.

## Verified Public Audio Archives

These are public audio archives I could verify against works currently present
in `public/church-fathers-preview/books.json`.

### LibriVox / Internet Archive

LibriVox recordings are public domain in the USA and are hosted on Internet
Archive. Archive items usually expose multiple MP3 derivatives per section,
commonly original MP3 plus `_128kb.mp3` and `_64kb.mp3`, and may also include
whole-book ZIP/M4B/RSS assets.

| Work id | Work in our corpus | Public archive | Structure |
| --- | --- | --- | --- |
| `anf02:ii` | THE PASTOR OF HERMAS | `https://archive.org/details/shepherdofhermas_2102_librivox` | LibriVox item; MP3 section files. |
| `anf03:iv.iii` | Tertullian, Apology. | `https://archive.org/details/apology_2012_librivox` | 10 logical sections, with multiple MP3 bitrate derivatives. |
| multiple Tertullian shorter works | Several shorter Tertullian works in ANF03/ANF04 | `https://archive.org/details/shorterworks1_2101_librivox` and `https://archive.org/details/shorterworks2_2405_librivox` | Anthology-style LibriVox items, 22 and 34 logical sections respectively. Needs per-section title mapping before wiring exact works. |
| `anf04:iv.iii` | The Octavius of Minucius Felix. | `https://archive.org/details/octavius_2004_librivox` | LibriVox item; MP3 section files. |
| `anf05:iii.v.i` | Hippolytus, on the end of the world / Antichrist | `https://archive.org/details/treatisonchristandantichrist_jl_librivox` | LibriVox item; MP3 section files. |
| `anf05:iv.iv` | The Epistles of Cyprian. | `https://archive.org/details/epistles_of_cyprian_2206_librivox` | LibriVox item; MP3 section files. |
| `anf07:viii.iii` | The Teaching of the Twelve Apostles | `https://archive.org/details/thedidache_ss_librivox` and `https://archive.org/details/didache_2004_librivox` | Two LibriVox recordings; MP3 section files. |
| `npnf101:vi` | Augustine, The Confessions | `https://archive.org/details/confessions_augustine_0911_librivox`, `https://archive.org/details/confessions_1510_librivox`, `https://archive.org/details/confessionsofaugustine_1310_librivox` | English Outler, English Pusey, and Latin recordings. The Outler item has 31 sections by book/chapter range. |
| `npnf102:iv` | Augustine, City of God | `https://archive.org/details/city_of_god_ds_librivox` and `https://archive.org/details/treatiseonthecityofgod_2407_librivox` | Complete/large LibriVox recordings; one verified item has about 69 logical sections. |
| `npnf102:v` | Augustine, On Christian Doctrine | `https://archive.org/details/christiandoctrine_1911_librivox` | About 25 logical sections. |
| `npnf103:iv.ii` | Augustine, The Enchiridion | `https://archive.org/details/enchiridion_of_st_augustine_librivox` | About 7 logical sections. |
| `npnf103:v.ii` | Augustine, On the Good of Marriage | `https://archive.org/details/onthegoodofmarriage_2502_librivox` | LibriVox item; MP3 section files. |
| `npnf103:v.iii` | Augustine, Of Holy Virginity | `https://archive.org/details/ofholyvirginity_1805_librivox` | LibriVox item; MP3 section files. |
| `npnf103:v.v` | Augustine, On Lying | `https://archive.org/details/on_lying_2106_librivox` | LibriVox item; MP3 section files. |
| `npnf105:xi` | Augustine, On the Spirit and the Letter | `https://archive.org/details/spirit_and_letter_2207_librivox` | LibriVox item; MP3 section files. |
| `npnf105:xix` | Augustine, On Grace and Free Will | `https://archive.org/details/ongraceandfreewill_2204_librivox` | LibriVox item; MP3 section files. |
| `npnf105:xxi` | Augustine, On the Predestination of the Saints | `https://archive.org/details/predestinationofsaints_2206_librivox` | LibriVox item; MP3 section files. |
| `npnf107:iv` | Augustine, Ten Homilies on the First Epistle of John | `https://archive.org/details/tenhomiliesonthefirstepistleofjohn_2006_librivox` | LibriVox item; MP3 section files. |
| `npnf108:ii` | Augustine, Expositions on the Book of Psalms | `https://archive.org/details/expositionspsalmsvol1_2011_librivox`, `https://archive.org/details/psalms2_2012_librivox`, `https://archive.org/details/exposition3_psalms_53-75_2108_librivox`, `https://archive.org/details/expositions_psalms_vol_4_76-101_2206_librivox`, `https://archive.org/details/exposition_5_psalms_102-125_2312_librivox`, `https://archive.org/details/expositionpsalms6_2408_librivox` | Six-volume LibriVox coverage of Psalms 1-150. |
| `npnf109:x` | Chrysostom, Three Homilies Concerning the Power of Demons | `https://archive.org/details/threehomiliesonthedevil_2005_librivox` and `https://archive.org/details/homilies_demons_2305_librivox` | Two LibriVox recordings. |
| `npnf110:iii` | Chrysostom, Homilies on Matthew | `https://archive.org/details/commentary_gospel_st_matthew_1405_librivox`, `https://archive.org/details/sermon_mount_commentary_1310_librivox`, `https://archive.org/details/parables_jesus_christ_commentary_gospel_matthew_1511_librivox`, `https://archive.org/details/miracles_jesus_christ_commentary_matthew_librivox`, `https://archive.org/details/death_resurrection_commentary_matthew_161_librivox` | Topical LibriVox extracts from the Matthew commentary, not a single full-work alignment. |
| `npnf111:vii` | Chrysostom, Homilies on Romans | `https://archive.org/details/homiliesonromans_2501_librivox` | LibriVox item; MP3 section files. |
| `npnf112:iv` | Chrysostom, Homilies on First Corinthians | `https://archive.org/details/johnchrysostom1stcorinthiansvol1_2101_librivox` and `https://archive.org/details/chrysostom_1corinthians_vol2_2307_librivox` | Two-volume LibriVox coverage. |
| `npnf112:v` | Chrysostom, Homilies on Second Corinthians | `https://archive.org/details/homilies2ndcorinthians_2506_librivox` | LibriVox item; MP3 section files. |
| `npnf113:iii.iii` | Chrysostom, Commentary on Galatians | `https://archive.org/details/commentary_galatians_jl_librivox` | LibriVox item; MP3 section files. |
| `npnf113:iii.iv` | Chrysostom, Homilies on Ephesians | `https://archive.org/details/homilies_on_ephesians_2101_librivox` | LibriVox item; MP3 section files. |
| `npnf113:iv.iii` | Chrysostom, Homilies on Philippians | `https://archive.org/details/homiliesonphilippians_2009_librivox` | LibriVox item; MP3 section files. |
| `npnf113:iv.iv` | Chrysostom, Homilies on Colossians | `https://archive.org/details/homilies_on_colossians_2103_librivox` | LibriVox item; MP3 section files. |
| `npnf113:v.iii` | Chrysostom, Homilies on 1 Timothy | `https://archive.org/details/stjohnchrysostomon1timothy_2005_librivox` | LibriVox item; MP3 section files. |
| `npnf113:v.iv` | Chrysostom, Homilies on 2 Timothy | `https://archive.org/details/2timothy_2006_librivox` | LibriVox item; MP3 section files. |
| `npnf113:v.v` | Chrysostom, Homilies on Titus | `https://archive.org/details/stjohnchrysostomepistletitus_2004_librivox` | LibriVox item; MP3 section files. |
| `npnf114:v` | Chrysostom, Homilies on Hebrews | `https://archive.org/details/homilies_on_hebrews_2204_librivox` | LibriVox item; MP3 section files. |
| `npnf201:iii` | Eusebius, Church History | `https://archive.org/details/eusebius_history_of_the_christian_church_0902_librivox1` | LibriVox item; MP3 section files. |
| `npnf204:vi` / `npnf204:vi.ii.*` | Athanasius, Against the Heathen / Contra Gentes | `https://archive.org/details/contragentes_jl_librivox` | LibriVox item; MP3 section files. |
| `npnf204:vii.ii` | Athanasius, On the Incarnation of the Word | `https://archive.org/details/on_the_incarnation_2206_librivox` | LibriVox item; MP3 section files. |
| `npnf204:xiv.ii` | Athanasius, Defence of the Nicene Definition | `https://archive.org/details/defence_nicene_definition_2307_librivox` | LibriVox item; MP3 section files. |
| `npnf204:xvi.ii` | Athanasius, Life of Antony | `https://archive.org/details/lifeofantony_1308_librivox` and `https://archive.org/details/lifeofstanthony_1710_librivox` | Two LibriVox recordings. |
| `npnf204:xxi` / `npnf204:xxi.ii.*` | Athanasius, Against the Arians | `https://archive.org/details/againstthearians_1501_librivox` | LibriVox item for four discourses. |
| multiple Athanasius later treatises | Athanasius later treatises in NPNF204, plus Theodoret material | `https://archive.org/details/latertreatises_2201_librivox` | Anthology-style LibriVox item, about 12 logical sections. Needs per-section mapping. |
| `npnf205:ix.ii.ii` | Gregory of Nyssa, On Virginity | `https://archive.org/details/on_virginity_1711_librivox` | LibriVox item; MP3 section files. |
| `npnf206:vi.vi` | Jerome, Against Jovinianus | `https://archive.org/details/against_jovinianus_2005_librivox` | LibriVox item; MP3 section files. |
| `npnf203:v.iii` | Jerome, Lives of Illustrious Men | `https://archive.org/details/onillustriousmen_2007_librivox` | LibriVox item; MP3 section files. |
| `npnf208:vii` | Basil, De Spiritu Sancto | `https://archive.org/details/bookofsaintbasilonthespirit_2310_librivox` | About 30 logical sections. |
| `npnf208:viii` | Basil, The Hexaemeron | `https://archive.org/details/hexaemeron_1107_librivox` | 9 homily sections. |
| `npnf210:iv.i` | Ambrose, On the Duties of the Clergy | `https://archive.org/details/on_duties_of_clergy_librivox` | About 103 logical sections. |
| `npnf210:iv.iii` | Ambrose, On the Decease of His Brother Satyrus | `https://archive.org/details/deathofsatyrus_2106_librivox` | LibriVox item; MP3 section files. |
| `npnf210:iv.vii` | Ambrose, Concerning Virgins | `https://archive.org/details/concerning_virgins_librivox` and `https://archive.org/details/concerningvirgins_2007_librivox` | Two LibriVox recordings; one verified item has about 25 logical sections. |
| `npnf211:iii` | Vincent of Lerins, Commonitory | `https://archive.org/details/commonitory_saint_vincent_lerins_2302_librivox` | LibriVox item; MP3 section files. |
| `npnf212:ii.v` | Leo the Great, Sermons | `https://archive.org/details/sermons_leo_great_jl_librivox` | LibriVox item; MP3 section files. |

### BiblicalAudio

BiblicalAudio pages expose direct MP3 links on each work page. Many links are
chapter or chapter-range MP3 files under `https://www.biblicalaudio.com/audio/`.

| Work id | Work in our corpus | Source page | Structure |
| --- | --- | --- | --- |
| `anf02:ii` | THE PASTOR OF HERMAS | `https://www.biblicalaudio.com/hermas.html` | Direct files `audio/music/HERMAS/Hermas-01.mp3` through about `Hermas-33.mp3`. |
| `anf03:iv.v` | Tertullian, The Shows / De Spectaculis | `https://www.biblicalaudio.com/tertullianshows.html` | Single direct MP3 `audio/tertullian/TertullianShows%28voice%29.mp3`. |
| `anf03:vi.vi` | Passion of Perpetua and Felicitas | `https://www.biblicalaudio.com/perpetua.htm` | Direct files `Perpetua-00.mp3` through `Perpetua-06.mp3`. |
| `anf07:viii.iii` | Didache | `https://www.biblicalaudio.com/didache.htm` | Six chapter-range MP3s: `Didache01%7E04.mp3`, `Didache05%7E06.mp3`, `Didache07%7E08.mp3`, `Didache09%7E10.mp3`, `Didache11%7E13.mp3`, `Didache14%7E16.mp3`. |
| `anf09:xii.iv` | First Clement | `https://www.biblicalaudio.com/clement1.htm` | Chapter-range MP3s, e.g. `Clemens-01%7E03.mp3`, `Clemens-04%7E06.mp3`, etc. Current repo alignment uses only the first range and exposes chapter 1. |

BiblicalAudio also has pages for Barnabas, Ignatius, Polycarp, and Papias, but
those exact works are not present in the current generated `books.json` preview
index I checked on 2026-07-06.

## Audio Format

The Fathers audio is not stored as local MP3 assets. The browser receives remote
MP3 URLs plus optional timestamps.

Current audio files are plain MP3 URLs:

- Confessions: Archive.org/LibriVox MP3 files named like
  `confessions_01_01-10_augustine_64kb.mp3`.
- First Clement: BiblicalAudio MP3 file
  `https://www.biblicalaudio.com/audio/music/CLEMENS/Clemens-01%7E03.mp3`.

The app's usable audio contract is:

```json
{
  "audioUrl": "https://example.test/source.mp3",
  "startSeconds": 36.7,
  "endSeconds": 134.7,
  "label": "Book 01, Chapters 01-10",
  "confidence": 1
}
```

`audioUrl`, `startSeconds`, and `endSeconds` are the playback contract when an
alignment is available. `label` and `confidence` are metadata.

## Structure In The Repo

The alignment files live beside the generated Fathers preview index:

- `public/church-fathers-preview/confessions-audio-alignment.json`
- `public/church-fathers-preview/first-clement-audio-alignment.json`

They share this shape:

```json
{
  "chapters": {
    "parsed-chapter-id": {
      "audioUrl": "https://example.test/source.mp3",
      "confidence": 1,
      "endSeconds": 175.3,
      "label": "Chapters 01-03",
      "startSeconds": 4.6
    }
  },
  "generatedAt": "2026-07-05T21:20:23.256Z",
  "source": "http://www.biblicalaudio.com/clement1.htm"
}
```

The `chapters` object is keyed by parsed CCEL chapter IDs from `books.json`.
Examples:

- Confessions chapter 1: `npnf101:vi.I_1.I`
- Confessions chapter 18: `npnf101:vi.I_1.XVIII`
- First Clement chapter 1: `anf09:xii.iv.i`

The transcript cache used to build these alignments is local, generated data:

- `storage/church-fathers-audio/transcripts/confessions_01_01-10_augustine_64kb.mp3.json`
- `storage/church-fathers-audio/transcripts/confessions_01_11-19_augustine_64kb.mp3.json`
- `storage/church-fathers-audio/transcripts/Clemens-01~03.mp3.json`

These transcript JSON files are produced from OpenAI `whisper-1`
`verbose_json` with word timestamps, then fuzzy-aligned against parsed chapter
text.

## Confessions

Source:

- App source page: `https://archive.org/details/confessions_augustine_0911_librivox`
- LibriVox catalog page: `https://librivox.org/confessions-by-saint-augustine-of-hippo/`

LibriVox presents Confessions as a 31-section audiobook. The sections are grouped
by Augustine book/chapter ranges, not by Cross Cannon's parsed chapter rows. The
LibriVox page also exposes whole-book ZIP, RSS, torrent, Archive.org, and M4B
downloads.

The app has a hard-coded 31-track table in `app/routes/church-fathers.tsx`.
Track labels cover:

- Book 1, chapters 1-10 and 11-19
- Books 2-9 in one or two tracks per book
- Books 10-13 in multiple chapter-range tracks

Current precise alignment:

- File: `public/church-fathers-preview/confessions-audio-alignment.json`
- Generated at: `2026-07-02T11:06:36.562Z`
- Aligned parsed chapters: 18
- Unique aligned MP3 files: 2
- Aligned coverage: Confessions Book 1, chapters 1-18

Current fallback behavior:

- If a Confessions chapter does not have a timestamp alignment, the UI maps the
  parsed chapter ID to the matching LibriVox track.
- The fallback starts the whole track at `0` seconds and has no `endSeconds`.
- Therefore all 275 parsed Confessions chapters have a known audio track, but
  only the 18 aligned chapters have precise chapter-level start/end playback.

## First Clement

Source:

- Source page recorded in repo: `http://www.biblicalaudio.com/clement1.htm`
- MP3: `https://www.biblicalaudio.com/audio/music/CLEMENS/Clemens-01%7E03.mp3`

Current precise alignment:

- File: `public/church-fathers-preview/first-clement-audio-alignment.json`
- Generated at: `2026-07-05T21:20:23.256Z`
- Aligned parsed chapters: 1
- Unique aligned MP3 files: 1
- Exposed chapter: `anf09:xii.iv.i`
- MP3 label: `Chapters 01-03`
- Timestamp window: 4.6s to 175.3s

The builder script loads First Clement chapters 1-3 and can locate starts for
the track, but currently writes only chapter 1 because
`OUTPUT_CHAPTER_LIMIT = 1` in
`scripts/build-first-clement-audio-alignment.ts`.

## Integration Notes

- `README.md` documents only the Confessions alignment workflow.
- `scripts/build-confessions-audio-alignment.ts` supports `--track`, `--limit`,
  `--min-confidence`, and `--dry-run`.
- `scripts/build-first-clement-audio-alignment.ts` has no CLI filtering and is
  currently scoped to one BiblicalAudio track.
- `scripts/build-church-fathers-preview-assets.py` preserves
  `confessions-audio-alignment.json` when regenerating preview assets, but does
  not list `first-clement-audio-alignment.json` in `PRESERVED_OUTPUT_FILES`.
- `app/routes/church-fathers-preview.$assetFile.ts` currently whitelists
  `books.json`, `confessions-audio-alignment.json`, and `manifest.json`, but not
  `first-clement-audio-alignment.json`. The React route tries to fetch First
  Clement alignment, so that file may 404 through the Remix asset route unless
  served directly as a static public file by the deployment setup.

## What To Add Next

For additional Fathers audio, the implementation pattern is:

1. Identify a public-domain remote audio source for a parsed work.
2. Decide whether the source is already segmented by parsed chapter or by larger
   chapter ranges.
3. Add a builder script or extend the existing alignment builder to download the
   remote MP3 to temp storage, transcribe/cached word timestamps, and map parsed
   chapter IDs to `{ audioUrl, startSeconds, endSeconds }`.
4. Preserve the generated alignment JSON during preview asset rebuilds.
5. Whitelist the generated alignment JSON in the preview asset route if it is
   loaded through Remix.
