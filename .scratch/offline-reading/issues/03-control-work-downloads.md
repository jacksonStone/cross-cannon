# Control and Remove Early Christian Work Downloads

Status: ready-for-agent

## Parent

[Offline Reading PRD](../PRD.md)

## What to build

Make the Early Christian Work download lifecycle understandable and reversible
from the reader. The tools menu must communicate the single active download,
continue it across menu closure and Reader Navigation, allow cancellation, and
confirm completion. Completed downloads must be identifiable in the online Jump
list and removable from the active Work's tools menu.

Removal is intentionally a current-Work action rather than a separate download
manager. It requires confirmation and returns the reader to the saved Scripture
Reader Location after the Work has been removed.

User stories covered: 9–17 and 42–43.

## Acceptance criteria

- [ ] The reader tools menu shows Chapter-level progress for the active Work download.
- [ ] Closing the tools menu or navigating to another Work does not cancel or restart the active download.
- [ ] While a download is active, the tools menu identifies that Work and its progress even when another Work is being read.
- [ ] Only one manual Work download may run at once; download actions for other Works are disabled until completion or cancellation.
- [ ] The active download exposes a “Cancel download” action that removes its partial resources and releases the single-download lock.
- [ ] Completion produces a brief “Available offline” confirmation and changes the active Work action to “Remove download.”
- [ ] Complete downloaded Works have a small availability marker in the online Jump Work list.
- [ ] “Remove download” opens an “Are you sure?” confirmation before deleting the Work.
- [ ] Canceling the removal leaves the Work and Reader Location unchanged.
- [ ] Confirming removal deletes the active Work's offline content and completion metadata, then opens the saved Scripture Reader Location.
- [ ] No dedicated download manager, bulk action, or total-storage dashboard is added.
- [ ] The production-server Puppeteer flow verifies progress persistence, single-download locking, cancellation, completion feedback, availability marking, confirmed removal, and the Scripture destination.

## Blocked by

- [02 — Download and Read One Early Christian Work Offline](02-download-early-christian-work.md)
