# Direct Rust reverse-proxy routes

For crosscanon.com and www.crosscanon.com, forward `/r/api` and its descendants
directly to Rust on loopback 3006. Forward the existing Scripture cache, Early
Christian metadata/Chapter, audio and local worker-test resource URLs to Rust's
`/r/api/resources` namespace. Keep React pages, page data/actions, build assets
and other domains on their existing upstreams. Preserve query/escaped paths,
Host, Range, HEAD, gzip bytes, cache headers and API errors. Add an upstream
response marker so verification can prove Node is bypassed. No Node fallback
when Rust is unavailable. Preserve the public worker-test restriction and bare
domain canonical redirect.

Deploy only the shared proxy, verify the existing public application and resource
contracts, prove route selection, and benchmark the edge path versus the Node
forwarding path using identical bytes on the production host. Reuse all existing
text/vector/media artifacts. Preserve unrelated changes in both repositories.
