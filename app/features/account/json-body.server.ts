import { PRIVATE_HEADERS } from "./auth.server";

export async function accountJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
    throw new Response(null, { status: 415, headers: PRIVATE_HEADERS });
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) {
      void reader.cancel();
      throw new Response(null, { status: 413, headers: PRIVATE_HEADERS });
    }
    chunks.push(value);
  }
  try {
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
    return result as Record<string, unknown>;
  } catch { throw new Response(null, { status: 400, headers: PRIVATE_HEADERS }); }
}
