# Reader navigation restores reader location, not scroll offsets

Reader navigation treats the user's place as a reader location: a chapter plus
an optional passage range. This keeps restored state stable across text loading,
chapter-window changes, search result openings, and device sizes, at the cost of
not preserving an exact pixel offset.

Reader Links encode deliberate Reader Locations for both corpora. Explicit
jumps create browser-history entries so Back and Forward restore the prior
location; selecting a Passage updates the current entry for sharing. Passive
scrolling persists Reader Location but does not rewrite browser history.
