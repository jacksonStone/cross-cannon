# Direct proxy runtime: before

2026-11-01T11:35:26.710Z · Intel(R) Xeon(R) Platinum 8259CL CPU @ 2.50GHz

Actual production TLS edge reached through loopback DNS with normal certificate validation and original Host/SNI. Other paths use loopback HTTP. Keep-alive; three warmups excluded; 21 sequential samples per backend/case with rotated order. Timings include complete body transfer and exclude hash calculation. Payload hashes/encoding match. Before/after edge runs use the same TLS protocol and URL; no WAN, browser rendering or cold-disk measurement. Normal traffic and visit logging may add noise.

| Resource | Edge TLS median / p95 | Node HTTP median / p95 | Rust HTTP median / p95 |
|---|---:|---:|---:|
| Scripture JSON | 72.60 / 88.62 ms | 47.28 / 69.13 ms | 15.61 / 19.72 ms |
| Scripture gzip | 13.20 / 29.71 ms | 8.61 / 29.85 ms | 3.36 / 4.72 ms |
| Book catalog | 17.22 / 32.77 ms | 12.10 / 36.38 ms | 4.68 / 5.32 ms |
| Chapter JSON | 3.27 / 4.37 ms | 2.13 / 2.60 ms | 0.70 / 1.19 ms |
| Alignment JSON | 3.11 / 3.66 ms | 2.03 / 2.79 ms | 0.68 / 0.77 ms |
| MP3 64 KiB | 3.02 / 5.17 ms | 2.39 / 2.77 ms | 0.91 / 1.24 ms |
| Continuous 64 KiB | 2.96 / 3.60 ms | 2.27 / 2.90 ms | 0.81 / 1.69 ms |
| Continuous 1 MiB | 8.01 / 19.17 ms | 4.99 / 12.03 ms | 2.23 / 12.51 ms |
| Audio HEAD | 2.72 / 3.73 ms | 1.58 / 1.87 ms | 0.51 / 0.65 ms |
