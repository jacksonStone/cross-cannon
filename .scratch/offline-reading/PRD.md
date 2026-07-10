# PRD: Offline Reading

Status: ready-for-agent

## Problem Statement

Cross Canon readers currently depend on a live connection even when they only
want to continue reading text that is already available to the browser. A lost
connection, unusable Wi-Fi network, DNS failure, or Cross Canon outage can
prevent a reader from reopening Scripture, following a Reader Link, restoring a
Reader Location, or continuing through an Early Christian Work.

Scripture is small enough to retain as a complete corpus, but the Early
Christian Works collection is large enough that readers need control over which
Works occupy storage on each device. Browser storage can also be interrupted,
reclaimed, or isolated by browser profile, so the product must make a precise
offline promise without presenting incomplete content as available.

## Solution

Make the complete Scripture Cache and reader application shell available
offline automatically after one successful online load. Allow readers to opt
individual complete Early Christian Works into offline availability from the
existing reader tools menu. Retain text only, validate every downloaded Work,
and replace a complete version only after its update has completed.

When Cross Canon is offline or unreachable, Reader Navigation continues using
locally available content. The interface shows a subtle persistent indicator at
the bottom, removes actions that require the server, limits Early Christian
Work navigation to downloaded Works, and applies explicit fallback behavior for
missing Reader Locations and unavailable Reader Links. Connectivity recovery
restores the complete online interface without requiring a reload.

## User Stories

1. As a Scripture reader, I want the complete Scripture corpus retained automatically, so that I can read without planning downloads in advance.
2. As a Scripture reader, I want offline availability after one successful online load, so that a later loss of connectivity does not interrupt reading.
3. As a Scripture reader, I want every valid Scripture Reader Link to open offline, so that bookmarks and shared links are useful without a connection.
4. As a returning reader, I want Cross Canon to restore my saved Scripture Reader Location offline, so that I can continue where I stopped.
5. As an Early Christian Works reader, I want to download one complete Work, so that I never discover missing Chapters halfway through offline reading.
6. As an Early Christian Works reader, I want offline downloads to contain both available text modes, so that the text choice remains available offline.
7. As a reader who does not need audio, I want Work downloads to contain text only, so that downloads remain small and predictable.
8. As an Early Christian Works reader, I want to start a download from the existing reader tools menu, so that offline controls do not clutter the reading surface.
9. As an Early Christian Works reader, I want visible download progress, so that I know the Work is not yet ready offline.
10. As an Early Christian Works reader, I want a download to continue when I close the tools menu or navigate elsewhere, so that I do not have to supervise it.
11. As an Early Christian Works reader, I want to cancel an active download, so that an accidental or stalled download does not block me.
12. As an Early Christian Works reader, I want only one manual Work download to run at once, so that download state remains understandable.
13. As an Early Christian Works reader, I want other download actions disabled while a Work is downloading, so that I cannot accidentally start competing downloads.
14. As an Early Christian Works reader, I want the tools menu to identify the currently downloading Work even after I navigate elsewhere, so that I can inspect or cancel it.
15. As an Early Christian Works reader, I want a brief completion message, so that I know the Work is available offline.
16. As an Early Christian Works reader, I want the tools action to change from download to removal after completion, so that the current state is unambiguous.
17. As an Early Christian Works reader, I want downloaded Works marked in the online Jump list, so that I can see what will remain available offline.
18. As an offline Early Christian Works reader, I want the Jump list limited to downloaded Works, so that it never offers a destination that cannot open.
19. As an offline Early Christian Works reader, I want all Chapters of a downloaded Work available through Reader Navigation, so that the Work behaves as a complete text.
20. As a returning Early Christian Works reader, I want my saved Reader Location restored when its Work is downloaded, so that I can continue where I stopped.
21. As a returning Early Christian Works reader whose saved Work is unavailable, I want the chronologically earliest downloaded Work opened at its first Passage, so that offline startup still reaches readable content predictably.
22. As an offline reader with no downloaded Early Christian Works, I want a clear empty state and a route to Scripture, so that I understand what remains available.
23. As a reader following a Reader Link to an undownloaded Early Christian Work, I want an explicit unavailable-offline state, so that Cross Canon does not silently replace my intended destination.
24. As an offline reader, I want a persistent but subtle indicator at the bottom of the reader, so that I understand why the interface has fewer actions.
25. As an offline reader, I want Search, Similar Passages, and Audio removed, so that every visible reader action remains functional.
26. As a reader whose connection fails while a dialog or audio is active, I want my current interaction left alone until I attempt a network-dependent action, so that connectivity changes do not interrupt me unnecessarily.
27. As a reader who attempts a Search Request, similar-passage search, or unavailable jump after connectivity has failed, I want that interaction closed and the reader restored, so that I return to functional offline content.
28. As a reader whose connection returns, I want the online actions restored automatically, so that I do not need to reload.
29. As a reader on unusable Wi-Fi, I want Cross Canon to recognize server unreachability as offline, so that broken network actions are not presented as available.
30. As a mobile reader, I want text downloads allowed over cellular, so that Cross Canon does not impose an unnecessary Wi-Fi requirement.
31. As a mobile reader, I want Cross Canon to request persistent browser storage when possible, so that the browser is less likely to reclaim intentional downloads.
32. As a reader whose browser declines persistent storage, I want downloading to continue, so that optional browser protection does not block offline reading.
33. As a reader with insufficient browser storage, I want a concise “Not enough storage” error, so that the failure is clear without unnecessary detail.
34. As a reader whose download is interrupted, I want a retry to resume missing Chapters, so that already completed transfer work is not wasted.
35. As a reader, I want a Work listed as downloaded only after all its Chapters are present, so that “available offline” is a trustworthy claim.
36. As a reader whose browser storage becomes incomplete, I want the affected Work excluded from offline navigation until repaired, so that reading does not fail halfway through.
37. As a reader who reconnects with an incomplete Work, I want Cross Canon to repair it automatically, so that offline availability returns without another manual workflow.
38. As a reader with downloaded Works, I want text updates installed automatically while online, so that offline content stays current.
39. As a reader receiving an update, I want the previous complete version retained until the replacement is complete, so that an interrupted update cannot remove offline access.
40. As a reader actively requesting a download, I want that download prioritized over background updates, so that my explicit action completes first.
41. As a reader using the app during an update, I want my reading session left uninterrupted, so that updates activate only on a later navigation or reload.
42. As a reader removing a downloaded Work, I want an “Are you sure?” confirmation, so that I do not discard offline content accidentally.
43. As a reader who removes the active Early Christian Work, I want to return to my saved Scripture Reader Location, so that I land on useful offline content.
44. As a reader using more than one device or browser, I want offline state understood as local to each browser profile, so that there is no false expectation of download synchronization.
45. As a regular browser user, I want offline reading without installing an app, so that Add to Home Screen is never a prerequisite.
46. As a reader who prefers an installed experience, I want Cross Canon to be manually installable from the browser, so that I can add it to my Home Screen without an in-app prompt.
47. As a reader on a current mobile or desktop browser, I want consistent offline behavior, so that the feature works across modern Safari, Chromium, and Firefox environments.
48. As a reader using an unsupported browser, I want Cross Canon to degrade to its current online behavior, so that missing offline APIs do not break reading.

## Implementation Decisions

- The complete, versioned Scripture Cache is the offline text source for
  Scripture. It is retained automatically after the first successful online
  reader load; Scripture does not receive a manual download control.
- A service worker supplies the cached reader application shell, versioned
  static resources, and offline navigation responses. Reader routes must be
  resolvable from locally available data so that any valid Scripture Reader
  Link can open without a previously cached route-specific document.
- Cache Storage holds application and text response bodies. A small durable
  browser metadata store records Early Christian Work download state, content
  version, expected Chapters, completion, and active progress. Large text
  payloads are not stored in localStorage.
- The Early Christian Works manifest and book index remain available offline so
  Reader Navigation can derive the downloaded-only Work and Chapter choices.
- An Early Christian Work is the unit of user-controlled download and removal.
  A download includes every Chapter JSON resource for that Work, including
  original and modernized text when present. Remote audio is excluded.
- A Work becomes offline-ready only after every expected Chapter has been
  validated in browser storage. Partial resources may be retained for retry,
  but partial Works are excluded from offline navigation and never described as
  downloaded.
- Manual downloads use a single active-download state. Other Work download
  actions are disabled until the active download completes or is canceled.
  Closing the tools menu or navigating to another Work does not cancel the
  download.
- The reader tools menu always exposes the active Work download title,
  Chapter-level progress, and cancellation while a manual download is running.
  Canceling removes the partial resources for that attempt and releases the
  single-download lock.
- Automatic Work updates are opportunistic while online. They yield to a manual
  download and resume later. Updates use a stage-and-swap process: the complete
  existing version remains active until the replacement validates, after which
  old version resources are removed.
- Scripture Cache and application-shell updates use the same complete-before-
  replacement rule. An update does not force a refresh or interrupt the current
  reader session; it becomes active on a later navigation or reload.
- On the first user-initiated Work download, Cross Canon checks whether origin
  storage is already persistent and requests persistent storage when the
  browser API is available. A declined, unsupported, or silently denied request
  does not block the download.
- Storage and cache operations handle quota exhaustion explicitly. A failed
  attempt cleans up its incomplete transaction, preserves complete offline
  content, releases the download lock, and presents only “Not enough storage.”
- Offline state is established when the browser reports lost connectivity or
  when Cross Canon reachability fails. Browser connectivity events can update
  the UI quickly, but successful or failed requests remain the authority for
  real reachability so unusable Wi-Fi and service outages behave as offline.
- A fixed bottom-edge “Offline” indicator remains visible for the entire
  offline session and respects mobile safe-area insets without covering reader
  content or controls.
- Search, Similar Passages, and Audio controls are omitted while offline. The
  offline transition itself does not close an already-open search dialog or
  pause already-playing audio. A subsequent network-dependent action that
  cannot proceed closes its dialog or interaction and restores the reader.
- Reconnection removes the offline indicator and restores online-only controls
  without a document reload.
- While already offline, the Early Christian Work Jump interface contains only
  complete downloaded Works and their Chapters. Existing author and text
  filtering operates over that reduced set.
- If a saved Early Christian Reader Location belongs to a complete downloaded
  Work, Reader Navigation restores it. Otherwise it opens the first Passage of
  the chronologically earliest complete downloaded Work. Chronology uses the
  reader's existing stable Work ordering, not download time.
- If no Early Christian Work is complete, the offline Early Christian reader
  shows an explicit empty state with an action to open Scripture. It does not
  silently switch corpora.
- An explicit Reader Link to an undownloaded Early Christian Work preserves the
  requested destination and shows an unavailable-offline state with routes to
  downloaded Works or Scripture. Explicit intent does not use the saved-state
  fallback rule.
- Removing the active downloaded Work requires a confirmation. Successful
  removal switches to the saved Scripture Reader Location rather than another
  Early Christian Work.
- The online Jump Work list displays a small availability marker for complete
  downloaded Works. There is no dedicated offline-download manager, total
  storage dashboard, bulk download, or bulk removal surface in v1.
- Offline content and metadata are local to one browser origin and storage
  container. They are not synchronized across devices, browser profiles,
  private sessions, or a separately installed Home Screen web app.
- Text downloads are allowed on cellular and do not require a metered-network
  confirmation.
- A web application manifest and appropriate icons make Cross Canon manually
  installable. The product does not show an install prompt, and installation is
  never required for regular-browser offline reading.
- Current evergreen Safari/iOS, Chromium/Android, Firefox, and desktop browsers
  are the supported baseline. Persistent storage protection is progressive;
  service-worker or Cache Storage absence degrades to the existing online
  reader without legacy polyfills.
- Reader Location remains the source of truth for restoration and fallback.
  Offline behavior does not introduce raw scroll-offset persistence and remains
  consistent with the existing Reader Navigation decision.

## Testing Decisions

- The primary and intentionally singular testing seam is a browser-level
  offline-reader flow built on the existing production-server Puppeteer
  harness. It exercises the built Remix application through real navigation,
  service-worker control, Cache Storage, browser storage, connectivity changes,
  and reader UI behavior.
- Tests assert external behavior rather than cache names, internal metadata
  shapes, hook state, or service-worker implementation details. Good assertions
  answer whether a Reader Link opens, a Passage is readable, a control is
  present, a Work is offered by Jump, a Reader Location is restored, or an
  error/status is communicated.
- The browser flow first loads Scripture online, waits for explicit offline
  readiness, disables network access, opens a fresh Scripture Reader Link, and
  verifies readable Passages, restored Reader Location, offline indication,
  hidden online-only actions, and normal Scripture Reader Navigation.
- The flow downloads an Early Christian Work through the reader tools, verifies
  progress and completion, enters offline mode, opens the Work and its Chapters,
  and verifies that Jump contains only downloaded Works.
- The flow covers an unavailable saved Early Christian Reader Location, the
  chronologically earliest downloaded-Work fallback, the no-download empty
  state, and an explicit unavailable Reader Link without conflating those
  distinct navigation intents.
- The flow verifies single-download locking, continued progress after closing
  the menu or navigating, cancellation cleanup, interrupted-download retry, and
  the rule that partial Works never appear offline-ready.
- The flow verifies confirmed removal of the active Work and navigation to the
  saved Scripture Reader Location.
- The flow controls browser reachability to verify entry into offline mode on
  both explicit network loss and failed Cross Canon reachability, then verifies
  automatic UI recovery after reconnection.
- The flow verifies passive connectivity transitions: already-open online
  interactions are not proactively closed, while a subsequent failed Search
  Request, similar-passage search, or unavailable jump returns to the reader.
- The flow controls browser storage capabilities at the browser boundary to
  verify that persistence denial does not block completion and quota exhaustion
  produces “Not enough storage” without damaging completed content.
- The flow verifies update atomicity by making a replacement version fail part
  way through and confirming that the prior complete version remains readable,
  then allowing the update to finish and confirming activation on a later
  navigation or reload.
- The flow removes or invalidates one cached Chapter to verify that an
  incomplete Work disappears from offline navigation and repairs when online.
- At least one mobile viewport and one desktop viewport are exercised because
  the persistent bottom indicator, tools menu, confirmation, and safe-area
  placement are user-visible responsive behavior.
- Prior art is the existing reader kitchen-sink Puppeteer flow, the focused
  Early Christian Passage-selection browser flow, and the production-server
  reader verification command. The offline flow should integrate with that
  verification style rather than introducing a second browser-test framework.

## Out of Scope

- Offline Search Requests, local semantic search, local lexical search, and
  offline similar-passage search.
- Downloading, caching, or guaranteeing playback of Scripture or Early
  Christian audio.
- Automatically downloading the complete Early Christian Works corpus.
- Individual-Chapter downloads, partial-Work availability, collection-level
  downloads, and arbitrary passage bundles.
- A dedicated download manager, bulk removal, total-storage visualization, or
  user-configurable automatic-update policy.
- Account-backed download state, cross-device sync, and transferring cached
  content between regular-browser and installed-app storage containers.
- Forcing or requiring persistent-storage permission, guaranteeing that a
  browser never removes site data, or preventing users from clearing it.
- Requiring installation, showing an install promotion, or building a native
  mobile application.
- Supporting legacy browsers without service workers or Cache Storage through
  polyfills.
- Proactively closing an open search dialog or stopping buffered audio at the
  instant connectivity changes.
- Preserving raw scroll offsets as reader state.

## Further Notes

- The current Scripture Cache is approximately 11 MB as JSON and approximately
  2 MB over the wire when compressed, which supports automatic complete-corpus
  retention.
- The current Early Christian Works corpus is approximately 146 MB across 410
  Works and nearly 13,000 Chapter resources, which supports per-Work opt-in
  rather than whole-corpus automatic retention.
- An individual Early Christian Chapter resource is currently below 500 KB, but
  Work completeness rather than individual resource size defines the product
  promise.
- Browser persistence applies to the entire Cross Canon origin rather than one
  Work. Chromium commonly grants or denies persistence silently; WebKit uses
  browser heuristics. Best-effort storage remains usable when persistence is
  denied but may be reclaimed under pressure.
- On iOS, a Home Screen web app has a separate storage container from its
  regular-browser origin context; existing Work downloads may need to be
  repeated after installation.
- Localhost is treated as a secure context for development, allowing the
  production-server browser harness to exercise service workers without adding
  a separate HTTPS test environment.
