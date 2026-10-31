import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

const MAX_BODY_BYTES = 16 * 1024;

/** Path-only bridge through the existing host router. All API work runs in Rust. */
async function forwardRustApi({ request }: LoaderFunctionArgs | ActionFunctionArgs) {
  const incoming = new URL(request.url);
  const origin = new URL(process.env.R_CROSS_CANNON_ORIGIN ?? "http://127.0.0.1:3006");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)) {
    return Response.json({ error: "Rust API origin must be loopback" }, { status: 503 });
  }
  let body: Uint8Array | undefined;
  if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_BODY_BYTES) {
          await reader.cancel();
          return Response.json({ error: "Request body is too large" }, { status: 413 });
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
  }
  try {
    const upstream = await fetch(new URL(incoming.pathname + incoming.search, origin.origin), {
      method: request.method,
      headers: { "Content-Type": request.headers.get("Content-Type") ?? "application/json" },
      body: body ? new TextDecoder().decode(body) : undefined,
      signal: AbortSignal.timeout(25_000),
      redirect: "error",
    });
    const headers = new Headers(upstream.headers);
    headers.delete("transfer-encoding");
    headers.delete("content-length");
    headers.set("Cache-Control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return Response.json(
      { error: "R Cross Cannon is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const loader = forwardRustApi;
export const action = forwardRustApi;
