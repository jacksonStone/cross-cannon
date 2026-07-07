# Reader navigation restores reader location, not scroll offsets

Reader navigation treats the user's place as a reader location: a chapter plus
an optional passage range. This keeps restored state stable across text loading,
chapter-window changes, search result openings, and device sizes, at the cost of
not preserving an exact pixel offset.
