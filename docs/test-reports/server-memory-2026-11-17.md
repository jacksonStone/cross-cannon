# Server memory implementation and validation — 2026-11-17

Follow-up: [successful production release and memory observations](server-memory-production-2026-11-17.md).
The implementation phase described below preceded that separately requested deployment.

Implemented the first recommendations from the
[memory investigation](../research/server-memory-2026-11-17.md).
No deployment, production configuration change, database update, or indexing
operation was performed. Existing unrelated work was left intact.

## Changes

- `Library::load_server` now omits original-text and per-verse reader strings
  during construction, while retaining display text, passage identities,
  filtering metadata, chapter structure and audio metadata. Complete artifact,
  native and browser loading keeps its original representation and wire format.
- Server keyword normalization has a **16-MiB LRU entry budget**, counting vector
  and String capacities. Books larger than the budget normalize one passage at
  a time. Reader caching keeps its prior lazy policy. The budget limits retained
  normalized entries, not the complete process: in-flight searches can hold
  evicted entries or build replacements. All blocking search stages now retain
  the four-search permit until work finishes, including after HTTP cancellation.
- Classics source projection, semantic refinement and commentary share one lazy
  metadata catalog. Refinement batches reuse quotation ranges instead of
  reparsing the complete catalog. Commentary lazily retains merged coverage
  ranges rather than parsed chapter text. Catalog/coverage read failures remain
  retryable; successful initialization is reused for the immutable release.
- Commentary has two dedicated blocking-work permits, retained through client
  cancellation. Excess requests receive HTTP 429, `Retry-After: 1`, and the
  existing commentary response shape with an explanatory error.

## Linux memory comparison

Built the unchanged baseline at commit
`743f7db2003a4fd4b26444b625a178934aeb947b` and the final reviewed implementation
through the repository's local Linux Docker build. Three fresh containers per
binary used the same current immutable data, `linux/amd64` Debian Bookworm,
two CPUs, a 1,200-MiB memory cap, swap disabled, read-only root/data mounts,
and no account credentials or embedding-provider key. Containers served only
loopback-published local HTTP requests and were stopped after each run.

Each process completed health/startup, one full-library Orthodox-canon keyword
query (`love`, limit 20), three warm repeats, then Psalm 119:1–8 commentary and
ten warm repeats. Statistics come from `/proc/1/status` and the container's
cgroup files. This x86-64 container runs on an Apple Silicon workstation;
memory measurements are Linux observations, not a production capacity guarantee.

| Stage | Baseline median RSS | Optimized median RSS | Reduction |
| --- | ---: | ---: | ---: |
| Startup | 787.89 MiB | 497.97 MiB | 289.92 MiB / 36.8% |
| After keyword queries | 946.13 MiB | 523.63 MiB | 422.50 MiB / 44.7% |
| After commentary queries | 976.12 MiB | 547.37 MiB | 428.75 MiB / 43.9% |

The six runs had no OOMs or swap use. Health, keyword result and commentary
response hashes matched before/after, excluding only search `elapsedMs`.
Startup RSS varied by less than 0.1 MiB within each group; the final stage varied
by less than 0.1 MiB as well. These are complete-change measurements, not an
attribution of each saved byte to an individual optimization.

The cgroup peak remained near the cap: baseline **1,200 MiB**, optimized final
stage **1,197.68–1,199.98 MiB**. Optimized anonymous memory fell to approximately
541.4 MiB while file cache grew to approximately 641.4 MiB. The baseline recorded
memory-limit reclamation events; optimized runs recorded none. File cache and
kernel memory remain charged to the service, so the RSS saving must not be
described as an equivalent fall in cgroup totals or permission to lower the cap.

The memory runs overlapped some local verification work. Their highly stable
RSS values support the memory result; startup/request timings from those runs
are confounded by CPU/I/O activity and are not used for a latency claim.

## Scoped-search latency tradeoff

After verification/builds finished, one additional fresh container per binary
ran fifteen warm requests per keyword scope and ten commentary repeats. Medians
below are illustrative local measurements under x86-64 emulation, not production
latency estimates; a longer interleaved performance study would improve confidence.
Result hashes matched for every scope and repeat.

| Warm request | Baseline median | Optimized median |
| --- | ---: | ---: |
| Whole-library keyword | 38.60 ms | 207.47 ms |
| Scripture keyword | 2.60 ms | 2.90 ms |
| John-only keyword | 1.20 ms | 1.11 ms |
| Psalm 119 commentary | 29.96 ms | 1.29 ms |

Whole-library repeats pay normalization again after eviction; that is the main
performance tradeoff of the small cache. Scripture and single-book requests
retain effective caching. Commentary avoids repeated catalog/chapter parsing.

## Validation

- **`npm run verify`: passed under Node 26.13.0** from `.nvmrc`. This includes
  eight shared core tests, 38 server/API/account tests plus the TCP test,
  off-server tooling and protocol checks, typechecking, browser/server builds,
  mobile startup and scrolling checks, form searches, text/audio resources,
  and the browser account/native consent and synchronization journey.
- The Linux release Docker build passed 35 API/unit tests plus the TCP test.
  The three private-index integrations ran locally in full verification against
  `load_server`, exercising the optimized production representation.
- New/expanded regressions compare all server passage display text, references
  and verse coverage against complete reader loading; compare exact keyword
  results/scores under both normal and tiny budgets; exercise Unicode,
  oversized-book fallback, cache reuse, eviction, accounting and concurrent
  readers; preserve commentary coverage gaps and quotation exclusions; prove
  retry after initial file errors and reuse after successful initialization;
  and prove a cancelled search retains its permit until blocking work completes.
- The existing native bundle round trip, progressive hydration and offline
  text/search checks passed. Shared browser WASM built and browser smoke,
  startup, scrolling, search, resource and account journeys passed.

An initial run used the shell's Node 20 and failed only at the final account
journey because `node:sqlite` was unavailable. The complete verification suite
was rerun successfully with Node 26.13.0; the initial failure was environmental.
Earlier sandboxed authentication tests could not bind loopback; the approved
local verification run passed those tests.

## Review

### Standards

No remaining documented-standard or substantive maintainability findings.
Review identified permanently cached transient I/O errors; successful-only
initialization and failure/recovery tests resolved that concern.

### Spec

No remaining spec findings. Review identified the pre-existing search-permit
cancellation gap relevant to the cache's memory envelope; retaining permits
inside blocking stages and the cancellation regression test resolved it.

## Limits and follow-up

The 16-MiB budget deliberately trades repeated whole-library keyword throughput
for bounded retention. Large uncached books still require normalization CPU.
Actual allocator retention, concurrent requests and file cache add to that
budget; it is not a process-wide memory ceiling. Commentary can briefly parse
one complete chapter per active lookup, with at most two commentary tasks.

Vector quantization, replacement search artifacts, metadata interning and account
pagination were deferred. They require separate ranking/protocol design or
additional attribution and are not needed for the measured reduction. Existing
float32 vectors and exact ranking behavior remain intact. The separately
requested [production release](server-memory-production-2026-11-17.md) includes
initial before/after samples; a longer load test remains future validation.
Production was not touched during the initial implementation phase.

Local evidence lives under `.tmp/server-memory/`: `verify-final.log`,
`api-final.log`, `linux-final-build.log`, `benchmark.py`, and before/after JSON.
The [archived raw measurements](server-memory-2026-11-17.json) preserve all six
memory runs and the two separate latency runs, including cgroup statistics,
individual timings and response hashes.
Linux binary SHA-256 values:

```text
baseline  0e47bac59efe8508a7a1592f5b55ee5cab5358726994affee19d02b9037bd447
optimized 8c554853e35d210e0846728e04e3b4665bc9d1a63421d6ee262d4cb6c6325a50
```
