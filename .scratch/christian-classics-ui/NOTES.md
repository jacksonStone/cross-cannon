# Christian Classics

Status: A + B + C deployed; production verification and desktop/mobile browser checks passed.

A is the quiet shared reader with a named collection chooser. B is its browsing
destination at `/christian-classics`. C opens original commentary from a selected
Scripture Passage. The temporary prototypes and sample fixtures have been removed.

## Scope

- Four source editions: Imitation of Christ, Catena Aurea, Matthew Henry’s complete
  commentary, and Wesley’s Explanatory Notes. See the source manifest and research.
- One shared Work reader, chapter renderer, chapter-window/navigation behavior,
  settings, Jump, search pipeline, and offline Work download lifecycle.
- Each Collection retains its own reading position and favorites. Existing Early
  Christian links and sentence identifiers remain compatible.
- Full imports preserve original chapter references, source text, footnotes where
  present, and Scripture coverage for commentary. Wesley’s source lacks 2 Samuel
  24; this is disclosed in the edition metadata rather than silently filled.
- A third explicit search corpus and a separate Classics database reuse the
  existing indexer and Rust scoring/refinement. Runtime/deploy never index texts.
- Original commentary selection uses source verse coverage, not generated notes.

## Validation

- Imports reproduce manifest `16342c4704d5d62b`: four Works, 2,580 Chapters,
  165,097 indexed Passages; all Chapter and Passage vectors are present.
- 116 JS tests, typecheck, four Rust API tests, four Rust core tests (including
  native text round-trip and collection-isolated keyword search).
- Desktop/mobile browser checks cover library filters, collection chooser,
  edition details, Jump, original commentary selection, cross-collection search
  result opening, full Classic download, offline direct Reader Links, and
  passage-level resume from the library.
- Existing offline regression covers atomic shell updates, cancellation,
  interrupted-update resume, priority, quota recovery, missing-Chapter repair,
  origin outages, no-download state, and cold startup via the collection chooser.
- Screenshots: `docs/screenshots/christian-classics/{library,reader,chooser,commentary}-{desktop,mobile}.png`,
  `commentary-mobile-notes.png`, and `offline-mobile.png`. Captures use Chrome’s
  headless shell and fallback fonts because external Google font requests stall
  in this environment.

`VERIFY_PORT=3016 npm run verify` passed after indexing completed, including
Scripture ↔ Classics web searches and byte-for-byte Rust resource checks.

Production: <https://www.crosscanon.com/christian-classics>.

Production release requested in the follow-up. The completed database and
matching text artifacts were provisioned separately, with transfer checksum and
full vector-count validation. Rust and web releases are now verified in production.

The server recovered after the user rebooted EC2, with HTTPS and SSH restored at
20:15 UTC. The new Rust release `20261111T193616Z` was activated as the single
managed instance and passed collection search and resource checks. A persistent
1 GiB swap buffer and 1,200 MiB Rust service limit are now applied. Phone work is
on hold. See `server-recovery.md` for incident evidence and recovery details.

Web release `20261111T202411-3a42cef495` activated at approximately 20:25 UTC.
`npm run verify-prod` passed search, resource, direct Rust proxy, and service
checks. Live desktop and mobile browser checks passed the four-Work library,
shared reader, and three-commentator Scripture dialog, with no page errors.
Production screenshots: `production-{library,reader,commentary}-{desktop,mobile}.png`
under `docs/screenshots/christian-classics/`.
