# Resource runtime comparison

2026-11-01T02:12:38.231Z · Intel(R) Xeon(R) Platinum 8259CL CPU @ 2.50GHz · v26.13.0

Same production host, sequential requests, keep-alive, three warmups excluded, backend order rotated each round. Legacy is the previous deployed bundle with its original Remix server on an isolated loopback port; web is the deployed Rust-backed path including Node forwarding; direct is Rust without Node forwarding. Times include complete raw body transfer to this Node client, excluding concatenation/hash calculation. Every response body matches by SHA-256; ranges and gzip stay byte-identical. No provider, browser rendering, WAN/TLS, cold disk, or concurrent-load measurement. Normal production traffic may add noise. p95 uses nearest rank.

| Resource | Legacy median / p95 | Rust via web median / p95 | Rust direct median / p95 | Web time change |
|---|---:|---:|---:|---:|
| Scripture cache, JSON | 35.10 / 57.77 ms | 52.54 / 64.19 ms | 16.77 / 25.83 ms | 49.7% |
| Scripture cache, gzip | 5.87 / 26.67 ms | 8.98 / 36.36 ms | 3.53 / 43.46 ms | 53.0% |
| Early Christian book catalog | 10.00 / 27.90 ms | 12.32 / 31.58 ms | 4.72 / 7.75 ms | 23.2% |
| Early Christian chapter | 1.42 / 1.88 ms | 42.85 / 43.92 ms | 0.99 / 41.78 ms | 2907.8% |
| Audio alignment metadata | 1.27 / 2.42 ms | 42.81 / 44.00 ms | 0.89 / 41.44 ms | 3266.9% |
| Original MP3, 64 KiB range | 2.28 / 2.78 ms | 2.48 / 3.30 ms | 0.79 / 0.94 ms | 8.9% |
| Continuous audio, 64 KiB range | 1.93 / 3.03 ms | 2.30 / 3.12 ms | 0.76 / 1.33 ms | 19.4% |
| Continuous audio, 1 MiB range | 4.43 / 13.79 ms | 5.11 / 17.52 ms | 1.98 / 3.57 ms | 15.1% |
| Continuous audio, HEAD | 1.65 / 2.12 ms | 2.04 / 2.86 ms | 0.56 / 0.82 ms | 23.3% |

Positive web time change means slower. Direct Rust results isolate handler/transport costs but are not the current public web path. Raw samples, byte counts, hashes, headers and first-byte timings are in [runtime JSON](runtime-production-before.json).
