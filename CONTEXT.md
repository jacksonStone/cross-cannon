# Cross Cannon

Cross Cannon is a reader and search context for Scripture and early Christian
texts. Its language distinguishes reader intent, restorable reading state, and
search source material from lower-level browser or storage mechanics.

## Language

**Scripture Passage**:
A paragraph-level portion of Scripture that can be read, searched, opened, or
used as the source for a similar-passage search.
_Avoid_: Result text, paragraph row, Bible snippet

**Focused Passage**:
A passage the user has selected as the source context for a similar-passage
search. It is not the same thing as the passage currently visible in the reader.
_Avoid_: Current passage, scroll target, selected verse

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
