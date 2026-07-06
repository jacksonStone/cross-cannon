import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import OpenAI from "openai";

const CITY_OF_GOD_BOOK_ID = "npnf102:iv";
const AUDIO_SOURCES_PATH = "data/public-domain/church-fathers/audio-sources.json";
const BOOK_INDEX_PATH = "public/church-fathers-preview/books.json";
const OUTPUT_PATH = "public/church-fathers-preview/city-of-god-audio-alignment.json";
const TRANSCRIPT_CACHE_DIR = "storage/church-fathers-audio/transcripts";
const DEFAULT_MIN_CONFIDENCE = 0.72;
const MAX_DIRECT_TRANSCRIPTION_BYTES = 24 * 1024 * 1024;
const TRANSCRIPTION_CHUNK_SECONDS = 20 * 60;
const SOURCE_PAGE = "https://archive.org/details/city_of_god_ds_librivox";
const execFileAsync = promisify(execFile);
const archiveMirrorUrlCache = new Map<string, Promise<string[]>>();

type AudioSourcesFile = {
  sources: AudioSource[];
};

type AudioSource = {
  alignmentFile?: string;
  baseUrl?: string;
  fileTemplate?: string;
  labelTemplate?: string;
  location?: string;
  partsByBook?: Record<string, string[]>;
  workId?: string;
};

type BookIndex = {
  books: Array<{
    chapters: Array<{
      assetPath: string;
      id: string;
      title: string;
    }>;
    id: string;
  }>;
};

type ChapterAsset = {
  id: string;
  verses: Array<{ text: string }>;
};

type Section = {
  book: number;
  chapter: number;
  id: string;
  text: string;
  title: string;
};

type Track = {
  audioUrl: string;
  book: number;
  fileName: string;
  label: string;
  part: string;
};

type TranscriptWord = {
  end: number;
  start: number;
  word: string;
};

type NormalizedTranscriptWord = TranscriptWord & {
  normalized: string;
};

type AlignedChapter = {
  audioUrl: string;
  confidence: number;
  endSeconds: number;
  label: string;
  startSeconds: number;
};

type AlignmentPayload = {
  chapters?: Record<string, AlignedChapter>;
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

type Args = {
  book: number | null;
  dryRun: boolean;
  limit: number | null;
  minConfidence: number;
  reset: boolean;
  trackFileName: string | null;
};

const args = parseArgs(process.argv.slice(2));
const citySource = await loadCityAudioSource();
const sections = await loadCitySections();
const tracks = buildTracks(citySource, sections);
const sectionsByTrack = tracks
  .map((track) => ({
    sections: sections.filter((section) => section.book === track.book && trackForSection(citySource, sections, section)?.fileName === track.fileName),
    track
  }))
  .filter(({ sections: trackSections }) => trackSections.length > 0);

const selectedTracks = sectionsByTrack
  .filter(({ track }) => !args.trackFileName || track.fileName === args.trackFileName)
  .filter(({ track }) => args.book === null || track.book === args.book)
  .slice(0, args.limit ?? undefined);

if (args.dryRun) {
  console.log(`Tracks: ${tracks.length}`);
  console.log(`City of God sections: ${sections.length}`);
  console.log(`Selected tracks: ${selectedTracks.length}`);
  for (const { sections: trackSections, track } of selectedTracks) {
    const first = trackSections[0];
    const last = trackSections[trackSections.length - 1];
    console.log(
      `${track.fileName}: ${trackSections.length} sections ` +
        `(book ${track.book}, chapters ${first.chapter}-${last.chapter})`
    );
  }
  process.exit(0);
}

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required to build City of God audio alignment.");
}

await mkdir(TRANSCRIPT_CACHE_DIR, { recursive: true });
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const alignedChapters: Record<string, AlignedChapter> = await readExistingAlignments();

for (const { sections: trackSections, track } of selectedTracks) {
  const words = await getTranscriptWords(client, track);
  const inferredChapters = inferSpokenChapterNumbers(words);
  const sectionsToAlign = sections.filter((section) => section.book === track.book);
  const chapterSummary = sectionsToAlign.length > 0
    ? `${sectionsToAlign[0].chapter}-${sectionsToAlign[sectionsToAlign.length - 1].chapter}`
    : "none";

  console.log(
    `Aligning ${track.label} (${sectionsToAlign.length} candidate sections, chapters ${chapterSummary}, ` +
      `${inferredChapters.length} spoken markers)`
  );
  const alignments = alignTrackSections(sectionsToAlign, words, args.minConfidence);

  for (const alignment of alignments) {
    if (!alignment) {
      continue;
    }

    alignedChapters[alignment.section.id] = {
      audioUrl: track.audioUrl,
      confidence: alignment.confidence,
      endSeconds: roundSeconds(alignment.endSeconds),
      label: track.label,
      startSeconds: roundSeconds(alignment.startSeconds)
    };
  }
}

await writeFile(OUTPUT_PATH, `${JSON.stringify({
  chapters: sortAlignedChapters(alignedChapters, sections),
  generatedAt: new Date().toISOString(),
  source: SOURCE_PAGE
}, null, 2)}\n`);

console.log(`Wrote ${Object.keys(alignedChapters).length} aligned sections to ${OUTPUT_PATH}`);

async function loadCityAudioSource() {
  const payload = await readJsonFile(AUDIO_SOURCES_PATH, isAudioSourcesFile);
  const source = payload.sources.find((candidate) => (
    candidate.workId === CITY_OF_GOD_BOOK_ID &&
    candidate.location === "city-of-god"
  ));

  if (!source?.baseUrl || !source.fileTemplate || !source.partsByBook) {
    throw new Error(`Missing City of God audio source in ${AUDIO_SOURCES_PATH}`);
  }

  return source;
}

async function loadCitySections() {
  const index = await readJsonFile(BOOK_INDEX_PATH, isBookIndex);
  const cityOfGod = index.books.find((book) => book.id === CITY_OF_GOD_BOOK_ID);

  if (!cityOfGod) {
    throw new Error(`Missing ${CITY_OF_GOD_BOOK_ID} in ${BOOK_INDEX_PATH}`);
  }

  const loadedSections: Section[] = [];

  for (const chapter of cityOfGod.chapters) {
    const location = parseCityOfGodLocation(chapter.id);

    if (!location) {
      continue;
    }

    const asset = await readJsonFile(path.join("public", chapter.assetPath), isChapterAsset);

    loadedSections.push({
      ...location,
      id: chapter.id,
      text: asset.verses.map((verse) => verse.text).join(" "),
      title: chapter.title
    });
  }

  return loadedSections;
}

function buildTracks(source: AudioSource, orderedSections: Section[]) {
  if (!source.baseUrl || !source.fileTemplate || !source.partsByBook) {
    return [];
  }

  return Object.entries(source.partsByBook)
    .sort(([left], [right]) => Number(left) - Number(right))
    .flatMap(([bookText, parts]) => {
      const book = Number(bookText);

      return parts.map((part) => {
        const fileName = source.fileTemplate?.replace("{part}", part) ?? "";

        return {
          audioUrl: `${source.baseUrl}/${fileName}`,
          book,
          fileName,
          label: formatLabel(source.labelTemplate, book, part),
          part
        };
      });
    })
    .filter((track) => orderedSections.some((section) => (
      section.book === track.book &&
      trackForSection(source, orderedSections, section)?.fileName === track.fileName
    )));
}

function trackForSection(source: AudioSource, orderedSections: Section[], section: Section) {
  if (!source.baseUrl || !source.fileTemplate || !source.partsByBook) {
    return null;
  }

  const parts = source.partsByBook[String(section.book)];
  const chapterCount = orderedSections
    .filter((candidate) => candidate.book === section.book)
    .reduce((max, candidate) => Math.max(max, candidate.chapter), 0);

  if (!parts?.length || !chapterCount) {
    return null;
  }

  const partIndex = Math.min(
    parts.length - 1,
    Math.max(0, Math.floor(((section.chapter - 1) * parts.length) / chapterCount))
  );
  const part = parts[partIndex];
  const fileName = source.fileTemplate.replace("{part}", part);

  return {
    audioUrl: `${source.baseUrl}/${fileName}`,
    book: section.book,
    fileName,
    label: formatLabel(source.labelTemplate, section.book, part),
    part
  };
}

function formatLabel(template: string | undefined, book: number, part: string) {
  return (template ?? "Book {book:02d}, part {partLetter}")
    .replace(/\{book:02d\}/g, String(book).padStart(2, "0"))
    .replace(/\{book\}/g, String(book))
    .replace(/\{partLetter\}/g, part.slice(-1).toUpperCase())
    .replace(/\{part\}/g, part);
}

async function readExistingAlignments() {
  if (args.reset) {
    return {};
  }

  try {
    const existing = await readJsonFile(OUTPUT_PATH, isAlignmentPayload);

    return existing.chapters ?? {};
  } catch {
    return {};
  }
}

function sortAlignedChapters<T>(chapters: Record<string, T>, orderedSections: Section[]) {
  const sorted: Record<string, T> = {};
  const sectionIds = new Set(orderedSections.map((section) => section.id));

  for (const section of orderedSections) {
    if (chapters[section.id]) {
      sorted[section.id] = chapters[section.id];
    }
  }

  for (const [id, alignment] of Object.entries(chapters)) {
    if (!sectionIds.has(id)) {
      sorted[id] = alignment;
    }
  }

  return sorted;
}

async function readJsonFile<T>(filePath: string, isExpected: (value: unknown) => value is T) {
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));

  if (!isExpected(parsed)) {
    throw new Error(`Unexpected JSON shape in ${filePath}`);
  }

  return parsed;
}

async function readJsonResponse<T>(response: Response, isExpected: (value: unknown) => value is T) {
  const parsed: unknown = await response.json();

  if (!isExpected(parsed)) {
    throw new Error("Unexpected JSON response shape.");
  }

  return parsed;
}

function isAudioSourcesFile(value: unknown): value is AudioSourcesFile {
  return isRecord(value) && Array.isArray(value.sources) && value.sources.every(isAudioSource);
}

function isAudioSource(value: unknown): value is AudioSource {
  if (!isRecord(value)) {
    return false;
  }

  return optionalString(value.alignmentFile) &&
    optionalString(value.baseUrl) &&
    optionalString(value.fileTemplate) &&
    optionalString(value.labelTemplate) &&
    optionalString(value.location) &&
    optionalString(value.workId) &&
    (
      value.partsByBook === undefined ||
      (
        isRecord(value.partsByBook) &&
        Object.values(value.partsByBook).every((parts) => (
          Array.isArray(parts) && parts.every((part) => typeof part === "string")
        ))
      )
    );
}

function isBookIndex(value: unknown): value is BookIndex {
  return isRecord(value) &&
    Array.isArray(value.books) &&
    value.books.every((book) => (
      isRecord(book) &&
      typeof book.id === "string" &&
      Array.isArray(book.chapters) &&
      book.chapters.every((chapter) => (
        isRecord(chapter) &&
        typeof chapter.assetPath === "string" &&
        typeof chapter.id === "string" &&
        typeof chapter.title === "string"
      ))
    ));
}

function isChapterAsset(value: unknown): value is ChapterAsset {
  return isRecord(value) &&
    typeof value.id === "string" &&
    Array.isArray(value.verses) &&
    value.verses.every((verse) => isRecord(verse) && typeof verse.text === "string");
}

function isAlignmentPayload(value: unknown): value is AlignmentPayload {
  return isRecord(value) &&
    (
      value.chapters === undefined ||
      (
        isRecord(value.chapters) &&
        Object.values(value.chapters).every(isAlignedChapter)
      )
    );
}

function isAlignedChapter(value: unknown): value is AlignedChapter {
  return isRecord(value) &&
    typeof value.audioUrl === "string" &&
    typeof value.confidence === "number" &&
    typeof value.endSeconds === "number" &&
    typeof value.label === "string" &&
    typeof value.startSeconds === "number";
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
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

async function getTranscriptWords(client: OpenAI, track: Track) {
  const cachePath = path.join(TRANSCRIPT_CACHE_DIR, `${track.fileName}.json`);

  try {
    const cached = await readJsonFile(cachePath, isTranscriptPayload);

    if (cached.words?.length) {
      return normalizeTranscriptWords(cached.words);
    }
  } catch {
    // Cache miss.
  }

  const tempPath = path.join(os.tmpdir(), track.fileName);

  try {
    await downloadAudio(track.audioUrl, tempPath);
    const transcription = await transcribeDownloadedAudio(client, tempPath, track.fileName);

    if (!transcription.words?.length) {
      throw new Error(`No word timestamps returned for ${track.fileName}`);
    }

    await writeFile(cachePath, `${JSON.stringify(transcription, null, 2)}\n`);
    return normalizeTranscriptWords(transcription.words);
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
    archiveMirrorUrlCache.set(cacheKey, loadArchiveMirrorUrls(parsed.itemId, parsed.fileName));
  }

  const urls = await archiveMirrorUrlCache.get(cacheKey);
  return urls ?? [];
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
    const response = await fetch(`https://archive.org/metadata/${encodeURIComponent(itemId)}`);

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

async function transcribeDownloadedAudio(client: OpenAI, filePath: string, fileName: string) {
  const fileStats = await stat(filePath);

  if (fileStats.size <= MAX_DIRECT_TRANSCRIPTION_BYTES) {
    return transcribeAudioFile(client, filePath);
  }

  const chunksDir = await mkdtemp(path.join(os.tmpdir(), `${path.parse(fileName).name}-chunks-`));

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

function alignTrackSections(
  trackSections: Section[],
  words: NormalizedTranscriptWord[],
  minConfidence: number
) {
  const normalizedWords = words.map((word) => word.normalized);
  const starts: Array<{
    confidence: number;
    markerSeconds: number;
    section: Section;
    startSeconds: number;
    wordIndex: number;
  } | null> = [];
  let cursor = 0;

  for (const section of trackSections) {
    const sectionWords = normalizeText(section.text);
    const startNeedle = sectionWords.slice(0, 18);
    const endNeedle = sectionWords.slice(-18);
    const startMatch = findBestWindow(normalizedWords, startNeedle, cursor);
    const requiredConfidence = cursor > 0 ? Math.min(minConfidence, 0.6) : minConfidence;
    const endSearchIndex = startMatch.score >= requiredConfidence
      ? Math.max(startMatch.index, cursor)
      : cursor;
    const endMatch = findBestWindow(
      normalizedWords,
      endNeedle,
      endSearchIndex
    );
    const textConfidence = Math.min(startMatch.score, endMatch.score);

    if (startMatch.score >= requiredConfidence) {
      const markerMatch = findNearestChapterMarkerBefore(words, startMatch.index, cursor);

      starts.push({
        confidence: textConfidence >= requiredConfidence ? textConfidence : startMatch.score,
        markerSeconds: markerMatch
          ? words[markerMatch.markerIndex]?.start ?? words[startMatch.index]?.start ?? 0
          : words[startMatch.index]?.start ?? 0,
        section,
        startSeconds: markerMatch
          ? words[markerMatch.contentIndex]?.start ?? words[startMatch.index]?.start ?? 0
          : words[startMatch.index]?.start ?? 0,
        wordIndex: startMatch.index
      });
      cursor = Math.max(startMatch.index + 1, endMatch.index);
      continue;
    }

    const markerMatch = findChapterMarker(words, section.chapter, cursor);

    if (markerMatch) {
      starts.push({
        confidence: 1,
        markerSeconds: words[markerMatch.markerIndex]?.start ?? 0,
        section,
        startSeconds: words[markerMatch.contentIndex]?.start ??
          words[markerMatch.markerIndex]?.end ??
          0,
        wordIndex: markerMatch.contentIndex
      });
      cursor = markerMatch.contentIndex;
      continue;
    }

    if (cursor > 0 && endMatch.score >= 0.9 && endMatch.index > cursor) {
      starts.push({
        confidence: Math.min(0.9, endMatch.score * 0.8),
        markerSeconds: words[cursor]?.end ?? words[cursor]?.start ?? 0,
        section,
        startSeconds: words[cursor]?.end ?? words[cursor]?.start ?? 0,
        wordIndex: cursor
      });
      cursor = endMatch.index;
      continue;
    }

    if (args.trackFileName) {
      console.warn(
        `Skipped ${section.id} (${section.title}) startConfidence=${startMatch.score.toFixed(2)} endConfidence=${endMatch.score.toFixed(2)}`
      );
    }
    starts.push(null);
  }

  return starts.map((start, index) => {
    if (!start) {
      return null;
    }

    const nextStart = starts.slice(index + 1).find(Boolean);

    return {
      confidence: start.confidence,
      endSeconds: nextStart?.markerSeconds ?? words[words.length - 1]?.end ?? 0,
      section: start.section,
      startSeconds: start.startSeconds
    };
  });
}

function findNearestChapterMarkerBefore(
  words: NormalizedTranscriptWord[],
  wordIndex: number,
  minIndex: number
) {
  const maxMarkerDistanceSeconds = 90;

  for (let index = wordIndex; index >= minIndex; index -= 1) {
    if (words[index]?.normalized !== "chapter") {
      continue;
    }

    const startSeconds = words[wordIndex]?.start ?? 0;
    const markerSeconds = words[index]?.start ?? 0;

    if (startSeconds - markerSeconds > maxMarkerDistanceSeconds) {
      return null;
    }

    return {
      contentIndex: Math.min(words.length - 1, index + 2),
      markerIndex: index
    };
  }

  return null;
}

function inferSpokenChapterNumbers(words: NormalizedTranscriptWord[]) {
  const chapters: number[] = [];
  const seen = new Set<number>();

  for (let index = 0; index < words.length - 1; index += 1) {
    if (words[index].normalized !== "chapter") {
      continue;
    }

    const chapter = parseChapterToken(words[index + 1]?.normalized);

    if (chapter === null || seen.has(chapter)) {
      continue;
    }

    seen.add(chapter);
    chapters.push(chapter);
  }

  return chapters;
}

function findChapterMarker(
  words: NormalizedTranscriptWord[],
  chapter: number,
  startIndex: number
) {
  for (let index = startIndex; index < words.length - 1; index += 1) {
    if (
      words[index].normalized === "chapter" &&
      matchesChapterToken(words[index + 1]?.normalized, chapter)
    ) {
      return {
        contentIndex: Math.min(words.length - 1, index + 2),
        markerIndex: index
      };
    }
  }

  return null;
}

function matchesChapterToken(token: string | undefined, chapter: number) {
  return parseChapterToken(token) === chapter;
}

function parseChapterToken(token: string | undefined) {
  if (!token) {
    return null;
  }

  if (/^\d+$/.test(token)) {
    const numeric = Number(token);
    return numeric >= 1 && numeric <= 99 ? numeric : null;
  }

  const wordNumber = numberFromWord(token);

  if (wordNumber !== null) {
    return wordNumber;
  }

  if (/^[ivxlcdm]+$/i.test(token)) {
    const roman = romanNumeralToNumber(token);
    return roman >= 1 && roman <= 99 ? roman : null;
  }

  return null;
}

function findBestWindow(haystack: string[], needle: string[], startIndex: number) {
  if (needle.length === 0) {
    return { index: startIndex, score: 0 };
  }

  let best = { index: startIndex, score: -1 };
  const maxWindowExtra = 8;

  for (let index = startIndex; index < haystack.length; index += 1) {
    const window = haystack.slice(index, index + needle.length + maxWindowExtra);
    const score = lcsScore(needle, window) / needle.length;

    if (score > best.score) {
      best = { index, score };
    }

    if (score === 1) {
      break;
    }
  }

  return best;
}

function lcsScore(left: string[], right: string[]) {
  const previous = new Array(right.length + 1).fill(0);
  const current = new Array(right.length + 1).fill(0);

  for (const leftWord of left) {
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      current[rightIndex + 1] = leftWord === right[rightIndex]
        ? previous[rightIndex] + 1
        : Math.max(current[rightIndex], previous[rightIndex + 1]);
    }

    previous.splice(0, previous.length, ...current);
    current.fill(0);
  }

  return previous[right.length];
}

function normalizeTranscriptWords(words: TranscriptWord[]): NormalizedTranscriptWord[] {
  return words
    .map((word) => ({
      ...word,
      normalized: normalizeToken(word.word)
    }))
    .filter((word) => word.normalized);
}

function normalizeText(value: string) {
  return value
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);
}

function normalizeToken(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function parseCityOfGodLocation(chapterId: string) {
  const bookOneMatch = chapterId.match(/^npnf102:iv\.ii\.([ivxlcdm]+)$/i);

  if (bookOneMatch) {
    return {
      book: 1,
      chapter: romanNumeralToNumber(bookOneMatch[1])
    };
  }

  const match = chapterId.match(/^npnf102:iv\.([IVXLCDM]+)(?:_1)?\.([0-9]+|[ivxlcdm]+)$/i);

  if (!match) {
    return null;
  }

  const chapterText = match[2];

  return {
    book: romanNumeralToNumber(match[1]),
    chapter: /^\d+$/.test(chapterText) ? Number(chapterText) : romanNumeralToNumber(chapterText)
  };
}

function romanNumeralToNumber(value: string) {
  const numerals: Record<string, number> = {
    C: 100,
    D: 500,
    I: 1,
    L: 50,
    M: 1000,
    V: 5,
    X: 10
  };
  const letters = value.toUpperCase().split("");

  return letters.reduce((total, letter, index) => {
    const current = numerals[letter] ?? 0;
    const next = numerals[letters[index + 1]] ?? 0;

    return total + (current < next ? -current : current);
  }, 0);
}

function toRomanNumeral(value: number) {
  const parts: Array<[number, string]> = [
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"]
  ];
  let remaining = value;
  let roman = "";

  for (const [amount, numeral] of parts) {
    while (remaining >= amount) {
      roman += numeral;
      remaining -= amount;
    }
  }

  return roman;
}

function numberWord(value: number) {
  const ones = [
    "",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen"
  ];
  const tens: Record<number, string> = {
    20: "twenty",
    30: "thirty",
    40: "forty",
    50: "fifty",
    60: "sixty",
    70: "seventy",
    80: "eighty",
    90: "ninety"
  };

  if (value < ones.length) {
    return ones[value];
  }

  if (value < 100) {
    const tensValue = Math.floor(value / 10) * 10;
    return `${tens[tensValue] ?? ""}${ones[value - tensValue] ?? ""}`;
  }

  return "";
}

function numberFromWord(value: string) {
  for (let number = 1; number <= 99; number += 1) {
    if (numberWord(number) === value) {
      return number;
    }
  }

  return null;
}

function roundSeconds(value: number) {
  return Math.round(value * 10) / 10;
}

function parseArgs(rawArgs: string[]): Args {
  const parsed: Args = {
    book: null,
    dryRun: false,
    limit: null,
    minConfidence: DEFAULT_MIN_CONFIDENCE,
    reset: false,
    trackFileName: null
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--book") {
      parsed.book = Number(rawArgs[++index]);
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--limit") {
      parsed.limit = Number(rawArgs[++index]);
    } else if (arg === "--min-confidence") {
      parsed.minConfidence = Number(rawArgs[++index]);
    } else if (arg === "--reset") {
      parsed.reset = true;
    } else if (arg === "--track") {
      parsed.trackFileName = rawArgs[++index] ?? null;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (parsed.book !== null && (!Number.isInteger(parsed.book) || parsed.book < 1)) {
    throw new Error("--book must be a positive integer.");
  }

  if (parsed.limit !== null && (!Number.isInteger(parsed.limit) || parsed.limit < 1)) {
    throw new Error("--limit must be a positive integer.");
  }

  if (!Number.isFinite(parsed.minConfidence) || parsed.minConfidence < 0 || parsed.minConfidence > 1) {
    throw new Error("--min-confidence must be between 0 and 1.");
  }

  return parsed;
}
