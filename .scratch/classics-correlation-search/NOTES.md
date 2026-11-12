# Classics correlations, search latency, and screenshot regression

Completed locally on 2026-11-12. No deployment, database changes, or embedding generation.

## Findings and changes

- Henry IV's Scripture markers precede commentary blocks as empty siblings. Recovering their scope raises mapped chapter coverage from 939 to 1,189. All 250 missing chapters are recovered; introductions without source coverage remain unassigned.
- The screenshot's exact indexed passage is `ccw:dc669b7be67d792c4a6b5211`, sentence positions 4–6 in `classics:henry:Prov.16`. Its true Scripture coverage is Proverbs 16:1. Its leading `17.` finishes a Psalm citation, and its final `1.` starts an internal list. These were fragment boundaries, not authored standalone paragraphs.
- Imported records now retain source paragraph IDs. API display reconstructs full original paragraphs, uses their actual Scripture coverage for references, and keeps the original indexed IDs/positions/vectors. Both web result views hide synthetic sentence-number prefixes for Classics. Selected-source summaries also use the corrected display.
- An author filter refines every chapter in that author's scope. Henry has 124,932 indexed paragraphs. The old refinement scored their embeddings serially, joined descriptive tables for every candidate, and constructed intermediate excerpts during scoring.
- Large scopes now score independent batches of 32 chapters using the existing bounded Rayon pool. Small scopes retain one batch. Each worker reads vectors transiently through read-only connections; full paragraph embeddings are not retained in process memory. Text and descriptive metadata are fetched only for final hits. The candidates, normalization, exact dot products, source exclusion and result ordering remain unchanged.

## Local benchmark

Same unpaid Genesis 1:1–6 stored-vector request; ten results. Three HTTP samples per case, including each case's first request. These measurements exclude a live theme-query embedding call and are not production timings.

| Scope | Before median | Final median |
| --- | ---: | ---: |
| Scripture | 6.5 ms | 8.7 ms |
| Early Christian, all authors | 39.2 ms | 33.2 ms |
| Classics, all authors | 201.4 ms | 189.6 ms |
| Classics, Henry only | 3,620.3 ms | 731.9 ms |

Henry speedup: 4.95×. All recorded top-ten IDs, ordering, and scores are exactly equal in all four cases. See `before.json`, `after.json`, and `request.json` in this directory.

## Validation

- `python3 scripts/test-classics-commentary.py` initially failed on the missing 250 chapters and sibling marker fixture; all four tests now pass.
- `check-screenshot.py` initially failed against the original service's `Proverbs 16:4-6` label and orphaned `17.`. The final service passes with `Proverbs 16:1` and the complete paragraph.
- `python3 .scratch/classics-correlation-search/final-check.py` starts and stops an isolated service, checks a minimum twofold speedup, compares exact IDs/scores, and replays the screenshot source.
- `npm run verify` passed: 119 TypeScript tests, seven Python tests, six Rust tests, typecheck, production builds, and web/resource smoke checks. Rust regression compares serial versus parallel scoring across all Wesley chapters, including source exclusion, and checks the exact screenshot source.
- Compared the regenerated assets with immutable predecessors: original text, stable sentence IDs, and reviewed modernization are identical for all 2,580 chapters. Old immutable assets are preserved.
- `check-ui.mjs` performed real unpaid web searches on desktop and mobile, checked the corrected Proverbs 16:1 result, absence of synthetic prefixes and horizontal overflow, and no browser JavaScript errors. Screenshots are under `docs/screenshots/classics-correlation-search/`.
- `git diff --check` passed. All temporary preview/benchmark services were stopped.
