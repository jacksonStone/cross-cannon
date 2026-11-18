# Cross Canon server memory research — 2026-11-17

Follow-up: [implementation and Linux before/after validation](../test-reports/server-memory-2026-11-17.md).
This document records the initial research before those changes.

Research only. No application code, production configuration, databases, or
services were changed. Production inspection used read-only systemd/proc/cgroup
metrics and one ordinary health request; no second server, stress test, heap
profiler, cache flush, or restart was run. The initial SSH attempt was blocked
by the local network sandbox; the approved read-only SSH inspection succeeded.

## Recommendation

First prototype a server-specific loading representation that omits unused
original and per-verse reader strings: **234.75 MiB of raw text payload**.
No API source currently reads those fields; complete reader text is served
from immutable files/SQLite. Preserve complete native/browser loading and
explicitly test the server projection. A narrower alternative is sharing the
**116.73 MiB of original text identical to display text**.

Next, bound the lowercase keyword cache. Fully warming it can retain roughly
**130.87 MiB of lowercase text and references**, before entry/container overhead.
These are artifact payload estimates, not measured RSS reductions.

Also bound direct commentary work and share compact commentary/quotation
metadata. This should contain burst allocations without retaining every
commentary chapter in memory.

## Live production observations

Observed on 2026-11-17 at 14:35–14:37 UTC. The running release was
`20261117T140617-rust-4a246923`, PID `71683`, active since 14:07:21 UTC.
Local inspected HEAD was `743f7db2003a4fd4b26444b625a178934aeb947b`; the
production release label is a distinct identifier, not proof of an identical
source commit. Production health and local tallies agree on **498 books,
315,170 resident passages, and 23,896 stored vectors**.

| Metric | Initial observation, 14:35:17 UTC |
| --- | ---: |
| Process RSS | 801.48 MiB |
| Anonymous RSS / private dirty | 794.85 MiB |
| Process high-water RSS | 824.03 MiB |
| Service cgroup current | 1,108.88 MiB |
| Service cgroup peak | 1,111.48 MiB |
| Cgroup anonymous memory | 794.85 MiB |
| Cgroup file cache | 301.95 MiB |
| Of that, inactive file cache | 297.51 MiB |
| Cgroup kernel memory | 12.07 MiB |
| Service swap | 0 MiB |
| Configured service memory maximum | 1,200 MiB |
| Host memory / available | 1,905 / 533 MiB |
| Host swap used / total | 202 / 1,023 MiB |

The initial cgroup total was about 92% of the cap, but roughly 302 MiB was file
cache, mostly inactive. It is not accurate to call all of that live Rust heap.
The kernel accounts anonymous memory, file cache and kernel memory separately;
`memory.max` can trigger reclamation and ultimately a cgroup OOM if memory cannot
be reduced. See the [Linux cgroup v2 memory documentation](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html#memory).

The same PID remained running during a marked change in residency:

| Time UTC | RSS MiB | Cgroup current MiB | Cgroup swap MiB | Cgroup anon + swap MiB |
| --- | ---: | ---: | ---: | ---: |
| 14:35:17 | 801.48 | 1,108.88 | 0 | 794.85 |
| 14:36:32 | 510.19 | 524.43 | 291.23 | 794.87 |
| 14:36:47 | 311.66 | 323.09 | 489.75 | 794.87 |
| 14:37:02 | 311.66 | 322.93 | 489.75 | 794.87 |

Anonymous memory plus swap stayed almost constant while file cache was
reclaimed. This is **swapping, not an application memory optimization**. At
14:37:17 the host had 701 MiB of swap in use and recent host memory pressure
(`some avg60=0.48`, `full avg60=0.45`), with roughly 100–114 MiB/s of writes
during two vmstat intervals. Another Python process was present in an SSH
session. The cause of the host activity was not established; do not attribute
it to a particular deployment, application, or leak.

The Cross Canon cgroup had no `max`, `oom`, or `oom_kill` events, no recorded
cgroup pressure stalls, five threads initially, and zero automatic restarts.
The old `r-cross-cannon` service was inactive. The preceding service incarnation
had logged a roughly 1.0-GiB memory peak and 198-MiB swap peak; its shutdown hit
the 30-second stop timeout. That log is not evidence of an OOM.

Other resident host workloads included `fwupd.service` and Node processes in
`theologian_chat.service`, `libby_cards.service`, and `memory-portal.service`.
Those Node processes belong to other applications. Host capacity planning
should account for them; they are not evidence that Cross Canon still runs Node.

## Source and artifact inventory

The read-only local tally follows `Library::load_server`: Scripture cache
passages, then indexed Work chapter verses grouped in threes, merging trailing
one/two-verse groups. It uses nonempty modernized text for display and source
text for originals. Verse-linked metadata-only commentaries are excluded.
See [the server loading policy](../../rust/core/src/lib.rs#L177),
[Scripture loading](../../rust/core/src/lib.rs#L217), and
[Work loading](../../rust/core/src/lib.rs#L303).

| Collection | Passages | Display UTF-8 bytes | Original UTF-8 bytes | Verse UTF-8 bytes |
| --- | ---: | ---: | ---: | ---: |
| Scripture | 8,360 | 4,836,858 | 4,836,858 | 4,807,190 |
| Early Christian Works | 141,713 | 68,438,833 | 68,441,469 | 68,144,094 |
| Indexed Christian Classics | 165,097 | 50,124,268 | 50,134,284 | 49,791,511 |
| Total | **315,170** | **123,399,959** | **123,412,611** | **122,742,795** |

These three text representations alone total **352.44 MiB**, excluding String
headers/capacity, verse vectors, IDs, author/book/reference duplication, lookup
maps, search caches, allocator overhead and runtime state. This is a payload
accounting exercise, not an allocation-by-callsite profile of production.

Of 315,170 passages, **313,390** have identical original/display strings,
representing **122,402,164 bytes** of duplicate original payload. Removing all
server-only originals plus verse strings would avoid **246,155,406 bytes**.
The inventory used Python's JSON parser and UTF-8 encoding, matching the loader's
grouping/modernization rules. Python Unicode 13.0.0 lowercasing estimated
123,399,959 text bytes plus 13,828,066 reference bytes; confirm Rust Unicode
behavior and allocation capacities before treating normalized bytes as a hard
memory budget. The original/display/verse totals do not depend on lowercasing.

Read-only SQLite inspection found 1,536-dimensional float32 vectors:

| Resident vector collection | Count | Float32 payload bytes |
| --- | ---: | ---: |
| Scripture passages | 8,360 | 51,363,840 |
| Early Christian chapters | 12,956 | 79,601,664 |
| Classics chapters | 2,580 | 15,851,520 |
| Total | **23,896** | **146,817,024 (140.02 MiB)** |

The inventory can be checked with a read-only SQLite URI and
`SELECT count(*), sum(length(embedding)) FROM <table> WHERE embedding IS NOT NULL`,
using `passages` for Scripture and `early_christian_chapters` for Works, plus the
active `scripture_embedding_config` dimensions. The loader filters against
known Library identities; the resulting counts match production health.
See [Engine loading](../../rust/api/src/engine.rs#L55).

## Prioritized opportunities and tradeoffs

1. **Avoid unused reader text in the server representation.** `Passage` owns
   display text, original text and per-verse strings. Inspection with
   `rg -n '\.verses|original_text|reader_text\(' rust/api/src` found no API uses
   of original or verse fields. A dedicated server projection or explicit
   loading policy can avoid allocating **234.75 MiB** of those raw strings plus
   verse structures; keep display text for keyword search and all identity/filter
   metadata. Do this during loading, rather than clearing fields afterward.
   Preserve full reader loading, public Passage semantics, serialization and
   original-text behavior in native/browser clients. A smaller alternative is
   shared immutable storage for equal original/display strings (**116.73 MiB**
   duplicate payload). Changed layouts, sharing costs and allocator retention
   determine actual RSS savings.
   [Passage representation](../../rust/core/src/lib.rs#L59),
   [reader_text](../../rust/core/src/lib.rs#L81),
   [Work construction](../../rust/core/src/lib.rs#L348).

2. **Give normalized keyword text a server memory budget.** Each searched
   book's `OnceLock` permanently retains lowercase text and reference Strings.
   One broad query can initialize nearly the whole cache even with few results.
   The full lowercase display/reference payload is approximately 130.87 MiB;
   entry structures add more. Use a byte-bounded server cache or normalize
   on demand; benchmark the resulting CPU and latency cost. This is intentional
   cache growth, not evidence of a leak. Preserve Unicode behavior, scores,
   filters, canon selection and tie ordering.
   [Cache initialization and matching](../../rust/core/src/lib.rs#L705).

3. **Bound direct commentary requests and reuse compact coverage metadata.**
   `/api/classic-commentary` launches `spawn_blocking` outside the four-slot
   search budget. Each request reparses the 1,320,278-byte Classics catalog and
   matching chapter JSON; Treasury of David Psalm 119 is about 3.3 MB before
   JSON-tree expansion. Use a separate bounded permit and compact immutable
   chapter/verse coverage index, with bounded waiting or explicit overload
   responses. Do not replace this with an unbounded whole-chapter cache.
   Bound account blocking work separately if burst profiling warrants it.
   [Commentary lookup](../../rust/api/src/compat.rs#L594),
   [unguarded spawn](../../rust/api/src/compat.rs#L640),
   [account blocking adapter](../../rust/api/src/accounts/auth.rs#L455).
   Tokio's blocking pool can create up to 512 threads by default and then queue
   work without backpressure; lowering that runtime limit alone does not bound
   request memory. [Tokio Builder documentation](https://docs.rs/tokio/1.54.1/tokio/runtime/struct.Builder.html#method.max_blocking_threads).

4. **Share quotation ranges across semantic batches.** Each Classics refinement
   batch reparses the entire catalog to extract 4,259 range pairs. The pairs
   themselves occupy only 34,072 raw bytes; keys/containers add overhead. Keep
   one compact parsed index per immutable release, also usable for result
   display lookup. This trades a small fixed allocation for less repeated JSON
   parsing, I/O and burst allocation. Exact quotation exclusions must remain.
   [Parallel batches](../../rust/api/src/web.rs#L151),
   [per-batch reload](../../rust/api/src/web.rs#L194),
   [catalog parsing](../../rust/api/src/classics.rs#L11).

5. **Intern repeated search metadata.** Passage IDs are cloned into chapter
   lists and lookup keys; every passage owns book/chapter/author metadata.
   Intern repeated values or reference stable integer identities, materializing
   owned result fields at the boundary. This is a further interface change;
   no reliable byte saving has been measured. Keep stable public IDs and full
   native/browser offline behavior.
   [Passage/Verse](../../rust/core/src/lib.rs#L59),
   [lookup duplication](../../rust/core/src/lib.rs#L492),
   [resource streaming](../../rust/api/src/resources.rs#L305).

6. **Reduce temporary startup/search allocation.** Loading uses whole-file bytes
   plus generic JSON trees before constructing owned data. Typed deserialization
   and releasing intermediate trees sooner may lower startup peaks. Semantic
   ranking currently clones Strings for every eligible hit, sorts all hits,
   then truncates. Rank lightweight `(index, score)` candidates and materialize
   final hits; a top-k implementation must preserve exact tie ordering. Measure
   these smaller gains after the large text allocations.
   [JSON loader](../../rust/core/src/lib.rs#L146),
   [semantic candidates](../../rust/api/src/engine.rs#L154).

7. **Evaluate vector representation only after text fixes.** The permanent
   float32 payload is about 140 MiB. Float16 could remove roughly 70 MiB of
   payload; int8 roughly 105 MiB before metadata/scales. Both change numeric
   scoring and require relevance/ranking validation. A read-only contiguous
   mapped float32 sidecar could preserve values and reduce owned copies, but
   exact scans touch all pages and those pages still count toward cgroup memory.
   Any new artifacts must be built explicitly off-server, never by ordinary
   startup, verification, shipping, or a hidden DB update.

Do not add these estimates as a promised total: representation changes overlap,
cache warmth varies, and freed allocations need not immediately lower RSS.

## Existing safeguards and lower-priority avenues

- Keep one `Arc<Library>` and one app across ports 3005/3006, the existing
  four-search semaphore, and metadata-only loading for JFB, Keil–Delitzsch and
  Treasury of David. Their earlier avoided memory is already reflected in this
  baseline. [main.rs](../../rust/api/src/main.rs#L35),
  [search permits](../../rust/api/src/lib.rs#L155),
  [metadata-only regression test](../../rust/core/src/lib.rs#L1133).
- Audio and static resources stream in 64-KiB chunks; entire audio recordings
  are not currently loaded into application buffers.
  [resources.rs](../../rust/api/src/resources.rs#L305).
- Work paragraph vectors already stream from SQLite during refinement. Do not
  preload every paragraph embedding or equate database size with resident heap.
  [web.rs](../../rust/api/src/web.rs#L199).
- SQLite connection/cache tuning is secondary. Search opens read-only connections
  per operation; account storage uses one mutex-protected connection. SQLite's
  default suggested page cache is approximately 2 MiB per database connection,
  allocated on demand and adjustable at compile time. Measure the actual linked
  SQLite settings before tuning; a bounded connection pool can reduce churn but
  also retains caches. [Search connections](../../rust/api/src/web.rs#L17),
  [account connection](../../rust/api/src/accounts/store.rs#L130),
  [SQLite cache_size documentation](https://www.sqlite.org/pragma.html#pragma_cache_size).
- Account study reads collect all records for one user, then serialize them.
  Cursor-based sync/pagination could bound future large-account response peaks,
  but changes the protocol and is not established as a current memory consumer.
  [Store::study](../../rust/api/src/accounts/store.rs#L192),
  [study response](../../rust/api/src/accounts/mod.rs#L311).
- Raising MemoryMax, adding swap, or dropping Linux caches does not remove
  duplicated allocations. Allocator tuning should follow a measured heap
  profile; five observed threads do not suggest thread stacks are the dominant
  steady-state problem.

## Validation plan

Use a single Linux process on a workstation/container or staging host, with the
same immutable release/data and no unrelated workload. Do not start another
full-Library process on the production host. Compare the baseline and each
candidate separately, at least three times:

1. Capture startup time and peak memory before traffic.
2. Run scoped, full-corpus and cross-corpus keyword searches once, then warm
   repeats; measure retained memory after quiet periods and after cache eviction.
3. Exercise similar-passage and author-filtered semantic searches, then four
   concurrent searches; compare exact IDs, ordering, scores and filters.
4. Exercise ordinary commentary and Psalm 119 with controlled burst concurrency;
   verify bounded work, overload behavior and no unrelated account starvation.
5. Record RSS, PSS/private dirty, cgroup `anon`, `file`, `memory.current`,
   `memory.peak`, swap, `memory.events`, pressure, thread count, p50/p95 latency,
   CPU and response errors. RSS alone is insufficient when the host swaps.
6. Use a heap profiler only on that off-production process to distinguish live
   allocations from allocator retention and verify remaining attribution.

For implementation, run `npm run verify`; retain the existing
[keyword equivalence test](../../rust/core/src/lib.rs#L947),
[actual read-only API/index test](../../rust/api/src/lib.rs#L270),
[batched refinement test](../../rust/api/src/web.rs#L246),
[commentary coverage test](../../rust/api/src/compat.rs#L1020), and native/browser
artifact and offline journeys for shared representation changes. After an
authorized release, use `npm run verify-prod` and repeat read-only sampling.

No application test suite was run for this research-only report. The remaining
uncertainty is allocation-by-callsite attribution and measured improvement for
each candidate; no optimization has been implemented or benchmarked here.
