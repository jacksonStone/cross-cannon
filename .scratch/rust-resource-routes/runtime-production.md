# Resource runtime comparison

2026-11-01T02:18:27.943Z · Intel(R) Xeon(R) Platinum 8259CL CPU @ 2.50GHz · v26.13.0

Same production host, sequential requests, keep-alive, three warmups excluded, backend order rotated each round. Legacy is the previous deployed bundle with its original Remix server on an isolated loopback port; web is the deployed Rust-backed path including Node forwarding; direct is Rust without Node forwarding. Times include complete raw body transfer to this Node client, excluding concatenation/hash calculation. Every response body matches by SHA-256; ranges and gzip stay byte-identical. No provider, browser rendering, WAN/TLS, cold disk, or concurrent-load measurement. Normal production traffic may add noise. p95 uses nearest rank.

| Resource | Legacy median / p95 | Rust via web median / p95 | Rust direct median / p95 | Web time change |
|---|---:|---:|---:|---:|
| Scripture cache, JSON | 41.09 / 63.56 ms | 44.36 / 64.13 ms | 17.56 / 22.53 ms | 8.0% |
| Scripture cache, gzip | 5.70 / 13.26 ms | 9.11 / 12.52 ms | 3.60 / 7.76 ms | 59.6% |
| Early Christian book catalog | 10.52 / 28.54 ms | 12.31 / 33.22 ms | 4.76 / 9.40 ms | 16.9% |
| Early Christian chapter | 1.07 / 1.89 ms | 2.27 / 5.74 ms | 0.64 / 1.19 ms | 111.9% |
| Audio alignment metadata | 1.04 / 1.32 ms | 2.28 / 2.98 ms | 0.65 / 1.06 ms | 118.6% |
| Original MP3, 64 KiB range | 2.24 / 3.44 ms | 2.45 / 3.20 ms | 0.79 / 1.14 ms | 9.0% |
| Continuous audio, 64 KiB range | 2.08 / 2.74 ms | 2.36 / 2.89 ms | 0.77 / 0.90 ms | 13.7% |
| Continuous audio, 1 MiB range | 4.37 / 8.47 ms | 5.11 / 24.35 ms | 2.08 / 6.82 ms | 17.0% |
| Continuous audio, HEAD | 1.52 / 1.84 ms | 1.90 / 2.72 ms | 0.49 / 0.55 ms | 25.3% |

Positive web time change means slower. Direct Rust results isolate handler/transport costs but are not the current public web path. Raw samples, byte counts, hashes, headers and first-byte timings are in [runtime JSON](runtime-production.json).
