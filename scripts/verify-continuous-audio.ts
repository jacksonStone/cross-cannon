import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { buildAudioChapterFiles } from "../app/lib/audio-chapters.server";
import type { ContinuousAudioManifest } from "../app/features/audio/continuous-audio";
import type { BookIndex } from "../app/features/early-christian-reader/types";

const manifest: ContinuousAudioManifest = JSON.parse(
  await readFile("public/continuous-audio.json", "utf8")
);
const books: BookIndex = JSON.parse(
  await readFile("public/church-fathers-preview/books.json", "utf8")
);
const includeFathers = process.env.AUDIO_TEST_FATHERS === "1";
const expected = [
  ...buildAudioChapterFiles().map((c) => c.audioUrl.split("?")[0]),
  ...(includeFathers ? books.books : []).flatMap((b) =>
    b.chapters.filter((c) => c.audio).map((c) => c.id)
  ),
];
assert.deepEqual(Object.keys(manifest.chapters).sort(), expected.sort());
const files = new Map<string, number>();
for (const entry of Object.values(manifest.chapters)) {
  const file = path.join("storage/audio/continuous", path.basename(entry.url));
  if (!files.has(file)) {
    const actual = await hash(file);
    assert(
      file.endsWith(`-${actual.slice(0, 16)}.m4a`),
      `Content hash mismatch: ${file}`
    );
    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration:stream=codec_name,sample_rate,channels",
          "-of",
          "json",
          file,
        ],
        { encoding: "utf8" }
      )
    );
    assert.equal(probe.streams[0].codec_name, "aac");
    assert.equal(probe.streams[0].channels, 1);
    files.set(file, Number(probe.format.duration));
  }
  assert(
    entry.startSeconds >= 0 &&
      entry.endSeconds > entry.startSeconds &&
      entry.endSeconds <= files.get(file)! + 0.1,
    `Invalid timestamps: ${entry.url}`
  );
}
const backupDir =
  process.env.AUDIO_BACKUP_DIR ??
  "storage/audio-originals/continuous-2026-09-22";
const receipts: Record<string, { sha256: string }> = JSON.parse(
  await readFile(path.join(backupDir, "checksums.json"), "utf8")
);
const expectedOriginalCount =
  buildAudioChapterFiles().length +
  new Set(
    books.books.flatMap((b) =>
      b.chapters.flatMap((c) => (c.audio ? [c.audio.url] : []))
    )
  ).size;
assert(Object.keys(receipts).length >= buildAudioChapterFiles().length);
if (includeFathers)
  assert.equal(Object.keys(receipts).length, expectedOriginalCount);
for (const [file, receipt] of Object.entries(receipts))
  assert.equal(
    await hash(file),
    receipt.sha256,
    `Original backup changed: ${file}`
  );
console.log(
  `Verified ${expected.length} chapter entries, ${
    files.size
  } continuous files, and ${
    Object.keys(receipts).length
  } preserved original checksums.`
);
async function hash(file: string) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
