# Direct Rust routing runtime comparison

Measured on the production host on 2026-11-01, immediately before and after the proxy-only deployment. The public TLS URL, certificate validation, keep-alive, payloads and benchmark script are identical. Loopback DNS excludes WAN latency. Each case has 21 sequential samples after three warmups; backend order rotates. These are complete-response timings, not browser render or concurrent-load results.

| Resource | Before edge median | After edge median | Median reduction | Before / after edge p95 |
|---|---:|---:|---:|---:|
| Scripture JSON | 72.60 ms | 33.18 ms | 54.3% | 88.62 / 38.70 ms |
| Scripture gzip | 13.20 ms | 7.85 ms | 40.5% | 29.71 / 14.98 ms |
| Book catalog | 17.22 ms | 10.41 ms | 39.6% | 32.77 / 14.43 ms |
| Chapter JSON | 3.27 ms | 2.93 ms | 10.6% | 4.37 / 3.38 ms |
| Alignment JSON | 3.11 ms | 3.06 ms | 1.8% | 3.66 / 3.51 ms |
| MP3 64 KiB | 3.02 ms | 1.45 ms | 52.0% | 5.17 / 1.79 ms |
| Continuous 64 KiB | 2.96 ms | 1.46 ms | 50.6% | 3.60 / 1.86 ms |
| Continuous 1 MiB | 8.01 ms | 4.84 ms | 39.6% | 19.17 / 6.46 ms |
| Audio HEAD | 2.72 ms | 4.05 ms | -48.5% | 3.73 / 10.47 ms |

The larger JSON and audio responses improve substantially. Small chapter/alignment responses change little. Audio HEAD is slower in this run; the Node and direct Rust HEAD controls also slow down between runs. That is consistent with shared-host noise, but does not establish its cause or prove a HEAD improvement. This experiment does not demonstrate throughput, CPU, memory, cold-start, or end-user WAN improvements.

All response hashes and encodings match across edge, Node and direct Rust, and across both runs. Before deployment the edge has no `X-Cross-Canon-Upstream` marker; after deployment it is `rust`. The Node forwarding endpoint remains a control and local compatibility path.

See [before](runtime-before.md), [after](runtime-after.md), and their JSON files for controls, headers and individual samples.
