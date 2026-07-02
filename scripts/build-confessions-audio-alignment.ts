import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import OpenAI from "openai";

const CONFESSIONS_BOOK_ID = "npnf101:vi";
const AUDIO_BASE_URL = "https://archive.org/download/confessions_augustine_0911_librivox";
const BOOK_INDEX_PATH = "public/church-fathers-preview/books.json";
const OUTPUT_PATH = "public/church-fathers-preview/confessions-audio-alignment.json";
const TRANSCRIPT_CACHE_DIR = "storage/church-fathers-audio/transcripts";
const DEFAULT_MIN_CONFIDENCE = 0.72;
const numberWords: Record<number, string> = {
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
  9: "nine",
  10: "ten",
  11: "eleven",
  12: "twelve",
  13: "thirteen",
  14: "fourteen",
  15: "fifteen",
  16: "sixteen",
  17: "seventeen",
  18: "eighteen",
  19: "nineteen",
  20: "twenty",
  21: "twentyone",
  22: "twentytwo",
  23: "twentythree",
  24: "twentyfour",
  25: "twentyfive",
  26: "twentysix",
  27: "twentyseven",
  28: "twentyeight",
  29: "twentynine",
  30: "thirty",
  31: "thirtyone",
  32: "thirtytwo",
  33: "thirtythree",
  34: "thirtyfour",
  35: "thirtyfive",
  36: "thirtysix",
  37: "thirtyseven",
  38: "thirtyeight",
  39: "thirtynine",
  40: "forty",
  41: "fortyone",
  42: "fortytwo",
  43: "fortythree"
};

const TRACKS = [
  { book: 1, chapterEnd: 10, chapterStart: 1, fileName: "confessions_01_01-10_augustine_64kb.mp3", label: "Book 01, Chapters 01-10" },
  { book: 1, chapterEnd: 19, chapterStart: 11, fileName: "confessions_01_11-19_augustine_64kb.mp3", label: "Book 01, Chapters 11-19" },
  { book: 2, chapterEnd: 10, chapterStart: 1, fileName: "confessions_02_01-10_augustine_64kb.mp3", label: "Book 02, Chapters 01-10" },
  { book: 3, chapterEnd: 7, chapterStart: 1, fileName: "confessions_03_01-07_augustine_64kb.mp3", label: "Book 03, Chapters 01-07" },
  { book: 3, chapterEnd: 12, chapterStart: 8, fileName: "confessions_03_08-12_augustine_64kb.mp3", label: "Book 03, Chapters 08-12" },
  { book: 4, chapterEnd: 9, chapterStart: 1, fileName: "confessions_04_01-09_augustine_64kb.mp3", label: "Book 04, Chapters 01-09" },
  { book: 4, chapterEnd: 15, chapterStart: 10, fileName: "confessions_04_10-15_augustine_64kb.mp3", label: "Book 04, Chapters 10-15" },
  { book: 5, chapterEnd: 7, chapterStart: 1, fileName: "confessions_05_01-07_augustine_64kb.mp3", label: "Book 05, Chapters 01-07" },
  { book: 5, chapterEnd: 14, chapterStart: 8, fileName: "confessions_05_08-14_augustine_64kb.mp3", label: "Book 05, Chapters 08-14" },
  { book: 6, chapterEnd: 7, chapterStart: 1, fileName: "confessions_06_01-07_augustine_64kb.mp3", label: "Book 06, Chapters 01-07" },
  { book: 6, chapterEnd: 16, chapterStart: 8, fileName: "confessions_06_08-16_augustine_64kb.mp3", label: "Book 06, Chapters 08-16" },
  { book: 7, chapterEnd: 9, chapterStart: 1, fileName: "confessions_07_01-09_augustine_64kb.mp3", label: "Book 07, Chapters 01-09" },
  { book: 7, chapterEnd: 21, chapterStart: 10, fileName: "confessions_07_10-21_augustine_64kb.mp3", label: "Book 07, Chapters 10-21" },
  { book: 8, chapterEnd: 6, chapterStart: 1, fileName: "confessions_08_01-06_augustine_64kb.mp3", label: "Book 08, Chapters 01-06" },
  { book: 8, chapterEnd: 12, chapterStart: 7, fileName: "confessions_08_07-12_augustine_64kb.mp3", label: "Book 08, Chapters 07-12" },
  { book: 9, chapterEnd: 8, chapterStart: 1, fileName: "confessions_09_01-08_augustine_64kb.mp3", label: "Book 09, Chapters 01-08" },
  { book: 9, chapterEnd: 13, chapterStart: 9, fileName: "confessions_09_09-13_augustine_64kb.mp3", label: "Book 09, Chapters 09-13" },
  { book: 10, chapterEnd: 10, chapterStart: 1, fileName: "confessions_10_01-10_augustine_64kb.mp3", label: "Book 10, Chapters 01-10" },
  { book: 10, chapterEnd: 22, chapterStart: 11, fileName: "confessions_10_11-22_augustine_64kb.mp3", label: "Book 10, Chapters 11-22" },
  { book: 10, chapterEnd: 33, chapterStart: 23, fileName: "confessions_10_23-33_augustine_64kb.mp3", label: "Book 10, Chapters 23-33" },
  { book: 10, chapterEnd: 43, chapterStart: 34, fileName: "confessions_10_34-43_augustine_64kb.mp3", label: "Book 10, Chapters 34-43" },
  { book: 11, chapterEnd: 11, chapterStart: 1, fileName: "confessions_11_01-11_augustine_64kb.mp3", label: "Book 11, Chapters 01-11" },
  { book: 11, chapterEnd: 21, chapterStart: 12, fileName: "confessions_11_12-21_augustine_64kb.mp3", label: "Book 11, Chapters 12-21" },
  { book: 11, chapterEnd: 31, chapterStart: 22, fileName: "confessions_11_22-31_augustine_64kb.mp3", label: "Book 11, Chapters 22-31" },
  { book: 12, chapterEnd: 11, chapterStart: 1, fileName: "confessions_12_01-11_augustine_64kb.mp3", label: "Book 12, Chapters 01-11" },
  { book: 12, chapterEnd: 22, chapterStart: 12, fileName: "confessions_12_12-22_augustine_64kb.mp3", label: "Book 12, Chapters 12-22" },
  { book: 12, chapterEnd: 32, chapterStart: 23, fileName: "confessions_12_23-32_augustine_64kb.mp3", label: "Book 12, Chapters 23-32" },
  { book: 13, chapterEnd: 10, chapterStart: 1, fileName: "confessions_13_01-10_augustine_64kb.mp3", label: "Book 13, Chapters 01-10" },
  { book: 13, chapterEnd: 20, chapterStart: 11, fileName: "confessions_13_11-20_augustine_64kb.mp3", label: "Book 13, Chapters 11-20" },
  { book: 13, chapterEnd: 29, chapterStart: 21, fileName: "confessions_13_21-29_augustine_64kb.mp3", label: "Book 13, Chapters 21-29" },
  { book: 13, chapterEnd: 38, chapterStart: 30, fileName: "confessions_13_30-38_augustine_64kb.mp3", label: "Book 13, Chapters 30-38" }
] as const;

type Track = typeof TRACKS[number];

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

type TranscriptWord = {
  end: number;
  start: number;
  word: string;
};

type NormalizedTranscriptWord = TranscriptWord & {
  normalized: string;
};

type Args = {
  dryRun: boolean;
  limit: number | null;
  minConfidence: number;
  trackFileName: string | null;
};

const args = parseArgs(process.argv.slice(2));
const sections = await loadConfessionsSections();
const sectionsByTrack = TRACKS.map((track) => ({
  sections: sections.filter((section) => (
    section.book === track.book &&
    section.chapter >= track.chapterStart &&
    section.chapter <= track.chapterEnd
  )),
  track
})).filter(({ sections: trackSections }) => trackSections.length > 0);

const selectedTracks = sectionsByTrack
  .filter(({ track }) => !args.trackFileName || track.fileName === args.trackFileName)
  .slice(0, args.limit ?? undefined);

if (args.dryRun) {
  console.log(`Tracks: ${TRACKS.length}`);
  console.log(`Confessions sections: ${sections.length}`);
  console.log(`Selected tracks: ${selectedTracks.length}`);
  for (const { sections: trackSections, track } of selectedTracks) {
    console.log(`${track.fileName}: ${trackSections.length} sections`);
  }
  process.exit(0);
}

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required to build Confessions audio alignment.");
}

await mkdir(TRANSCRIPT_CACHE_DIR, { recursive: true });
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const alignedChapters: Record<string, {
  audioUrl: string;
  confidence: number;
  endSeconds: number;
  label: string;
  startSeconds: number;
}> = await readExistingAlignments();

for (const { sections: trackSections, track } of selectedTracks) {
  const audioUrl = `${AUDIO_BASE_URL}/${track.fileName}`;
  console.log(`Aligning ${track.label} (${trackSections.length} sections)`);
  const words = await getTranscriptWords(client, track, audioUrl);
  const alignments = alignTrackSections(trackSections, words, args.minConfidence);

  for (const alignment of alignments) {
    if (!alignment) {
      continue;
    }

    alignedChapters[alignment.section.id] = {
      audioUrl,
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
  source: "https://archive.org/details/confessions_augustine_0911_librivox"
}, null, 2)}\n`);

console.log(`Wrote ${Object.keys(alignedChapters).length} aligned sections to ${OUTPUT_PATH}`);

async function readExistingAlignments() {
  try {
    const existing = JSON.parse(await readFile(OUTPUT_PATH, "utf8")) as {
      chapters?: Record<string, {
        audioUrl: string;
        confidence: number;
        endSeconds: number;
        label: string;
        startSeconds: number;
      }>;
    };

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

async function loadConfessionsSections() {
  const index = JSON.parse(await readFile(BOOK_INDEX_PATH, "utf8")) as BookIndex;
  const confessions = index.books.find((book) => book.id === CONFESSIONS_BOOK_ID);

  if (!confessions) {
    throw new Error(`Missing ${CONFESSIONS_BOOK_ID} in ${BOOK_INDEX_PATH}`);
  }

  const loadedSections: Section[] = [];

  for (const chapter of confessions.chapters) {
    const location = parseConfessionsLocation(chapter.id);

    if (!location) {
      continue;
    }

    const asset = JSON.parse(
      await readFile(path.join("public", chapter.assetPath), "utf8")
    ) as ChapterAsset;

    loadedSections.push({
      ...location,
      id: chapter.id,
      text: asset.verses.map((verse) => verse.text).join(" "),
      title: chapter.title
    });
  }

  return loadedSections;
}

async function getTranscriptWords(client: OpenAI, track: Track, audioUrl: string) {
  const cachePath = path.join(TRANSCRIPT_CACHE_DIR, `${track.fileName}.json`);

  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8")) as { words?: TranscriptWord[] };

    if (cached.words?.length) {
      return normalizeTranscriptWords(cached.words);
    }
  } catch {
    // Cache miss.
  }

  const tempPath = path.join(os.tmpdir(), track.fileName);

  try {
    const response = await fetch(audioUrl);

    if (!response.ok) {
      throw new Error(`Failed to download ${audioUrl}: ${response.status}`);
    }

    await writeFile(tempPath, new Uint8Array(await response.arrayBuffer()));

    const transcription = await client.audio.transcriptions.create({
      file: createReadStream(tempPath),
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word"]
    }) as { words?: TranscriptWord[] };

    if (!transcription.words?.length) {
      throw new Error(`No word timestamps returned for ${track.fileName}`);
    }

    await writeFile(cachePath, `${JSON.stringify(transcription, null, 2)}\n`);
    return normalizeTranscriptWords(transcription.words);
  } finally {
    await rm(tempPath, { force: true });
  }
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

    const sectionWords = normalizeText(section.text);
    const startNeedle = sectionWords.slice(0, 18);
    const endNeedle = sectionWords.slice(-18);
    const startMatch = findBestWindow(normalizedWords, startNeedle, cursor);
    const endMatch = findBestWindow(
      normalizedWords,
      endNeedle,
      Math.max(startMatch.index, cursor)
    );
    const textConfidence = Math.min(startMatch.score, endMatch.score);
    const requiredConfidence = cursor > 0 ? Math.min(minConfidence, 0.6) : minConfidence;

    if (startMatch.score < requiredConfidence) {
      console.warn(
        `Skipped ${section.id} (${section.title}) startConfidence=${startMatch.score.toFixed(2)} endConfidence=${endMatch.score.toFixed(2)}`
      );
      starts.push(null);
      continue;
    }

    starts.push({
      confidence: textConfidence >= requiredConfidence ? textConfidence : startMatch.score,
      markerSeconds: words[startMatch.index]?.start ?? 0,
      section,
      startSeconds: words[startMatch.index]?.start ?? 0,
      wordIndex: startMatch.index
    });
    cursor = Math.max(startMatch.index + 1, endMatch.index);
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
  if (!token) {
    return false;
  }

  return token === String(chapter) ||
    token === numberWords[chapter] ||
    token === toRomanNumeral(chapter).toLowerCase();
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

function parseConfessionsLocation(chapterId: string) {
  const match = chapterId.match(/^npnf101:vi\.([IVXLCDM]+)(?:_1)?\.([IVXLCDM]+)$/);

  if (!match) {
    return null;
  }

  return {
    book: romanNumeralToNumber(match[1]),
    chapter: romanNumeralToNumber(match[2])
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

function roundSeconds(value: number) {
  return Math.round(value * 10) / 10;
}

function parseArgs(rawArgs: string[]): Args {
  const parsed: Args = {
    dryRun: false,
    limit: null,
    minConfidence: DEFAULT_MIN_CONFIDENCE,
    trackFileName: null
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--limit") {
      parsed.limit = Number(rawArgs[++index]);
    } else if (arg === "--min-confidence") {
      parsed.minConfidence = Number(rawArgs[++index]);
    } else if (arg === "--track") {
      parsed.trackFileName = rawArgs[++index] ?? null;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (parsed.limit !== null && (!Number.isInteger(parsed.limit) || parsed.limit < 1)) {
    throw new Error("--limit must be a positive integer.");
  }

  if (!Number.isFinite(parsed.minConfidence) || parsed.minConfidence < 0 || parsed.minConfidence > 1) {
    throw new Error("--min-confidence must be between 0 and 1.");
  }

  return parsed;
}
