# Recover Early Christian Work Downloads from Storage Failures

Status: ready-for-agent

## Parent

[Offline Reading PRD](../PRD.md)

## What to build

Make the Early Christian Work download promise resilient to browser permission,
network, quota, and eviction failures. Request persistent origin storage when
the first Work download starts, but treat that protection as optional. Preserve
useful partial transfer state after an interrupted network download so retry can
resume missing Chapters, while cleaning up failed quota transactions.

Validate completed Work metadata against actual locally available Chapters
before presenting the Work offline. If browser storage becomes incomplete,
exclude the Work from offline Reader Navigation and repair its missing Chapters
automatically after reachability returns.

User stories covered: 31–34 and 36–37.

## Acceptance criteria

- [ ] The first user-initiated Work download checks existing persistence and requests persistent origin storage when the browser API is available.
- [ ] A denied, silently rejected, or unsupported persistence request does not prevent the Work download from completing.
- [ ] A quota-exhausted download shows only “Not enough storage.”
- [ ] Quota failure removes the incomplete transaction, preserves every previously complete Work and the Scripture Cache, and releases the download lock.
- [ ] A network-interrupted download retains valid completed Chapters and retries only missing Chapters when the user resumes it.
- [ ] Offline-ready Work metadata is checked against the expected locally available Chapters before that Work is offered by Reader Navigation.
- [ ] If a completed Work loses one or more Chapters, it is excluded from the offline Jump list and cannot fail halfway through offline reading.
- [ ] When reachability returns, an incomplete formerly downloaded Work repairs its missing Chapters automatically and becomes offline-ready only after validation.
- [ ] Recovery does not introduce a detailed storage manager or guarantee that a browser can never clear site data.
- [ ] The production-server Puppeteer flow controls persistence, quota, interruption, and missing-Chapter behavior at the browser boundary while asserting only visible reader outcomes.

## Blocked by

- [02 — Download and Read One Early Christian Work Offline](02-download-early-christian-work.md)
