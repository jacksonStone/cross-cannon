import { readFile } from "node:fs/promises";
import path from "node:path";

import { redirect } from "@remix-run/node";

export async function loader() {
  const manifest = JSON.parse(
    await readFile(path.join(process.cwd(), "scripture-cache/manifest.json"), "utf8")
  ) as {
    jsonPath?: unknown;
  };

  if (typeof manifest.jsonPath !== "string") {
    throw new Response("Scripture cache manifest is invalid.", { status: 500 });
  }

  return redirect(manifest.jsonPath, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
