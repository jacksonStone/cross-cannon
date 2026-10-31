# Web search migration verification

Baseline: `239ae801c`. Both Remix readers now execute theme and similar-passage
searches through the loopback Rust `/r/api/search` service. Rendering and existing
form/result contracts remain in Remix. Native desktop requests remain compatible.

## Checks

- `npm run verify`: 96 unit tests, TypeScript checking, actual read-only Rust API
  integration tests, release Rust build, production Remix build, homepage, and
  both real reader JSON actions pass. The actions verify the Rust response header,
  five John results, and a selected Early Christian paragraph source.
- `scripts/rust.sh clippy --workspace --offline -- -D warnings` passes.
- Desktop and mobile Chromium theme searches return ten results with the Rust
  header. Inspected screenshots: `docs/screenshots/web-rust-search-desktop.png`
  and `docs/screenshots/web-rust-search-mobile.png`.
- Separate Standards and Spec reviews found no remaining issues. The repeated
  source lookup identified during review was replaced with one blocking-worker
  lookup reused for metadata, query vector, and source exclusion.

## Runtime comparison

See [production report](runtime-production.md) and [local report](runtime-local.md)
for median/p95 timings, first requests, raw samples, and ranked results. Seven
warmed stored-vector samples per backend/case; three theme samples plus one first
request. Backends alternate on the same host. Legacy search runs in-process;
Rust timing includes loopback HTTP and validation, so small fixed overheads are
included. Theme measurements include separate live provider requests and should
not be treated as an isolated measure of ranking speed.

Production has a valid legacy Scripture ANN index. The local checkout does not:
legacy broad Scripture searches report `vector index(search): index not found`
and return zero results. Those local rows are explicitly invalid speed baselines.
No index was rebuilt to perform the comparison.

Production broad Scripture median latency improved 6.66–7.04×. Small filtered
searches were 2.5–2.8 ms slower through Rust. Early Christian broad result overlap
is 8–9 of ten chapters because exact chapter candidate scoring replaces the
legacy approximate shortlist; tested Scripture and author-filtered cases match
all ten chapters/passages. Best-paragraph refinement still uses existing vectors.

## Publication

Rust release: `20261031T220516Z`. Web release: `20261031T221121Z`.
The Rust release passed keyword and author-filtered web paragraph smoke checks
before switching. The web release passed a real theme action with five results
and `X-Cross-Canon-Search: rust` before accepting the release.
`npm run verify-prod` passed after publication: remote web service active, public
homepage 200, both public reader actions returned five John passages with the
Rust header, and the production theme POST succeeded.

Used the existing compiled-build fallback because the standard remote dependency
reinstallation exceeded the host's build memory limit in the previous release.
The unchanged production dependency lock SHA-256 is
`9c803b617b6f79ae966e3914259d0eb7dc21fd5160f571cd947bb1cc33533bee`.
No dependencies, text caches, embedding artifacts, or audio/timestamp artifacts
were regenerated or deployed. Production health retains cache version
`98c414bddc31ea96`, 491 books, 150,073 passages, and 21,316 indexed paragraph/chapter
vectors. Unrelated checkout changes were preserved.
