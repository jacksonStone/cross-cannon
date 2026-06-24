import { gzipSync } from "node:zlib";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { ensureDatabase } from "../app/lib/db.server";
import {
  buildScriptureCachePayload,
  getScriptureCacheVersion
} from "../app/lib/scripture-cache.server";

const cacheDir = path.join(process.cwd(), "scripture-cache");

await ensureDatabase();

const version = await getScriptureCacheVersion();
const payload = await buildScriptureCachePayload();
const body = JSON.stringify(payload);
const gzippedBody = gzipSync(body);

await rm(cacheDir, { force: true, recursive: true });
await mkdir(cacheDir, { recursive: true });

await writeFile(path.join(cacheDir, `${version}.json`), body);
await writeFile(path.join(cacheDir, `${version}.json.gz`), gzippedBody);
await writeFile(
  path.join(cacheDir, "manifest.json"),
  JSON.stringify(
    {
      version,
      jsonPath: `/scripture-cache/${version}.json`,
      gzipPath: `/scripture-cache/${version}.json.gz`,
      generatedAt: new Date().toISOString(),
      passageCount: payload.passages.length
    },
    null,
    2
  )
);

console.log(
  `Built scripture cache ${version}: ${payload.passages.length} passages, ${body.length} bytes, ${gzippedBody.length} gzipped bytes`
);
