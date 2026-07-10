# Update Offline Content Atomically

Status: ready-for-agent

## Parent

[Offline Reading PRD](../PRD.md)

## What to build

Keep the offline application shell, Scripture Cache, and downloaded Early
Christian Works current without risking the last complete readable version.
Updates run opportunistically while online, stage the full replacement, and
activate it only after validation. A failed or interrupted update leaves the
prior complete version active.

Manual Work downloads take priority over background Work updates. Updates do
not force a refresh, change the active Reader Location, or interrupt reading;
the replacement becomes active on a later navigation or reload.

User stories covered: 38–41.

## Acceptance criteria

- [ ] A new application-shell or Scripture Cache version is staged completely before it can replace the active offline version.
- [ ] A new version of each downloaded Early Christian Work is detected and downloaded automatically while online.
- [ ] Every expected replacement Chapter validates before the updated Work becomes active.
- [ ] A failed or interrupted shell, Scripture Cache, or Work update leaves the prior complete version readable offline.
- [ ] A user-initiated Work download pauses or takes priority over background Work updating, and background updating may resume later.
- [ ] Update completion does not force a document reload, move the Reader Location, close reader UI, or interrupt the current reading session.
- [ ] A completed replacement activates on a later navigation or reload, after which obsolete version resources are cleaned up.
- [ ] Automatic updates remain allowed over cellular and do not add a user-configurable update policy in v1.
- [ ] The production-server Puppeteer flow fails a replacement part way through, verifies the prior version offline, completes the replacement, and verifies activation only after a later navigation or reload.

## Blocked by

- [01 — Read Scripture Offline from Any Reader Link](01-read-scripture-offline.md)
- [02 — Download and Read One Early Christian Work Offline](02-download-early-christian-work.md)
- [05 — Recover Early Christian Work Downloads from Storage Failures](05-recover-work-downloads.md)
