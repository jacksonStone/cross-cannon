# Library UX comparison — 20 November 2026

Question: how should Cross Cannon help a reader resume Scripture, find a known work, and browse unfamiliar Christian writing without turning its Library into a multi-field navigation form?

Design context: the app serves Scripture alongside a supporting library of early Christian works and Christian classics.

Method: primary product help/documentation reviewed on 20 November 2026. These sources establish documented interaction patterns, not measured usability outcomes. The proposed benefits and tradeoffs are design inferences to test in prototypes. Kindle was considered, but Amazon's documentation could not be inspected through the research browser, so no Kindle-specific claims are used.

## What comparable apps actually do

| Product | Documented pattern | Relevance to Cross Cannon |
| --- | --- | --- |
| **Logos** | A dedicated Bible icon opens the preferred Bible at its last open position. Library is a separate destination. The command box also accepts a passage and can open the preferred Bible directly. | The closest match: a large supporting library can coexist with one reliable return to Scripture. [Get Oriented in Logos](https://support.logos.com/hc/en-us/articles/360036135712-1-Get-Oriented-in-Logos) |
| **Logos Library** | Books can be opened from the Library. Desktop supports different views and filters; mobile has a title/author search field and a separate filter control. | Use title/author search for finding a work; expose author/type facets when needed rather than requiring them before every open. [Find Your Books in the Library](https://support.logos.com/hc/en-us/articles/360016752591-Find-Your-Books-in-the-Library) |
| **YouVersion** | Bible is a dedicated tab. On the web, book selection supports scrolling or typing, lists books in printed Bible order, then asks for a chapter. Version selection is a separate control. | Scripture deserves its own navigation model. A known reference should not require a reader to traverse a general catalog. [Bible App Web: Bible Tab](https://help.youversion.com/l/en/article/qi1gf7u75f-bible-com-bible) |
| **Apple Books** | Home includes currently reading material; Library contains all books and collections. Opening a cover starts reading. Contents and specific-location navigation are tools inside the opened book. The current place is saved automatically. | Separate choosing *what* to read from choosing *where* inside it. A resume action need not expose chapter and verse controls. [Read books in Books](https://support.apple.com/en-sa/guide/iphone/-iphc1af7c57/ios) |
| **Apple Books organization** | Library can switch between grid and list and sort by recent, title, author, or manual order. Collections organize the same library. | Cover recognition and compact title scanning can both be useful; a single catalog organization is not the only viable view. [Organize books](https://support.apple.com/en-is/guide/iphone/iphab219b91/ios) |
| **Readwise Reader** | Library offers different workflows, including Inbox/Later/Archive and Later/Shortlist/Archive. Its preset Continue reading view selects recently opened, partly read documents. | Resume is a filtered subset, not the whole catalog. Do not copy inbox-processing language into a finite spiritual reading library. [Library configuration](https://docs.readwise.io/reader/guides/workflows/library-configuration), [Default filtered views](https://docs.readwise.io/reader/guides/filtering/default-views) |
| **Libby** | Footer navigation distinguishes catalog search, library, and personal Shelf. It also allows reopening the most recently read title. Contents navigation is accessed after opening a title. | Recent reading and catalog browsing can have distinct entry points. [Getting started](https://help.libbyapp.com/en-us/6103.htm), [Table of contents](https://help.libbyapp.com/en-us/6283.htm) |

## Shared implications — design inferences

1. **Treat resuming, finding, and browsing as distinct jobs.** A reader can resume a passage, look up a known reference or work, or discover unfamiliar writing. One form asking for collection, author or book, work, chapter, and verse makes all three jobs as complicated as the most specific one.
2. **Open a work at its saved passage, or its beginning if unread.** Make its contents a secondary action. Requiring chapter choice for every book open adds a decision when the reader simply wants to continue.
3. **Give the Bible stable canonical navigation.** Preserve book order and a quick reference entry. Group Fathers and Classics by author where that helps people browse.
4. **Keep browsing filters recoverable.** A work can open without discarding the current author, collection, or query. Returning to Library should restore the browsing context.
5. **Use titles, authors, and short descriptions to aid discovery.** Cross Cannon's public-domain works may have inconsistent cover assets. Text can give readers enough context to choose a work.

## Four structurally different experiments

| Direction | Primary organization | What it tests | Main cost |
| --- | --- | --- | --- |
| **A — Scripture home** | Scripture resume anchors a reading home, with current-reading and supporting library below. | Can a personal reading home make the library inviting while Scripture remains dominant? | A home surface can become an extra step before catalog browsing. |
| **B — Reader drawer** | A progressive side drawer on desktop and bottom sheet on mobile preserves the reader behind collection → author/work navigation. | Can browsing remain lightweight and anchored to the current Scripture passage? | Narrow sheets constrain long titles and deep hierarchies; back navigation must remain clear. |
| **C — Indexed library** | A searchable catalog grouped by author. On mobile, a compact navigation bar replaces the desktop sidebar. | Can a spacious text index make a large corpus easy to scan? | Unfamiliar authors still require context. |
| **D — Quick switcher** | One field accepts references, authors, and titles. Recent destinations are visible before typing. | Can known passages and works become easy to open from one field? | Readers who do not know what exists need a visible browse route. |

## Suggested iteration tasks

Use the same tasks in every direction:

- Open John 15 through the design's normal navigation.
- Find a known work by part of its title or author.
- Discover an unfamiliar early Christian work without typing a query.
- Open a previously read work at its saved passage, then choose a different chapter.
- Return to the previous filtered Library state.

Desktop and phone screenshots should show realistic title lengths and enough content to reveal density. Screenshots can compare hierarchy and visual feel; interaction prototypes are required to assess navigation cost and restoration behavior.
