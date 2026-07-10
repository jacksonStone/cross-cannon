# Constrain Early Christian Reader Navigation Offline

Status: ready-for-agent

## Parent

[Offline Reading PRD](../PRD.md)

## What to build

Make Early Christian Reader Navigation reflect exactly what is available in
browser storage. While offline, Jump must offer only complete downloaded Works
and their Chapters. Saved Reader Locations, automatic startup fallback, and
explicit Reader Links must remain distinct intents with distinct outcomes.

Restore a saved location when its Work is complete. If saved state points to an
unavailable Work, open the first Passage in the chronologically earliest
downloaded Work. If there are no downloaded Works, show the explicit offline
empty state. An explicit Reader Link to an unavailable Work must preserve that
requested destination and show an unavailable state rather than applying the
saved-state fallback.

User stories covered: 18 and 20–23.

## Acceptance criteria

- [ ] While already offline, the Jump Work list contains only complete downloaded Works and only their Chapters.
- [ ] Existing Work-title and author filtering operates over the downloaded-only set while offline.
- [ ] A saved Early Christian Reader Location is restored when its Work is complete and locally available.
- [ ] If the saved Work is unavailable, startup opens the first Passage of the chronologically earliest complete downloaded Work.
- [ ] Fallback ordering uses the reader's existing stable chronology rather than download time.
- [ ] With no complete downloaded Works, the Early Christian reader shows “No Early Christian works are available offline” and provides an action to open Scripture.
- [ ] A direct Reader Link to an undownloaded Work preserves the requested URL and shows an unavailable-offline state with paths to downloaded Works and Scripture.
- [ ] A stale Jump dialog that was opened before reachability failed closes and returns to the reader if the user selects an unavailable destination.
- [ ] Passive scrolling continues to persist Reader Location and does not turn scroll position into navigation state.
- [ ] The production-server Puppeteer flow separately verifies saved-location restoration, chronological fallback, the no-download empty state, downloaded-only Jump, and explicit unavailable Reader Links.

## Blocked by

- [02 — Download and Read One Early Christian Work Offline](02-download-early-christian-work.md)
