import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createReadableStreamFromReadable } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

const MAX_BODY_BYTES = 16 * 1024;
const HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

/** Raw streaming transport preserves gzip bytes, ranges and content lengths. */
async function forward(request: Request, resource: boolean): Promise<Response> {
  const incoming = new URL(request.url);
  try {
    const origin = new URL(process.env.R_CROSS_CANNON_ORIGIN ?? "http://127.0.0.1:3006");
    if (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) || !["http:", "https:"].includes(origin.protocol)) {
      throw new Error("Rust origin must be loopback");
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
      } finally { reader.releaseLock(); }
      body = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    }
    const headers: Record<string, string> = { host: incoming.host };
    for (const name of ["content-type", "accept", "accept-encoding", "range", "if-range", "if-none-match", "if-modified-since"]) {
      const value = request.headers.get(name);
      if (value) headers[name] = value;
    }
    if (body) headers["content-length"] = String(body.byteLength);
    const target = new URL(`${resource ? "/r/api/resources" : ""}${incoming.pathname}${incoming.search}`, origin.origin);
    // fetch decompresses gzip automatically, invalidating forwarded encoding/length.
    return await new Promise<Response>((resolve, reject) => {
      const upstream = (origin.protocol === "https:" ? httpsRequest : httpRequest)(target, {
        method: request.method, headers, signal: request.signal
      }, response => {
        const outgoing = new Headers();
        const hop = new Set([...HOP_HEADERS, ...(response.headers.connection ?? "").toLowerCase().split(",").map(v => v.trim())]);
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined && !hop.has(name)) {
            for (const item of Array.isArray(value) ? value : [value]) outgoing.append(name, item);
          }
        }
        if (!resource) outgoing.set("Cache-Control", "no-store");
        const status = response.statusCode ?? 502;
        const empty = request.method === "HEAD" || [204, 205, 304].includes(status);
        if (empty) response.resume();
        resolve(new Response(empty ? null : createReadableStreamFromReadable(response), { status, headers: outgoing }));
      });
      upstream.setTimeout(30_000, () => upstream.destroy(new Error("Rust upstream idle timeout")));
      upstream.once("error", reject);
      upstream.end(body);
    });
  } catch {
    return Response.json({ error: "R Cross Cannon is temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export const forwardRustApi = ({ request }: LoaderFunctionArgs | ActionFunctionArgs) => forward(request, false);
export const forwardRustResource = ({ request }: LoaderFunctionArgs) => forward(request, true);
