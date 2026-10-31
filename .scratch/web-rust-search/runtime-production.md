# Search runtime comparison

2026-10-31T22:10:48.539Z · linux x64 · Intel(R) Xeon(R) Platinum 8259CL CPU @ 2.50GHz · Node v26.13.0

Sequential alternating backends; one first request per case excluded, then warm samples. Legacy in-process libSQL + JS; Rust release process via loopback HTTP including response validation. Same existing vectors, ten results, identical filters. p95 is nearest-rank; three theme samples are descriptive, not a reliable tail estimate. Theme time includes live OpenAI query embedding. No artifact regeneration.

| Search | Legacy median / p95 (count) | Rust median / p95 | Median ratio | Top 10 overlap |
|---|---:|---:|---:|---:|
| Scripture → Scripture, Protestant canon | 131.5 / 157.8 ms (10) | 19.8 / 23.4 ms | 6.66× | 10/10 |
| Scripture → Scripture, John only | 5.2 / 5.5 ms (10) | 7.7 / 9.4 ms | 0.67× | 10/10 |
| Scripture → Early Christian, all authors | 112.5 / 378.2 ms (10) | 106.8 / 124.6 ms | 1.05× | 9/10 |
| Early Christian → Scripture | 134.6 / 278.6 ms (10) | 19.1 / 23.5 ms | 7.04× | 10/10 |
| Early Christian → Early Christian, Clement of Rome | 8.5 / 9.1 ms (10) | 11.3 / 25.1 ms | 0.76× | 10/10 |
| Theme Scripture: fear and comfort | 336.9 / 385.5 ms (10) | 226.1 / 278.0 ms | 1.49× | 10/10 |
| Theme Early Christian: fear and comfort | 311.7 / 483.4 ms (10) | 268.1 / 307.7 ms | 1.16× | 8/10 |

An incomplete legacy result set is an invalid speed baseline, not a faster search. Rust scores the stored Scripture/chapter vectors exactly; legacy broad searches use an approximate libSQL index. Both refine Early Christian chapters to their best stored paragraph. Ranking differences and selected paragraph IDs are recorded in [runtime JSON](runtime-production.json). No UI rendering time is included.
