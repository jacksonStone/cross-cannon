# Cross Canon feature inventory and daily-use gap analysis against Logos

Research date: November 12, 2026.

This is the November 12 feature/research baseline, including the then-current web app and native iOS/macOS reader. It is retained for product research, not as a current feature checklist. The reader/server have since converged on Rust; implementation links below point to their current owners. Use [architecture](../architecture.md) and [README](../../README.md) for current behavior and commands. It is a source audit, not a fresh end-to-end production or App Store availability audit. Counts below come from the checked-in text catalogs. Logos findings use current official product/support documentation, collected in [the supporting research](logos-daily-use-features.md). Logos feature access varies by platform, owned resources, and subscription/license; a feature listed here is not necessarily included in every Logos installation.

Scope: routine reading, devotional habits, personal study, and preparing a small-group discussion or lesson. Advanced academic analysis, publishing, and church production are outside the main comparison.

## Cross Canon inventory

### Collections and editions

1. Three named reading/search collections: Scripture, Early Christian Works, and Christian Classics.
2. World English Bible Scripture text, with 81 indexed book entries across the available canon options; the current Scripture cache contains 8,360 paragraph passages.
3. Protestant, Catholic, and Orthodox canon selections for Scripture navigation/search. These are the app's defined scopes, not a claim to cover every variation in every tradition.
4. 410 cataloged Early Christian Works under 54 distinct author labels, with chapter navigation. Catalog entries are not necessarily equivalent to modern publisher book volumes.
5. Four Christian Classics: The Imitation of Christ (Thomas à Kempis), Catena Aurea (Thomas Aquinas), Commentary on the Whole Bible (Matthew Henry and continuators), and Notes on the Bible (John Wesley).
6. Title/author catalog lookup; author filtering in Work navigation; Christian Classics genre filtering and browsing.
7. Local favorite Works and promotion of favorites in Work navigation; native library includes a favorites-only view.
8. Work provenance: author, date range, tradition, translator, edition, rights, and a link to the source edition where supplied. Book headings also expose available metadata.
9. Original/modernized reading modes for non-Scripture text where a reviewed modernization exists, with visual marking of changed words. Coverage is partial; this is not a second Bible translation.
10. Imported editorial chapter notes where supplied. These are distinct from user-authored notes.

Evidence: [Scripture reader](../../rust/desktop/src/reader.rs), [canon definitions](../../rust/core/src/lib.rs), [Scripture manifest](../../scripture-cache/manifest.json), [Early Christian catalog](../../public/church-fathers-preview/books.json), [Classics catalog](../../public/christian-classics-text/books.json), [Classics browse route](../../rust/desktop/src/catalog.rs), [Work picker](../../rust/desktop/src/dialogs.rs), [native catalog](../../rust/desktop/src/catalog.rs), [edition details](../../rust/desktop/src/catalog.rs), [modernized text rendering](../../rust/desktop/src/reading_translation.rs), [editorial notes](../../rust/desktop/src/catalog.rs).

### Reading, navigation, and appearance

11. Continuous paragraph reading with an expanding chapter window for forward reading and backtracking.
12. Subtle chapter boundaries and verse/passage numbering kept out of the main reading flow until the interaction requires it.
13. Passage selection that exposes the reference and contextual actions.
14. Scripture book/chapter/verse jump; Work/chapter jump, including chapter-title lookup on web.
15. Restorable passage-based Reader Locations instead of raw scroll positions.
16. Independent saved Reader Locations for the three collections, plus remembering the last chosen collection. This is not a full per-Work bookmark system.
17. Direct Reader Links to Scripture and non-Scripture passages/chapters.
18. Browser Back/Forward navigation; native reader history controls.
19. Web search-result/form/scroll restoration on Back within a bounded tab-local history. It does not persist across a reload and is not a durable saved-search library.
20. Reader presets: Default, Compact, Open, Relaxed.
21. Adjustable text size, line spacing, and reading width.
22. Paper, Sepia, Dark, and Contrast themes; locally persisted reader settings.
23. Responsive mobile/desktop web reading plus native iPhone and macOS readers.
24. Native copy actions for search results and non-Scripture passage text/links. Scripture selection deliberately exposes the two study actions rather than a broad export toolbar.

Evidence: [reader](../../rust/desktop/src/reader.rs), [reader window](../../rust/desktop/src/text_surface.rs), [Scripture jump](../../rust/desktop/src/dialogs.rs), [Work jump](../../rust/desktop/src/dialogs.rs), [Reader Links](../../rust/desktop/src/navigation.rs), [location storage](../../rust/desktop/src/persistence.rs), [collection switch](../../rust/desktop/src/catalog.rs), [search history](../../rust/desktop/src/navigation.rs), [reader controls/settings](../../web/platform.js), [settings model](../../rust/desktop/src/reader.rs), [native reader](../../rust/desktop/src/reader.rs), [native dialogs](../../rust/desktop/src/dialogs.rs).

### Search and commentary

25. Natural-language thematic search, returning passages from source texts.
26. Similar-passage search starting from a selected passage or a search result.
27. Switching the target collection to explore related Scripture, Early Christian Works, or Christian Classics from the search dialog. Search targets one collection at a time; this is not a single blended all-library results list.
28. Scripture search scoped by canon and selected books; non-Scripture search scoped by author.
29. Adjustable result count (web control: 5–40, default 10), with saved filter preferences.
30. Ranked paragraph results with references/source labels and a four-level match-strength indication in the web UI.
31. Automatic highlighting of a strong matching verse inside Scripture results. This is a search aid, not a saved personal highlight.
32. Opening a result in its full reading context and continuing similar-passage exploration.
33. A selected Scripture passage can open verse-linked commentary, matched by book, chapter, and overlapping source verse coverage.
34. Choosing among available commentators and opening the full commentary Work; web commentary presents the selected Scripture alongside the notes.
35. Native commentary lookup works from the bundled catalog without online search. Coverage is limited to the included indexed commentaries; for example, the imported Wesley source omits 2 Samuel 24.
36. Runtime searches return source passages rather than generated answers, commentary, or applications. Reviewed modernizations are preexisting text overlays, not answers generated for a search.

Evidence: [search form](../../rust/desktop/src/dialogs.rs), [search target model](../../rust/desktop/src/search.rs), [filter controls](../../rust/desktop/src/dialogs.rs), [request contract](../../rust/api/src/compat.rs), [results](../../rust/desktop/src/search.rs), [Work results](../../rust/desktop/src/search.rs), [commentary UI](../../rust/desktop/src/commentary.rs), [coverage matching](../../rust/api/src/compat.rs), [commentary API](../../rust/api/src/compat.rs), [native commentary](../../rust/desktop/src/commentary.rs), [native release verification](../native-apps.md), [product contract](../../README.md).

### Audio and offline use

37. Scripture audio where a recording exists: play/pause, chapter navigation, and continuous playback within a book using combined audio, with original-recording fallback.
38. Web Media Session controls for supported browser/system playback surfaces. Playback ends at the book/Work boundary rather than promising a whole-library queue.
39. Selected Early Christian audio with chapter offsets. The catalog currently has audio entries for Confessions, City of God, and one First Clement chapter; coverage and alignment quality vary. The four current Classics have no audio entries.
40. Web Scripture reading offline after the required app/text resources have been retained locally.
41. Whole-Work text downloads for either non-Scripture collection in the web reader, with progress, cancellation, removal, retry/recovery, and offline availability indicators/navigation.
42. All three collections' text bundled in native apps, with local catalog browsing and verse-commentary lookup.
43. Optional native recording downloads, including progress, pause/retry and removal, for offline listening. Web Work downloads are text-only.
44. Online semantic search is separate from offline text reading; downloaded text does not provide offline semantic passage search.

Evidence: [web audio](../../rust/desktop/src/audio.rs), [continuous-audio manifest loading](../../rust/desktop/src/audio.rs), [Early Christian audio](../../rust/desktop/src/audio.rs), [offline Work UI](../../web/service-worker.js), [Work downloads](../../web/service-worker.js), [offline reader](../../web/service-worker.js), [native downloads](../../rust/desktop/src/downloads.rs), [native and continuous-audio overview](../../README.md).

### Accounts and export

45. Guest reading without an account; optional Google sign-in.
46. Reader Location sync across web, iOS, and macOS, with one independently saved location per collection.
47. Queued offline progress changes and reconnect sync; separate guest/account locations and account isolation.
48. Explicit import of guest reading progress and a conflict choice when devices disagree. Remote progress does not move an already-open view.
49. Local favorites and settings; those do not yet sync. Notes are not an implemented personal-data feature.
50. Repository commands generate Kindle-compatible EPUBs of the Bible and First Clement, including book/chapter navigation and a cover. This is a maintained export workflow, not an in-app Send to Kindle button or general-purpose resource exporter.

Evidence: [account behavior](../google-login.md), [progress model](../../rust/api/src/accounts/protocol.rs), [account provider](../../rust/desktop/src/account.rs), [native accounts](../../rust/desktop/src/account.rs), [Kindle export documentation](../content-maintenance.md#kindle-exports).

## Daily-use gaps

“Missing” means no implemented user-facing equivalent was found in the audited route/feature/native code, not a claim that it can never be added. Priority reflects daily usefulness and fit with Cross Canon; it is a product judgment, not an implementation estimate. Logos details and official citations are in [the supporting feature research](logos-daily-use-features.md).

| Daily user job | Cross Canon today | Logos capability | Gap / suggested priority |
| --- | --- | --- | --- |
| Read comfortably and resume | Strong core reader, themes, passage-based restore | Reading views, navigation, device sync | Existing foundation; preserve simplicity |
| Read something assigned each day | Saved location only | Scheduled Bible/book reading plans, completion tracking, reminders on supported devices | Missing; high for devotional use |
| Preserve an observation or question | No personal notes/highlights | Passage/text-anchored notes, notebooks, tags, highlights | Missing; highest general-purpose daily value |
| Save and revisit several passages | Last location, Work favorites, links | Bookmarks/favorites and Passage Lists | Partial; add multiple named saved passages |
| Use a preferred translation | WEB only | Multiple owned/free translations | Missing; high; content rights and stable reference mapping required |
| Compare translations while reading | No translation comparison | Text Comparison and multiple Bible panels | Missing; high for serious lay study |
| Find an exact phrase or all occurrences | Semantic search; keyword lookup searches catalog metadata | Precise Bible/library search, with phrase/operators and original-language options | Missing; high; distinguish exhaustive lexical matches from ranked similarity |
| Explore a topic in ordinary language | Semantic thematic search | Smart Bible Search and Smart Search of the library | Partial overlap; do not market semantic search as exclusive |
| Follow related Scripture | Similar-passage exploration | Cross-reference/parallel-passage sections and linked references | Partial; similarity does not replace curated textual cross-references |
| Consult a commentary on this passage | Verse-indexed historical commentary, available-commentator choice | Guides and linked access to owned commentaries/study Bibles | Partial; interaction exists, breadth and preferred-resource handling lag |
| Read Bible and commentary together | Web contextual commentary dialog; full Work reader | Linked panels that follow the same Bible reference; saved layouts | Partial; add a compact linked study view if study is a core audience |
| Understand a word beneath the translation | No original-language tools | Word lookup, reverse interlinears, lexicons, Bible Word Study | Missing; medium overall, high for language-focused study |
| Understand a person, place, or historical setting | Text/edition metadata and thematic search | Factbook, dictionaries, maps and related resources | Missing; medium; source-linked lookup is a good fit |
| Follow a structured study process | Reader/search/commentary actions | Passage Guide and guided Workflows | Partial; consider a minimal passage study sheet after core tools |
| Maintain prayer habits | Can read prayer-related texts | Prayer lists, schedules, answered-prayer records | Missing; medium for devotional audience |
| Memorize Scripture | No practice/tracking | Passage List memorization tools | Missing; medium for devotional audience |
| Read/listen without connectivity | Native bundled text/optional audio; web cached/downloaded text | Downloaded resources and offline notes/highlights; audio availability varies | Partial; major next need is offline personal annotations once added |
| Carry study work across devices | Locations sync; favorites/settings local | Sync of personal documents such as notes/plans, plus reading state | Partial; sync new personal study data and favorites |
| Prepare a discussion or lesson | Source discovery, commentary, links, native copying | Notes, Passage Lists, Clippings, guided study and sermon-related tools | Partial; saved study collections and clean text export before full sermon tooling |
| Ask for an explanation or summary | Source passage retrieval; no runtime generated explanations | AI Study Assistant and summarization, subject to access/limits | Deliberate product choice; low priority unless product direction changes |
| Build a personal research library | Fixed imported catalogs | Purchased/owned resource library, collections, resource prioritization | Large content/ecosystem gap; add selected resources around real needs |

## Recommended sequence

1. **Build a personal study layer:** persistent passage bookmarks, user highlights, notes, and simple notebooks across all three collections. Give each a stable passage anchor; make offline creation and account sync part of the feature. Search-result highlighting and last-position sync are not substitutes.
2. **Add a daily reading loop:** a few Bible plans, a Bible-plus-Classic plan, session completion, and a clear next reading. Keep completion separate from the passive Reader Location. Reminders can follow the basic loop rather than delaying it.
3. **Add dependable retrieval:** exact word/phrase search and curated cross-references alongside semantic exploration. Label the search modes so users know whether they are seeing all textual occurrences or ranked related passages.
4. **Offer a second Bible translation and comparison:** validate demand and rights first, then support stable verse mapping and a compact comparison view. Canon choice currently changes book scope, not translation.
5. **Deepen the existing commentary experience:** a preferred commentator, a simple linked reading view, source-reference links, then a small number of useful dictionaries/maps and optional word lookup. More resources should improve a daily job rather than merely increase the catalog count.

For a devotional-reader strategy, move reading plans to the front. For a serious-study strategy, prioritize translation comparison, exact search, and cross-references immediately after notes. These are two useful tracks; a single feature-count score would obscure that difference.

Cross Canon's existing source-only, cross-century exploration and restrained reading flow are meaningful product choices. Logos also supports natural-language search and historical resources, so superiority or uniqueness would require user testing and retrieval-quality evaluation. The practical opportunity is to add the few tools that let a reader retain and revisit insight while keeping the current reading experience approachable.

## Research limits

- No changes were made to app behavior and no deployment was performed.
- This audit did not rerun the application's verification suite; it is documentation/source analysis.
- Public production pages did not expose useful readable content to the web research tool, so current implementation claims come from source/catalogs and existing release evidence, with the date and platform qualification above.
- A cataloged text is not necessarily a separately published volume, a searchable database is not necessarily available on every deployed environment, and bundled native builds do not establish public distribution availability.
- No claim is made that Logos is faster, more accurate, or harder/easier to use; those require comparative hands-on tests.
