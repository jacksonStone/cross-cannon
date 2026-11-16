# Reader navigation restores reader location, not scroll offsets

Reader navigation treats the user's place as a reader location: a chapter plus
an optional passage range. This keeps restored state stable across text loading,
chapter-window changes, search result openings, and device sizes, at the cost of
not preserving an exact pixel offset.

Audio chapter changes restore the new chapter's first Passage through this same
navigation path. They reuse chapter-window initialization and target settling,
while keeping the audio element mounted so playback continues.

Reader Links encode deliberate Reader Locations for both corpora. Explicit
jumps create browser-history entries so Back and Forward restore the prior
location; selecting a Passage updates the current entry for sharing. Passive
scrolling persists Reader Location but does not rewrite browser history.

The native iOS reader checkpoints changed Reader Location, collection resume
targets, settings and account progress synchronously after rendering. It reuses
the existing `reader.ron` format and replaces the file atomically. A repaint-based
autosave timer and exit callback cannot guarantee persistence: an idle reader
may never repaint after the timer elapses, and iOS can terminate a suspended app
without an exit callback. Unchanged frames do not write to disk.

Native frame checkpoints compare the small reader/account snapshots and a study
revision before serialization. Study mutations, including cloud reconciliation,
invalidate one prepared RON value shared by the reader and study checkpoints.
Prepared values remain pending after a failed atomic write and are retried;
preparing a value is not an acknowledgement of durable storage. This avoids
repeatedly serializing notes on scrolling frames while retaining same-frame
durability of changed Reader Location and settings.

Returning to a native reader starts an immediate account refresh and restores
the latest Reader Location for the open Collection. iOS uses UIKit activation
notifications because a key window can remain focused during suspension, and
there may be no inactive render frame. Only a response requested for that return
can restore the view, and only if local reading has not changed, no unsynced
progress or conflict remains, and audio is not playing. Routine polling during
active reading updates saved Collection locations without moving the open view.
Applying an equivalent chapter-only web location does not queue a new upload.
