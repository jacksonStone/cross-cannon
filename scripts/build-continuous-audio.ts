import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { buildAudioChapterFiles } from "../app/lib/audio-chapters.server";
import type { BookIndex } from "../app/features/early-christian-reader/types";
import type { ContinuousAudioManifest } from "../app/features/audio/continuous-audio";

// Never changes source recordings, Scripture caches, or alignment artifacts.
// PCM sample counts give exact offsets even when source MP3 sample rates differ.
const root = path.resolve("storage/audio/continuous");
const backup = path.resolve(
  process.env.AUDIO_BACKUP_DIR ??
    "storage/audio-originals/continuous-2026-09-22"
);
const manifestPath = "public/continuous-audio.json";
const bibleOnly = process.argv.includes("--bible");
const selected = process.argv
  .slice(2)
  .filter((argument) => argument !== "--bible");
await mkdir(root, { recursive: true });
await mkdir(backup, { recursive: true });
for (const file of [
  "public/church-fathers-preview/books.json",
  "data/public-domain/church-fathers/audio-sources.json",
  "app/features/early-christian-reader/useEarlyChristianAudioPlayback.ts",
  "app/features/passage-reader/PassageReader.tsx",
]) {
  const destination = path.join(
    backup,
    /\.tsx?$/.test(file) ? `${file}.original` : file
  );
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(file, destination, 1).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
}

type Chapter = { key: string; url: string; start: number; end?: number };
type Group = { id: string; chapters: Chapter[] };
const groups = new Map<string, Group>();
for (const chapter of buildAudioChapterFiles()) {
  const id = `bible-${chapter.book
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")}`;
  const group = groups.get(id) ?? { id, chapters: [] };
  group.chapters.push({
    key: chapter.audioUrl.split("?")[0],
    url: chapter.audioUrl,
    start: 0,
  });
  groups.set(id, group);
}
const books: BookIndex = JSON.parse(
  await readFile("public/church-fathers-preview/books.json", "utf8")
);
for (const book of books.books) {
  const chapters = book.chapters
    .filter((c) => c.audio)
    .map((c) => ({
      key: c.id,
      url: c.audio!.url,
      start: c.audio!.startSeconds,
      end: c.audio!.endSeconds,
    }));
  if (chapters.length) {
    const id = `fathers-${book.id.replaceAll(/[^a-z0-9]+/g, "-")}`;
    groups.set(id, { id, chapters });
  }
}
let manifest: ContinuousAudioManifest = { version: 1, chapters: {} };
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch {
  /* First build. */
}
const receipts: Record<
  string,
  { sha256: string; bytes: number; source: string }
> = {};
try {
  Object.assign(
    receipts,
    JSON.parse(await readFile(path.join(backup, "checksums.json"), "utf8"))
  );
} catch {
  /* First backup. */
}

for (const group of groups.values()) {
  if (bibleOnly && !group.id.startsWith("bible-")) continue;
  if (selected.length && !selected.includes(group.id)) continue;
  const previous = manifest.chapters[group.chapters[0].key];
  if (
    previous &&
    group.chapters.every(
      (c) => manifest.chapters[c.key]?.url === previous.url
    ) &&
    (await exists(path.join(root, path.basename(previous.url))))
  ) {
    console.log(`Already built: ${group.id}`);
    continue;
  }
  console.log(`Preserving and assembling ${group.id}`);
  const rawPath = path.join(root, `${group.id}.pcm`);
  await rm(rawPath, { force: true });
  const offsets = new Map<string, { start: number; duration: number }>();
  let seconds = 0;
  for (const url of new Set(group.chapters.map((c) => c.url))) {
    const local = url.startsWith("/audio/WEBD_AT/");
    const fileName = local
      ? path.basename(url.split("?")[0])
      : `${createHash("sha256")
          .update(url)
          .digest("hex")
          .slice(0, 12)}-${decodeURIComponent(
          new URL(url).pathname.split("/").at(-1)!
        )}`;
    const destination = path.join(
      backup,
      local ? "WEBD_AT" : "remote",
      fileName
    );
    await mkdir(path.dirname(destination), { recursive: true });
    if (!(await exists(destination))) {
      if (local) {
        const source = path.resolve("storage/audio/WEBD_AT", fileName);
        await copyFile(source, destination, 1);
        if ((await hash(source)) !== (await hash(destination)))
          throw new Error(`Backup mismatch: ${source}`);
      } else {
        await download(url, destination);
      }
    }
    const checksum = await hash(destination);
    if (receipts[destination] && receipts[destination].sha256 !== checksum)
      throw new Error(`Backup changed: ${destination}`);
    receipts[destination] = {
      sha256: checksum,
      bytes: (await stat(destination)).size,
      source: url,
    };
    await writeFile(
      path.join(backup, "checksums.json"),
      JSON.stringify(receipts, null, 2) + "\n"
    );
    const before = await stat(rawPath)
      .then((s) => s.size)
      .catch(() => 0);
    const decode = spawn(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        destination,
        "-map",
        "0:a:0",
        "-f",
        "s16le",
        "-ar",
        "22050",
        "-ac",
        "1",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "inherit"] }
    );
    await Promise.all([
      finished(decode),
      pipeline(decode.stdout!, createWriteStream(rawPath, { flags: "a" })),
    ]);
    const duration = ((await stat(rawPath)).size - before) / (22050 * 2);
    if (duration <= 0) throw new Error(`Empty decoded recording: ${url}`);
    offsets.set(url, { start: seconds, duration });
    seconds += duration;
  }
  const temporary = path.join(root, `${group.id}.part.m4a`);
  await finished(
    spawn(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-f",
        "s16le",
        "-ar",
        "22050",
        "-ac",
        "1",
        "-i",
        rawPath,
        "-c:a",
        process.env.AUDIO_ENCODER ?? "aac",
        "-b:a",
        "64k",
        "-movflags",
        "+faststart",
        temporary,
      ],
      { stdio: "inherit" }
    )
  );
  const digest = (await hash(temporary)).slice(0, 16);
  const fileName = `${group.id}-${digest}.m4a`;
  await rename(temporary, path.join(root, fileName));
  for (const chapter of group.chapters) {
    const track = offsets.get(chapter.url)!;
    if (chapter.start >= track.duration)
      throw new Error(`Offset outside recording: ${chapter.key}`);
    manifest.chapters[chapter.key] = {
      url: `/audio/continuous/${fileName}`,
      startSeconds: track.start + chapter.start,
      endSeconds:
        track.start + Math.min(chapter.end ?? track.duration, track.duration),
    };
  }
  await writeFile(
    `${manifestPath}.part`,
    JSON.stringify(manifest, null, 2) + "\n"
  );
  await rename(`${manifestPath}.part`, manifestPath);
  await rm(rawPath);
  console.log(
    `Built ${group.id}: ${(seconds / 3600).toFixed(2)} hours, ${
      group.chapters.length
    } chapter entries`
  );
}
console.log(`Originals and SHA-256 checksums: ${backup}`);

async function exists(file: string) {
  return stat(file)
    .then((s) => s.size > 0)
    .catch(() => false);
}
async function hash(file: string) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
function finished(child: ReturnType<typeof spawn>) {
  return new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))
    );
  });
}
async function download(url: string, destination: string) {
  // curl follows Archive.org's CDN redirect and retries transient failures.
  await finished(
    spawn(
      "curl",
      [
        "--fail",
        "--location",
        "--retry",
        "5",
        "--retry-delay",
        "2",
        "--connect-timeout",
        "30",
        "--max-time",
        "600",
        "--silent",
        "--show-error",
        "--output",
        `${destination}.part`,
        url,
      ],
      { stdio: "inherit" }
    )
  );
  await rename(`${destination}.part`, destination);
}
