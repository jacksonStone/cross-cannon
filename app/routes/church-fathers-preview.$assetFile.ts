import { readFile } from "node:fs/promises";
import path from "node:path";

import type { LoaderFunctionArgs } from "@remix-run/node";

const PREVIEW_DIR = path.resolve(process.cwd(), "public/church-fathers-preview");

export async function loader({ params }: LoaderFunctionArgs) {
  const assetFile = params.assetFile;

  if (!assetFile || !/^(books|manifest)\.json$/.test(assetFile)) {
    throw new Response("Not found", { status: 404 });
  }

  const body = await readPreviewFile(path.join(PREVIEW_DIR, assetFile));

  return new Response(new Uint8Array(body), {
    headers: jsonHeaders(body.length)
  });
}

async function readPreviewFile(filePath: string) {
  if (!filePath.startsWith(`${PREVIEW_DIR}${path.sep}`)) {
    throw new Response("Not found", { status: 404 });
  }

  try {
    return await readFile(filePath);
  } catch {
    throw new Response("Not found", { status: 404 });
  }
}

function jsonHeaders(contentLength: number) {
  return new Headers({
    "Cache-Control": "public, max-age=60",
    "Content-Length": String(contentLength),
    "Content-Type": "application/json; charset=utf-8"
  });
}
