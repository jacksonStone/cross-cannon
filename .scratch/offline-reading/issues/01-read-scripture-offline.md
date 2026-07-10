# Read Scripture Offline from Any Reader Link

Status: ready-for-agent

## Parent

[Offline Reading PRD](../PRD.md)

## What to build

Deliver the first complete offline-reading path for Scripture. After one
successful online reader load, a regular browser must retain the application
shell and complete Scripture Cache well enough to restore a Reader Location and
open any valid Scripture Reader Link without reaching the server.

This slice also establishes the shared user-visible reachability behavior. When
the browser or Cross Canon is unreachable, show the persistent bottom offline
indicator and remove server-dependent reader actions. Recover the full online
interface automatically when reachability returns. The connectivity transition
must remain passive for interactions that were already open.

Make Cross Canon manually installable through standard browser controls without
adding an install promotion or making installation a prerequisite. Browsers
without the required offline APIs must retain the existing online behavior.

User stories covered: 1–4, 24–29, 45–48.

## Acceptance criteria

- [ ] One successful online reader load retains the complete versioned Scripture Cache and the resources required to render the reader offline.
- [ ] With network access disabled, a fresh navigation to any valid Scripture Reader Link renders the requested Scripture Passage even if that route-specific document was not previously opened.
- [ ] With network access disabled, the reader restores the saved Scripture Reader Location rather than a raw scroll offset.
- [ ] A fixed, subtle “Offline” indicator remains at the bottom of the reader for the full offline session and does not cover reader content at desktop or mobile sizes.
- [ ] Search, Similar Passages, and Audio controls are absent while offline.
- [ ] Browser-reported network loss and failed Cross Canon reachability both enter the offline experience.
- [ ] Reconnection removes the indicator and restores online-only controls without requiring a document reload.
- [ ] Losing connectivity does not proactively close an already-open search dialog or pause already-playing audio.
- [ ] A Search Request or similar-passage action attempted after reachability has failed closes its interaction and returns the user to the reader.
- [ ] The application is manually installable from supporting browsers, but no install prompt is shown and regular-browser offline reading works without installation.
- [ ] Browsers without service-worker or Cache Storage support continue using the existing online reader without a new fatal error.
- [ ] The production-server Puppeteer flow verifies the Scripture offline path at both mobile and desktop viewports through external reader behavior.

## Blocked by

None - can start immediately.
