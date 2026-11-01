# Direct Rust proxy verification

Released 2026-11-01 through `../ship.sh --only reverse_proxy`. The shared proxy
implementation is committed in `../reverse_proxy_extended` as `b6ed1dc`.
Cross Cannon baseline: `7dc34a468`; proxy baseline: `6723062`.

## Result

Production Go routes `/r/api` and the existing text/metadata/audio URLs directly
to Rust on loopback port 3006. Original resource paths are rewritten into
`/r/api/resources`; API paths are unchanged. React pages, loaders/actions and
static application assets retain the Node upstream. Local Node compatibility
shims remain available but are bypassed by the production API/resource routes.
Rust connection failures return JSON 503 without a Node fallback.

No Node or Rust restart, text/vector rebuild, timestamp generation or database
maintenance was part of this release. Existing unrelated changes in both
repositories were excluded from these commits.

## Checks

- Shared proxy tests pass with the race detector using local Go 1.22.2 in
  standard-library-only mode. The standard deploy also passes tests and builds
  with the production Go 1.27.3 toolchain.
- Tests cover route boundaries, other hosts, React page/data paths, POST bodies,
  raw escaped paths/query strings, Host, HEAD, ranges, compressed bytes, ETags,
  cache headers, explicit upstream failures and canonical redirects.
- Reserved API suffixes take precedence over the shared robots/ping/webhook
  handlers. A regression test failed before this ordering fix and passes after.
- The standard proxy release succeeds; its public checks pass for Cross Canon
  and the other hosted applications.
- `npm run verify-prod` passes: service status, homepage, both Rust-backed web
  search actions, resource byte/gzip/range/HEAD checks, direct upstream markers,
  React page/data responses, public worker restriction and search POST smoke.
- New JavaScript scripts pass `node --check`; diffs pass whitespace checks.
- The same TLS-edge benchmark before/after validates identical response hashes
  and encodings across all paths. See [runtime comparison](runtime-comparison.md)
  for all medians, p95 values and limitations.

## Review

Standards review: no material findings. Spec review found shared reserved suffix
handling could intercept API requests; the ordering fix and regression tests
resolve it. Follow-up review reports no remaining material gaps.

The release updates only the shared proxy binary. The proxy deployment retains
the previous binary/systemd setup for rollback; its domain-to-port map continues
to use port 3005 for React traffic.
