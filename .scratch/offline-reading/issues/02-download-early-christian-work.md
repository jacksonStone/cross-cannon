# Download and Read One Early Christian Work Offline

Status: ready-for-agent

## Parent

[Offline Reading PRD](../PRD.md)

## What to build

Deliver the first complete opt-in path for one Early Christian Work. An online
reader can use the existing reader tools menu to download the active Work, then
open and read every Chapter of that Work after network access is removed.

Store the Work's text responses in browser storage and retain only the durable
metadata necessary to know which Work version and expected Chapters comprise a
complete download. Include both original and modernized text when supplied by
the Chapter data, but do not download remote audio. Offline state remains local
to the current browser storage container, and text downloads may use cellular
connections without an additional warning.

User stories covered: 5–8, 19, 30, 35, and 44.

## Acceptance criteria

- [ ] The online Early Christian reader tools menu exposes a “Download work” action for the active Work.
- [ ] Activating the action downloads every expected Chapter belonging to the Work and does not download remote audio.
- [ ] Original and modernized text remain selectable offline wherever the downloaded Chapter supplies both modes.
- [ ] The Work is recorded as offline-ready only after every expected Chapter has been stored successfully.
- [ ] A partial Work is never described as downloaded or offered as complete offline content.
- [ ] After download completion and network removal, Reader Navigation can traverse every Chapter and Passage of that Work.
- [ ] The download path does not require Wi-Fi or add a metered-network confirmation.
- [ ] Downloaded content and completion metadata remain scoped to the current browser origin and storage container; no synchronization behavior is introduced.
- [ ] The Early Christian manifest and Work index information required to interpret the downloaded Work remain available offline.
- [ ] The production-server Puppeteer flow downloads a Work through the user interface, enters offline mode, and verifies complete text reading through external behavior.

## Blocked by

- [01 — Read Scripture Offline from Any Reader Link](01-read-scripture-offline.md)
