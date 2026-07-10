import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import OpenAI from "openai";

const MAX_DIRECT_TRANSCRIPTION_BYTES = 24 * 1024 * 1024;
const TRANSCRIPTION_CHUNK_SECONDS = 20 * 60;
const execFileAsync = promisify(execFile);
const archiveMirrorUrlCache = new Map<string, Promise<string[]>>();

export type TranscriptWord = {
  end: number;
  start: number;
  word: string;
};

export type TranscriptTrack = {
  audioUrl: string;
  fileName: string;
};

type TranscriptPayload = {
  words?: TranscriptWord[];
};

type ArchiveMetadata = {
  d1?: string;
  d2?: string;
  dir?: string;
  server?: string;
  workable_servers?: string[];
};

export async function loadTranscriptWords(
  client: OpenAI,
  track: TranscriptTrack,
  cacheDir: string
) {
  await mkdir(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, `${track.fileName}.json`);

  try {
    const cached = await readJsonFile(cachePath, isTranscriptPayload);

    if (cached.words?.length) {
      return cached.words;
    }
  } catch {
    // Cache miss.
  }

  const tempPath = path.join(os.tmpdir(), track.fileName);

  try {
    await downloadAudio(track.audioUrl, tempPath);
    const transcription = await transcribeDownloadedAudio(
      client,
      tempPath,
      track.fileName
    );

    if (!transcription.words?.length) {
      throw new Error(`No word timestamps returned for ${track.fileName}`);
    }

    await writeFile(cachePath, `${JSON.stringify(transcription, null, 2)}\n`);
    return transcription.words;
  } finally {
    await rm(tempPath, { force: true });
  }
}

async function downloadAudio(audioUrl: string, outputPath: string) {
  const maxAttempts = 8;
  const candidateUrls = await downloadCandidateUrls(audioUrl);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let lastError: unknown = null;

    for (const candidateUrl of candidateUrls) {
      try {
        const response = await fetch(candidateUrl);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        await writeFile(outputPath, new Uint8Array(await response.arrayBuffer()));
        return;
      } catch (error) {
        lastError = error;
      }
    }

    if (attempt === maxAttempts) {
      throw new Error(`Failed to download ${audioUrl}: ${String(lastError)}`);
    }

    await delay(Math.min(30000, 1000 * (2 ** attempt)));
  }
}

async function downloadCandidateUrls(audioUrl: string) {
  const mirrorUrls = await archiveMirrorUrls(audioUrl);
  return [audioUrl, ...mirrorUrls.filter((url) => url !== audioUrl)];
}

async function archiveMirrorUrls(audioUrl: string) {
  const parsed = archiveDownloadUrlParts(audioUrl);

  if (!parsed) {
    return [];
  }

  const cacheKey = `${parsed.itemId}/${parsed.fileName}`;

  if (!archiveMirrorUrlCache.has(cacheKey)) {
    archiveMirrorUrlCache.set(
      cacheKey,
      loadArchiveMirrorUrls(parsed.itemId, parsed.fileName)
    );
  }

  return await archiveMirrorUrlCache.get(cacheKey) ?? [];
}

function archiveDownloadUrlParts(audioUrl: string) {
  try {
    const parsed = new URL(audioUrl);
    const match = parsed.pathname.match(/^\/download\/([^/]+)\/(.+)$/);

    if (!match) {
      return null;
    }

    return {
      fileName: decodeURIComponent(match[2]),
      itemId: decodeURIComponent(match[1])
    };
  } catch {
    return null;
  }
}

async function loadArchiveMirrorUrls(itemId: string, fileName: string) {
  try {
    const response = await fetch(
      `https://archive.org/metadata/${encodeURIComponent(itemId)}`
    );

    if (!response.ok) {
      return [];
    }

    const metadata = await readJsonResponse(response, isArchiveMetadata);
    const servers = [
      ...(metadata.workable_servers ?? []),
      metadata.server,
      metadata.d1,
      metadata.d2
    ].filter((server): server is string => Boolean(server));
    const uniqueServers = [...new Set(servers)];

    if (!metadata.dir || uniqueServers.length === 0) {
      return [];
    }

    return uniqueServers.map((server) => (
      `https://${server}${metadata.dir}/${encodeURIComponent(fileName).replace(/%2F/g, "/")}`
    ));
  } catch {
    return [];
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function transcribeDownloadedAudio(
  client: OpenAI,
  filePath: string,
  fileName: string
) {
  const fileStats = await stat(filePath);

  if (fileStats.size <= MAX_DIRECT_TRANSCRIPTION_BYTES) {
    return transcribeAudioFile(client, filePath);
  }

  const chunksDir = await mkdtemp(
    path.join(os.tmpdir(), `${path.parse(fileName).name}-chunks-`)
  );

  try {
    await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      filePath,
      "-f",
      "segment",
      "-segment_time",
      String(TRANSCRIPTION_CHUNK_SECONDS),
      "-reset_timestamps",
      "1",
      "-c",
      "copy",
      path.join(chunksDir, "chunk-%03d.mp3")
    ]);

    const chunkNames = (await readdir(chunksDir))
      .filter((chunkName) => chunkName.endsWith(".mp3"))
      .sort();
    const combinedWords: TranscriptWord[] = [];
    let offsetSeconds = 0;

    for (const chunkName of chunkNames) {
      const chunkPath = path.join(chunksDir, chunkName);
      const chunkTranscription = await transcribeAudioFile(client, chunkPath);

      for (const word of chunkTranscription.words ?? []) {
        combinedWords.push({
          ...word,
          end: word.end + offsetSeconds,
          start: word.start + offsetSeconds
        });
      }

      offsetSeconds += await probeDuration(chunkPath);
    }

    return { words: combinedWords };
  } finally {
    await rm(chunksDir, { force: true, recursive: true });
  }
}

async function transcribeAudioFile(client: OpenAI, filePath: string) {
  const transcription = await client.audio.transcriptions.create({
    file: createReadStream(filePath),
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["word"]
  });

  if (!isTranscriptPayload(transcription)) {
    throw new Error(`No word timestamp payload returned for ${filePath}`);
  }

  return transcription;
}

async function probeDuration(filePath: string) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath
  ]);
  const duration = Number(stdout.trim());

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Unable to read audio duration for ${filePath}`);
  }

  return duration;
}

async function readJsonFile<T>(
  filePath: string,
  isExpected: (value: unknown) => value is T
) {
  const value: unknown = JSON.parse(await readFile(filePath, "utf8"));

  if (!isExpected(value)) {
    throw new Error(`Invalid JSON shape in ${filePath}`);
  }

  return value;
}

async function readJsonResponse<T>(
  response: Response,
  isExpected: (value: unknown) => value is T
) {
  const value: unknown = await response.json();

  if (!isExpected(value)) {
    throw new Error(`Invalid JSON response from ${response.url}`);
  }

  return value;
}

function isTranscriptPayload(value: unknown): value is TranscriptPayload {
  return isRecord(value) &&
    (
      value.words === undefined ||
      (
        Array.isArray(value.words) &&
        value.words.every((word) => (
          isRecord(word) &&
          typeof word.end === "number" &&
          typeof word.start === "number" &&
          typeof word.word === "string"
        ))
      )
    );
}

function isArchiveMetadata(value: unknown): value is ArchiveMetadata {
  return isRecord(value) &&
    optionalString(value.d1) &&
    optionalString(value.d2) &&
    optionalString(value.dir) &&
    optionalString(value.server) &&
    (
      value.workable_servers === undefined ||
      (
        Array.isArray(value.workable_servers) &&
        value.workable_servers.every((server) => typeof server === "string")
      )
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}
