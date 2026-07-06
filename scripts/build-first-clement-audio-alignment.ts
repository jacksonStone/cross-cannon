import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import OpenAI from "openai";

const FIRST_CLEMENT_BOOK_ID = "anf09:xii.iv";
const BOOK_INDEX_PATH = "public/church-fathers-preview/books.json";
const OUTPUT_PATH = "public/church-fathers-preview/first-clement-audio-alignment.json";
const TRANSCRIPT_CACHE_DIR = "storage/church-fathers-audio/transcripts";
const SOURCE_PAGE = "http://www.biblicalaudio.com/clement1.htm";
const TRACK = {
  chapterEnd: 3,
  chapterStart: 1,
  fileName: "Clemens-01~03.mp3",
  label: "Chapters 01-03",
  url: "https://www.biblicalaudio.com/audio/music/CLEMENS/Clemens-01%7E03.mp3"
};
const OUTPUT_CHAPTER_LIMIT = 1;
const numberWords: Record<number, string> = {
  1: "one",
  2: "two",
  3: "three"
};
const chapterStartHints: Record<number, string[]> = {
  2: ["now", "all", "of", "you", "were", "humble", "minded"],
  3: ["from", "this", "time", "on", "flowed", "jealousy"]
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

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required to build First Clement audio alignment.");
}

await mkdir(TRANSCRIPT_CACHE_DIR, { recursive: true });
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const sections = (await loadFirstClementSections()).filter((section) => (
  section.chapter >= TRACK.chapterStart && section.chapter <= TRACK.chapterEnd
));
const words = await getTranscriptWords(client);
const alignments = alignTrackSections(sections, words);
const chapters: Record<string, {
  audioUrl: string;
  confidence: number;
  endSeconds: number;
  label: string;
  startSeconds: number;
}> = {};

for (const alignment of alignments) {
  if (!alignment || alignment.section.chapter > OUTPUT_CHAPTER_LIMIT) {
    continue;
  }

  chapters[alignment.section.id] = {
    audioUrl: TRACK.url,
    confidence: alignment.confidence,
    endSeconds: roundSeconds(alignment.endSeconds),
    label: TRACK.label,
    startSeconds: roundSeconds(alignment.startSeconds)
  };
}

await writeFile(OUTPUT_PATH, `${JSON.stringify({
  chapters,
  generatedAt: new Date().toISOString(),
  source: SOURCE_PAGE
}, null, 2)}\n`);

console.log(`Wrote ${Object.keys(chapters).length} aligned section to ${OUTPUT_PATH}`);

async function loadFirstClementSections() {
  const index = parseJson(await readFile(BOOK_INDEX_PATH, "utf8")) as BookIndex;
  const firstClement = index.books.find((book) => book.id === FIRST_CLEMENT_BOOK_ID);

  if (!firstClement) {
    throw new Error(`Missing ${FIRST_CLEMENT_BOOK_ID} in ${BOOK_INDEX_PATH}`);
  }

  const loadedSections: Section[] = [];

  for (const chapter of firstClement.chapters) {
    const chapterNumber = parseFirstClementChapterNumber(chapter.id);

    if (!chapterNumber) {
      continue;
    }

    const asset = parseJson(
      await readFile(path.join("public", chapter.assetPath), "utf8")
    ) as ChapterAsset;

    loadedSections.push({
      chapter: chapterNumber,
      id: chapter.id,
      text: asset.verses.map((verse) => verse.text).join(" "),
      title: chapter.title
    });
  }

  return loadedSections;
}

async function getTranscriptWords(client: OpenAI) {
  const cachePath = path.join(TRANSCRIPT_CACHE_DIR, `${TRACK.fileName}.json`);

  try {
    const cached = parseJson(await readFile(cachePath, "utf8")) as { words?: TranscriptWord[] };

    if (cached.words?.length) {
      return normalizeTranscriptWords(cached.words);
    }
  } catch {
    // Cache miss.
  }

  const tempPath = path.join(os.tmpdir(), TRACK.fileName);

  try {
    const response = await fetch(TRACK.url);

    if (!response.ok) {
      throw new Error(`Failed to download ${TRACK.url}: ${response.status}`);
    }

    await writeFile(tempPath, new Uint8Array(await response.arrayBuffer()));

    const transcription = await client.audio.transcriptions.create({
      file: createReadStream(tempPath),
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word"]
    }) as { words?: TranscriptWord[] };

    if (!transcription.words?.length) {
      throw new Error(`No word timestamps returned for ${TRACK.fileName}`);
    }

    await writeFile(cachePath, `${JSON.stringify(transcription, null, 2)}\n`);
    return normalizeTranscriptWords(transcription.words);
  } finally {
    await rm(tempPath, { force: true });
  }
}

function alignTrackSections(sections: Section[], words: NormalizedTranscriptWord[]) {
  const normalizedWords = words.map((word) => word.normalized);
  const starts: Array<{
    confidence: number;
    markerSeconds: number;
    section: Section;
    startSeconds: number;
    wordIndex: number;
  } | null> = [];
  let cursor = 0;

  for (const section of sections) {
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

    const hintMatch = findChapterStartHint(normalizedWords, section.chapter, cursor);

    if (hintMatch) {
      starts.push({
        confidence: hintMatch.score,
        markerSeconds: words[hintMatch.index]?.start ?? 0,
        section,
        startSeconds: words[hintMatch.index]?.start ?? 0,
        wordIndex: hintMatch.index
      });
      cursor = hintMatch.index + 1;
      continue;
    }

    const sectionWords = normalizeText(section.text);
    const startNeedle = sectionWords.slice(0, 18);
    const startMatch = findBestWindow(normalizedWords, startNeedle, cursor);

    if (startMatch.score < 0.6) {
      console.warn(
        `Skipped ${section.id} (${section.title}) startConfidence=${startMatch.score.toFixed(2)}`
      );
      starts.push(null);
      continue;
    }

    starts.push({
      confidence: startMatch.score,
      markerSeconds: words[startMatch.index]?.start ?? 0,
      section,
      startSeconds: words[startMatch.index]?.start ?? 0,
      wordIndex: startMatch.index
    });
    cursor = startMatch.index + 1;
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

function findChapterStartHint(
  words: string[],
  chapter: number,
  startIndex: number
) {
  const hint = chapterStartHints[chapter];

  if (!hint) {
    return null;
  }

  const match = findExactSequence(words, hint, startIndex);

  return match ? { index: match, score: 1 } : null;
}

function findExactSequence(haystack: string[], needle: string[], startIndex: number) {
  for (let index = startIndex; index <= haystack.length - needle.length; index += 1) {
    if (needle.every((word, offset) => haystack[index + offset] === word)) {
      return index;
    }
  }

  return null;
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

function parseFirstClementChapterNumber(chapterId: string) {
  const match = chapterId.match(/^anf09:xii\.iv\.([ivxlcdm]+)$/);

  return match ? romanNumeralToNumber(match[1]) : null;
}

function romanNumeralToNumber(value: string) {
  const numerals: Record<string, number> = {
    c: 100,
    d: 500,
    i: 1,
    l: 50,
    m: 1000,
    v: 5,
    x: 10
  };
  const letters = value.toLowerCase().split("");

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

function roundSeconds(value: number) {
  return Math.round(value * 10) / 10;
}

function parseJson(value: string): unknown {
  const parsed: unknown = JSON.parse(value);
  return parsed;
}
