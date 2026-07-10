import { readFile } from "node:fs/promises";
import path from "node:path";

import type { LoaderFunctionArgs } from "@remix-run/node";

import { isLocalE2eOutageRequest } from "~/lib/local-e2e-outage.server";

const CHAPTERS_DIR = path.resolve(
  process.cwd(),
  "public/church-fathers-preview/chapters"
);

export async function loader({ params, request }: LoaderFunctionArgs) {
  const chapterFile = params.chapterFile;

  if (!chapterFile || !/^[A-Za-z0-9_.-]+\.json$/.test(chapterFile)) {
    throw new Response("Not found", { status: 404 });
  }

  if (isLocalE2eOutageRequest(request)) {
    throw new Response("Intentional local E2E outage", { status: 503 });
  }

  const filePath = path.join(CHAPTERS_DIR, chapterFile);

  if (!filePath.startsWith(`${CHAPTERS_DIR}${path.sep}`)) {
    throw new Response("Not found", { status: 404 });
  }

  let body: Buffer;
  try {
    body = await readFile(filePath);
  } catch {
    throw new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(body), {
    headers: new Headers({
      "Cache-Control": "public, max-age=60",
      "Content-Length": String(body.length),
      "Content-Type": "application/json; charset=utf-8",
    }),
  });
}
