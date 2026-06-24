import { readFile } from "node:fs/promises";
import path from "node:path";

import type { LoaderFunctionArgs } from "@remix-run/node";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const cacheFile = params.cacheFile;

  if (!cacheFile || !/^[a-f0-9]{16}\.json$/.test(cacheFile)) {
    throw new Response("Not found", { status: 404 });
  }

  const version = cacheFile.replace(/\.json$/, "");
  const acceptsGzip = request.headers.get("Accept-Encoding")?.includes("gzip") ?? false;
  const cacheDir = path.join(process.cwd(), "scripture-cache");
  const filePath = path.join(cacheDir, acceptsGzip ? `${version}.json.gz` : cacheFile);

  let body: Buffer;

  try {
    body = await readFile(filePath);
  } catch {
    throw new Response("Not found", { status: 404 });
  }

  const headers = new Headers({
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Length": String(body.length),
    "Content-Type": "application/json; charset=utf-8",
    "ETag": `"${version}"`,
    "Vary": "Accept-Encoding"
  });

  if (acceptsGzip) {
    headers.set("Content-Encoding", "gzip");
  }

  return new Response(new Uint8Array(body), { headers });
}
