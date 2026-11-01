# Direct proxy runtime: after

2026-11-01T11:42:00.303Z · Intel(R) Xeon(R) Platinum 8259CL CPU @ 2.50GHz

Actual production TLS edge reached through loopback DNS with normal certificate validation and original Host/SNI. Other paths use loopback HTTP. Keep-alive; three warmups excluded; 21 sequential samples per backend/case with rotated order. Timings include complete body transfer and exclude hash calculation. Payload hashes/encoding match. Before/after edge runs use the same TLS protocol and URL; no WAN, browser rendering or cold-disk measurement. Normal traffic and visit logging may add noise.

| Resource | Edge TLS median / p95 | Node HTTP median / p95 | Rust HTTP median / p95 |
|---|---:|---:|---:|
| Scripture JSON | 33.18 / 38.70 ms | 43.43 / 69.69 ms | 14.74 / 21.03 ms |
| Scripture gzip | 7.85 / 14.98 ms | 8.29 / 24.70 ms | 3.40 / 8.70 ms |
| Book catalog | 10.41 / 14.43 ms | 10.94 / 19.74 ms | 4.45 / 5.66 ms |
| Chapter JSON | 2.93 / 3.38 ms | 2.28 / 2.39 ms | 0.65 / 0.78 ms |
| Alignment JSON | 3.06 / 3.51 ms | 2.45 / 2.95 ms | 0.73 / 0.88 ms |
| MP3 64 KiB | 1.45 / 1.79 ms | 2.34 / 3.90 ms | 0.81 / 1.02 ms |
| Continuous 64 KiB | 1.46 / 1.86 ms | 2.24 / 3.07 ms | 0.78 / 1.63 ms |
| Continuous 1 MiB | 4.84 / 6.46 ms | 4.86 / 7.77 ms | 1.96 / 2.26 ms |
| Audio HEAD | 4.05 / 10.47 ms | 2.78 / 5.94 ms | 0.73 / 4.01 ms |
