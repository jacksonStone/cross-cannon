# Cross Cannon

Cross Cannon is a reader and search context for Scripture and early Christian
texts. Its language distinguishes reader intent, restorable reading state, and
search source material from lower-level browser or storage mechanics.

## Language

**Book**:
A named text within a reader corpus, containing ordered chapters. In Scripture,
a Book belongs to a Canon; for non-scriptural texts, prefer Early Christian Work
when referring to the work as a whole.
_Avoid_: File, asset, source row

**Chapter**:
An ordered division of a Book or Early Christian Work. A Chapter is the stable
reader unit used to group passages and describe a reader location.
_Avoid_: Page, section file, scroll region

**Passage**:
A contiguous unit of readable text inside a Chapter, often spanning one or more
verses. A Passage can be read, searched, selected, opened, or used as the source
for a similar-passage search.
_Avoid_: Result, snippet, row

**Scripture Passage**:
A Passage whose source corpus is Scripture.
_Avoid_: Result text, paragraph row, Bible snippet

**Canon**:
A tradition-specific set and order of Scripture Books available for Scripture
reading and search. Canon describes Scripture scope; it does not include Early
Christian Works.
_Avoid_: Corpus, filter preset, denomination

**Focused Passage**:
A passage the user has selected as the source context for a similar-passage
search. It is not the same thing as the passage currently visible in the reader.
_Avoid_: Current passage, scroll target, selected verse

**Search Request**:
A user's intent to find Passages by theme or similarity within Scripture or
Early Christian Works, optionally scoped by a Canon, Books, or authors.
_Avoid_: Form submission, query payload, search action

**Reader Location**:
The user's restorable place within a reader corpus, identified by a chapter and
optionally a passage range inside that chapter.
_Avoid_: Scroll offset, pixel position, raw reader position

**Reader Navigation**:
The reader behavior that decides which location to show, restore, select, or
open when the user arrives from saved state, a direct link, a jump action, a
search result, or normal reading.
_Avoid_: Scroll tracking, window management

**Scripture Cache**:
The versioned collection of Scripture passages used as the browser's complete
text source for reading, result display, passage lookup, and similar-passage
source text.
_Avoid_: Database cache, search index, static JSON

**Early Christian Work**:
A non-scriptural early Christian text presented for reading and search alongside
Scripture, with author, source, classification, and chapter structure.
_Avoid_: Church fathers asset, preview book, fathers file
