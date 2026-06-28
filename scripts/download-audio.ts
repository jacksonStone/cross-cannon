import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { ensureDatabase, getDb } from "../app/lib/db.server";

type AudioRow = {
  audio_url: unknown;
  audio_file_name: unknown;
};

const outputDir = path.resolve(process.argv[2] ?? "storage/audio/WEBD_AT");

await ensureDatabase();
await mkdir(outputDir, { recursive: true });

const response = await getDb().execute(`
  SELECT audio_url, file_name AS audio_file_name
  FROM audio_chapter_files
  ORDER BY book, chapter
`);

let downloaded = 0;
let skipped = 0;
let failed = 0;

for (const row of response.rows as unknown as AudioRow[]) {
  const audioUrl = String(row.audio_url);
  const fileName = String(row.audio_file_name);
  const destination = path.join(outputDir, fileName);

  if (await hasUsableFile(destination)) {
    skipped += 1;
    continue;
  }

  try {
    await downloadFile(audioUrl, destination);
    downloaded += 1;
    if (downloaded % 25 === 0) {
      console.log(`Downloaded ${downloaded}; skipped ${skipped}; failed ${failed}`);
    }
  } catch (error) {
    failed += 1;
    console.error(`Failed ${fileName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`Audio download complete. Downloaded ${downloaded}; skipped ${skipped}; failed ${failed}`);

if (failed > 0) {
  process.exitCode = 1;
}

async function hasUsableFile(filePath: string) {
  try {
    const stats = await stat(filePath);
    return stats.size > 0;
  } catch {
    return false;
  }
}

async function downloadFile(audioUrl: string, destination: string) {
  const tempPath = `${destination}.part`;
  await unlink(tempPath).catch(() => undefined);

  const response = await fetch(audioUrl);
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(tempPath)
  );
  await rename(tempPath, destination);
}
