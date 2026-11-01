# Small streamed response latency

The requested resource benchmark found a real regression despite byte-for-byte
response parity: small Chapter and alignment JSON took about 43 ms via the web
bridge, versus 1–2 ms before migration. The web path still includes Node.

## Reproduction and isolation

On the production host:

```sh
node scripts/check-resource-latency.mjs
```

The deployed equivalent failed with median `43.78 ms` across eleven warm requests
on one persistent connection. A temporary raw Node HTTP pipe also reproduced the
delay, ruling out Remix's response shaping. Repeated requests directly to Rust
showed headers arriving in about 1 ms but the body completing after about 42 ms.
This isolated the issue to small streamed bodies on reused Rust TCP sockets.
The temporary pipe server was stopped after diagnosis.

Ranked hypotheses were TCP packet delay, Remix stream flushing, and connection
reuse. The TCP hypothesis matched: the listener left Nagle enabled. Async file
reads can split headers from body data; Nagle plus delayed ACKs then stalls the
small body. Rotating benchmark backends sometimes hid this in direct medians,
but direct p95 and the consecutive-request probe exposed it.

## Fix and regression coverage

The server now sets `TCP_NODELAY` on every accepted connection through Axum's
listener hook. The socket-boundary test
`accepted_streaming_connections_disable_nagle` failed before the fix and passes
afterward. `npm run verify` and workspace Clippy pass. The timing guard stays a
manual check rather than a load-sensitive CI assertion.

Production release `20261101T021616Z` includes the fix. The same consecutive
request guard passed with median **2.39 ms**, down from **43.78 ms**. Final
production verification passed for both search readers and all resource paths.
The complete before/after evidence is retained with the benchmark artifacts.

The underlying gap was timing coverage: successful bytes/headers do not prove
good streaming latency. The new benchmark records first-byte and complete-body
times, uses persistent connections, rotates backends, and checks body hashes.
The manual guard additionally tests consecutive small responses on one socket.

See [before](runtime-production-before.md) and the final
[resource comparison](runtime-production.md). Direct Rust measurements exclude
the remaining Node hop and should not be presented as current public-web timing.
No artifact regeneration is involved.

## Interpretation

The final web path still includes Node forwarding. Its resource response medians
remain above the previous direct Node implementation, despite faster direct Rust
handlers. The final report separates those paths explicitly. This migration is
not a general file-delivery speedup through the existing web router; removing
that forwarding hop is a separate potential improvement. The previously recorded
6.66–7.04× broad Scripture search gain measures ranking work, not file serving.
