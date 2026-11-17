# Memory optimization production release — 2026-11-17

Deployed the memory changes from commit
`c69d7d85a69d510d93169668287d1b79cca96ab0` to
<https://www.crosscanon.com> using **`npm run ship`**, with Node 26.13.0 from
`.nvmrc`. The command completed successfully, including fresh local verification,
hosted Linux build, storage-preserving activation and production verification.

## Exact deployed artifact

- [Hosted build](https://github.com/jacksonStone/cross-cannon/actions/runs/44113002745)
  passed for compiler snapshot `af4df0aab11b2b48c8ad5a2c4fc1337d9f331a24`.
  The release process verified that the snapshot's Rust/Cargo inputs matched
  the checkout before packaging.
- The activated release is **`20261117T152502-rust-4eb9aa3c`**. The managed
  `cross-cannon` service started at **15:25:44 UTC**, PID `75552`.
- Reading `/proc/75552/exe` confirmed the executable belongs to that release.
  Its SHA-256 is
  `8c554853e35d210e0846728e04e3b4665bc9d1a63421d6ee262d4cb6c6325a50`,
  identical to the optimized Linux binary used in the
  [local before/after measurements](server-memory-2026-11-17.md).
- `BUILD-INFO` confirms `linux/amd64`, Rust/Cargo 1.99.1 and the same hosted
  source snapshot. The browser artifact is `70550ba7a6e19fd6a006`.

## Production verification

`npm run verify-prod` passed within `npm run ship`: one managed Rust executable,
both 3005/3006 listeners, reader documents, browser assets/workers, form and
cross-corpus searches, source embedding reuse, text resources and audio ranges,
edge route boundaries, and anonymous/private account endpoint contracts.
The legacy `r-cross-cannon` service is inactive.

All three follow-up health samples returned `status: ok`, with **498 books,
315,170 passages and 23,896 vectors**. No production compiler, Node runtime,
database maintenance, scripture-cache refresh, indexing operation, or memory-limit
tuning was introduced. The existing storage-preserving release path was used.

## Memory observations

Read-only samples were taken over SSH before shipping and after production
verification. No additional full-Library process, stress workload, cache flush,
or heap profiler was started on the host.

| Metric | Before, 15:16:45 UTC | After, 15:27:06–15:27:36 UTC |
| --- | ---: | ---: |
| Process RSS | 847.89 MiB | 510.02 MiB in all three samples |
| Cgroup anonymous memory | 839.02 MiB | 502.20 MiB |
| Service total current | 959.22 MiB | 842.89–843.14 MiB |
| Cgroup file cache | 116.82 MiB | 337.68 MiB |
| Current service peak | 962.39 MiB | 864.96 MiB |
| Service swap | 0 MiB | 0 MiB |
| Service memory maximum | 1,200 MiB | 1,200 MiB |
| Automatic restarts | 0 | 0 |
| OOM / OOM-kill events | 0 / 0 | 0 / 0 |

Initial production RSS is **337.88 MiB lower (39.9%)**. This decrease is not
explained by swapping: application swap remains zero, and anonymous memory
also fell. Linux retained more file cache, so the service total fell less than
RSS. Host-wide swap still contains pages from other activity; it is not the
current Cross Canon service's swap usage.

The samples compare an older, warmed process with a recently started process
after verification. They are useful operational observations, not a controlled
production workload benchmark or a long-term capacity guarantee. The repeated
local Linux comparison provides the controlled memory evidence. Longer
production observation under real traffic remains useful; no scheduled watcher
was created.

## Evidence and remaining work

[Archived production samples](server-memory-production-2026-11-17.json) include
the exact executable identity, build information, health results, systemd memory
properties and cgroup events. Local detail is under `.tmp/server-memory/`:
`ship.log`, `production-before-deploy.txt`, and `production-after-deploy.json`.
The validated 337.7-MiB release archive is under
`.tmp/rust-server-linux-d7fd394a015c/`.

No deployment blockers remain. The unrelated
`docs/research/logos-gap-follow-up-2026-11-16.md` was left unchanged and untracked.
The documented keyword-cache throughput tradeoff remains: repeated full-library
searches recompute evicted normalized text, while scoped searches retain caching.
