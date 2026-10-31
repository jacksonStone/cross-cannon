# Search runtime comparison

2026-10-31T22:08:42.748Z · darwin arm64 · Apple M1 · Node v24.13.0

Sequential alternating backends; one first request per case excluded, then warm samples. Legacy in-process libSQL + JS; Rust release process via loopback HTTP including response validation. Same existing vectors, ten results, identical filters. p95 is nearest-rank; three theme samples are descriptive, not a reliable tail estimate. Theme time includes live OpenAI query embedding. No artifact regeneration.

| Search | Legacy median / p95 (count) | Rust median / p95 | Median ratio | Top 10 overlap |
|---|---:|---:|---:|---:|
| Scripture → Scripture, Protestant canon | 1.0 / 1.2 ms (0) | 6.8 / 7.2 ms | invalid baseline | 0/10 |
| Scripture → Scripture, John only | 1.9 / 2.1 ms (10) | 2.2 / 2.3 ms | 0.89× | 10/10 |
| Scripture → Early Christian, all authors | 54.7 / 58.6 ms (10) | 38.9 / 42.1 ms | 1.40× | 9/10 |
| Early Christian → Scripture | 1.0 / 1.1 ms (0) | 5.4 / 5.5 ms | invalid baseline | 0/10 |
| Early Christian → Early Christian, Clement of Rome | 3.9 / 4.0 ms (10) | 4.0 / 4.6 ms | 0.98× | 10/10 |
| Theme Scripture: fear and comfort | 217.3 / 225.0 ms (0) | 335.5 / 388.7 ms | invalid baseline | 0/10 |
| Theme Early Christian: fear and comfort | 326.3 / 361.7 ms (10) | 279.3 / 282.5 ms | 1.17× | 8/10 |

An incomplete legacy result set is an invalid speed baseline, not a faster search. Rust scores the stored Scripture/chapter vectors exactly; legacy broad searches use an approximate libSQL index. Both refine Early Christian chapters to their best stored paragraph. Ranking differences and selected paragraph IDs are recorded in [runtime JSON](runtime-local.json). No UI rendering time is included.
