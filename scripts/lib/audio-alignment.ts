import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import OpenAI from "openai";

import {
  loadTranscriptWords,
  type TranscriptWord
} from "./audio-transcript";

const BOOK_INDEX_PATH = "public/church-fathers-preview/books.json";
const AUDIO_SOURCES_PATH = "data/public-domain/church-fathers/audio-sources.json";
const PREVIEW_OUTPUT_DIR = "public/church-fathers-preview";
const TRANSCRIPT_CACHE_DIR = "storage/church-fathers-audio/transcripts";

export type { TranscriptWord } from "./audio-transcript";

export type NormalizedTranscriptWord = TranscriptWord & {
  normalized: string;
};

export type ChapterAudioSection = {
  book: number;
  chapter: number;
  id: string;
  text: string;
  title: string;
};

export type AlignedChapter = {
  audioUrl: string;
  confidence: number;
  endSeconds: number;
  label: string;
  startSeconds: number;
};

export type AlignmentMatchingPolicy = {
  defaultMinConfidence: number;
  endFallbackConfidence?: number;
  preference: "marker-first" | "text-first";
  refineTextWithNearestMarker?: boolean;
  startHints?: Record<number, string[]>;
  subsequentMinConfidence?: number;
  useEndNeedle: boolean;
  warnOnSkipped: "always" | "selected-track" | "never";
};

export type AlignmentPolicy = {
  alignmentScope?: "book" | "track";
  boundaryOffsetSeconds?: number;
  matching: AlignmentMatchingPolicy;
  name: string;
  parseChapterLocation: (chapterId: string) => {
    book: number;
    chapter: number;
  } | null;
  workId: string;
};

export type AudioAlignmentArgs = {
  book: number | null;
  dryRun: boolean;
  limit: number | null;
  minConfidence: number | null;
  reset: boolean;
  trackFileName: string | null;
  workId: string;
};

type AudioSourceTrack = {
  book: number;
  chapterEnd: number;
  chapterStart: number;
  fileName: string;
  label: string;
  url?: string;
};

type AudioAlignmentSource = {
  alignmentFile?: string;
  baseUrl?: string;
  fileTemplate?: string;
  labelTemplate?: string;
  location?: string;
  partsByBook?: Record<string, string[]>;
  sourcePage?: string;
  tracks?: AudioSourceTrack[];
  workId?: string;
};

type ResolvedTrack = {
  audioUrl: string;
  book: number;
  chapterEnd?: number;
  chapterStart?: number;
  fileName: string;
  label: string;
  part?: string;
};

type AudioSourcesFile = {
  sources: AudioAlignmentSource[];
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

type AlignmentPayload = {
  boundaryOffsetSeconds?: number;
  chapters?: Record<string, AlignedChapter>;
};

type AlignmentStart = {
  confidence: number;
  markerSeconds: number;
  nextCursor: number;
  section: ChapterAudioSection;
  startSeconds: number;
  wordIndex: number;
};

export function parseAudioAlignmentArgs(rawArgs: string[]): AudioAlignmentArgs {
  const parsed: AudioAlignmentArgs = {
    book: null,
    dryRun: false,
    limit: null,
    minConfidence: null,
    reset: false,
    trackFileName: null,
    workId: ""
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
    } else if (arg === "--work-id") {
      parsed.workId = rawArgs[++index] ?? "";
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!parsed.workId) {
    throw new Error("--work-id is required.");
  }

  if (parsed.book !== null && (!Number.isInteger(parsed.book) || parsed.book < 1)) {
    throw new Error("--book must be a positive integer.");
  }

  if (parsed.limit !== null && (!Number.isInteger(parsed.limit) || parsed.limit < 1)) {
    throw new Error("--limit must be a positive integer.");
  }

  if (
    parsed.minConfidence !== null &&
    (!Number.isFinite(parsed.minConfidence) || parsed.minConfidence < 0 || parsed.minConfidence > 1)
  ) {
    throw new Error("--min-confidence must be between 0 and 1.");
  }

  return parsed;
}

export function selectAlignmentPolicy(
  workId: string,
  policies: AlignmentPolicy[]
) {
  return selectWorkConfiguration(workId, policies);
}

export function alignTrackSections(
  trackSections: ChapterAudioSection[],
  words: NormalizedTranscriptWord[],
  policy: AlignmentMatchingPolicy,
  minConfidence: number,
  options: {
    selectedTrack?: boolean;
    warn?: (message: string) => void;
  } = {}
) {
  const normalizedWords = words.map((word) => word.normalized);
  const starts: Array<AlignmentStart | null> = [];
  const warn = options.warn ?? console.warn;
  let cursor = 0;

  for (const section of trackSections) {
    const textEvidence = findTextEvidence(
      section,
      normalizedWords,
      cursor,
      minConfidence,
      policy
    );
    const markerMatch = findChapterMarker(words, section.chapter, cursor);
    const hintMatch = findChapterStartHint(
      normalizedWords,
      policy.startHints?.[section.chapter],
      cursor
    );
    let start: AlignmentStart | null = null;

    if (policy.preference === "marker-first") {
      start = markerMatch
        ? startFromMarker(words, markerMatch, section)
        : hintMatch
          ? startFromHint(words, hintMatch, section)
          : startFromText(words, textEvidence, section, policy, cursor);
    } else {
      start = textEvidence.passes
        ? startFromText(words, textEvidence, section, policy, cursor)
        : markerMatch
          ? startFromMarker(words, markerMatch, section)
          : startFromEndFallback(words, textEvidence, section, policy, cursor);
    }

    if (!start) {
      if (
        policy.warnOnSkipped === "always" ||
        (policy.warnOnSkipped === "selected-track" && options.selectedTrack)
      ) {
        warn(
          `Skipped ${section.id} (${section.title}) ` +
          `startConfidence=${textEvidence.start.score.toFixed(2)} ` +
          `endConfidence=${textEvidence.end.score.toFixed(2)}`
        );
      }
      starts.push(null);
      continue;
    }

    starts.push(start);
    cursor = start.nextCursor;
  }

  return starts.map((start, index) => {
    if (!start) {
      return null;
    }

    const nextStart = starts.slice(index + 1).find(
      (candidate): candidate is AlignmentStart => Boolean(candidate)
    );

    return {
      confidence: start.confidence,
      endSeconds: nextStart?.markerSeconds ?? words[words.length - 1]?.end ?? 0,
      section: start.section,
      startSeconds: start.startSeconds
    };
  }).filter((alignment): alignment is NonNullable<typeof alignment> => Boolean(alignment));
}

function findTextEvidence(
  section: ChapterAudioSection,
  normalizedWords: string[],
  cursor: number,
  minConfidence: number,
  policy: AlignmentMatchingPolicy
) {
  const sectionWords = normalizeAlignmentText(section.text);
  const start = findBestAlignmentWindow(normalizedWords, sectionWords.slice(0, 18), cursor);
  const requiredConfidence = cursor > 0 && policy.subsequentMinConfidence !== undefined
    ? Math.min(minConfidence, policy.subsequentMinConfidence)
    : minConfidence;
  const endSearchIndex = policy.preference === "text-first" && start.score < requiredConfidence
    ? cursor
    : Math.max(start.index, cursor);
  const end = policy.useEndNeedle
    ? findBestAlignmentWindow(normalizedWords, sectionWords.slice(-18), endSearchIndex)
    : start;
  const confidence = policy.useEndNeedle
    ? Math.min(start.score, end.score)
    : start.score;

  return {
    confidence,
    end,
    passes: start.score >= requiredConfidence,
    requiredConfidence,
    start
  };
}

function startFromMarker(
  words: NormalizedTranscriptWord[],
  markerMatch: { contentIndex: number; markerIndex: number },
  section: ChapterAudioSection
): AlignmentStart {
  return {
    confidence: 1,
    markerSeconds: words[markerMatch.markerIndex]?.start ?? 0,
    nextCursor: markerMatch.contentIndex,
    section,
    startSeconds: words[markerMatch.contentIndex]?.start ??
      words[markerMatch.markerIndex]?.end ??
      0,
    wordIndex: markerMatch.contentIndex
  };
}

function startFromHint(
  words: NormalizedTranscriptWord[],
  hintMatch: number,
  section: ChapterAudioSection
): AlignmentStart {
  return {
    confidence: 1,
    markerSeconds: words[hintMatch]?.start ?? 0,
    nextCursor: hintMatch + 1,
    section,
    startSeconds: words[hintMatch]?.start ?? 0,
    wordIndex: hintMatch
  };
}

function startFromText(
  words: NormalizedTranscriptWord[],
  evidence: ReturnType<typeof findTextEvidence>,
  section: ChapterAudioSection,
  policy: AlignmentMatchingPolicy,
  cursor: number
): AlignmentStart | null {
  if (!evidence.passes) {
    return null;
  }

  const markerMatch = policy.refineTextWithNearestMarker
    ? findNearestChapterMarkerBefore(words, evidence.start.index, cursor)
    : null;
  const confidence = evidence.confidence >= evidence.requiredConfidence
    ? evidence.confidence
    : evidence.start.score;

  return {
    confidence,
    markerSeconds: markerMatch
      ? words[markerMatch.markerIndex]?.start ?? words[evidence.start.index]?.start ?? 0
      : words[evidence.start.index]?.start ?? 0,
    nextCursor: policy.useEndNeedle
      ? Math.max(evidence.start.index + 1, evidence.end.index)
      : evidence.start.index + 1,
    section,
    startSeconds: markerMatch
      ? words[markerMatch.contentIndex]?.start ?? words[evidence.start.index]?.start ?? 0
      : words[evidence.start.index]?.start ?? 0,
    wordIndex: evidence.start.index
  };
}

function startFromEndFallback(
  words: NormalizedTranscriptWord[],
  evidence: ReturnType<typeof findTextEvidence>,
  section: ChapterAudioSection,
  policy: AlignmentMatchingPolicy,
  cursor: number
): AlignmentStart | null {
  if (
    cursor === 0 ||
    policy.endFallbackConfidence === undefined ||
    evidence.end.score < policy.endFallbackConfidence ||
    evidence.end.index <= cursor
  ) {
    return null;
  }

  const seconds = words[cursor]?.end ?? words[cursor]?.start ?? 0;

  return {
    confidence: Math.min(0.9, evidence.end.score * 0.8),
    markerSeconds: seconds,
    nextCursor: evidence.end.index,
    section,
    startSeconds: seconds,
    wordIndex: cursor
  };
}

function findChapterStartHint(
  words: string[],
  hint: string[] | undefined,
  startIndex: number
) {
  if (!hint) {
    return null;
  }

  for (let index = startIndex; index <= words.length - hint.length; index += 1) {
    if (hint.every((word, offset) => words[index + offset] === word)) {
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
      parseChapterToken(words[index + 1]?.normalized) === chapter
    ) {
      return {
        contentIndex: Math.min(words.length - 1, index + 2),
        markerIndex: index
      };
    }
  }

  return null;
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

export function prepareAlignmentArtifact({
  boundaryOffsetSeconds,
  existing,
  generated,
  generatedAt,
  reset,
  sections,
  source
}: {
  boundaryOffsetSeconds: number | undefined;
  existing: Record<string, AlignedChapter>;
  generated: Record<string, AlignedChapter>;
  generatedAt: string;
  reset: boolean;
  sections: ChapterAudioSection[];
  source: string;
}) {
  const merged = reset ? generated : { ...existing, ...generated };
  const sorted = sortAlignedChapters(merged, sections);
  const chapters = boundaryOffsetSeconds === undefined
    ? sorted
    : shiftAlignmentBoundaries(sorted, sections, boundaryOffsetSeconds);

  return {
    ...(boundaryOffsetSeconds === undefined ? {} : { boundaryOffsetSeconds }),
    chapters,
    generatedAt,
    source
  };
}

function sortAlignedChapters<T>(
  chapters: Record<string, T>,
  orderedSections: ChapterAudioSection[]
) {
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

function shiftAlignmentBoundaries(
  chapters: Record<string, AlignedChapter>,
  orderedSections: ChapterAudioSection[],
  offsetSeconds: number
) {
  const shifted: Record<string, AlignedChapter> = {};
  const alignedIds = orderedSections
    .map((section) => section.id)
    .filter((id) => Boolean(chapters[id]));
  const lastIndex = alignedIds.length - 1;

  for (const [id, chapter] of Object.entries(chapters)) {
    const sectionIndex = alignedIds.indexOf(id);

    shifted[id] = {
      ...chapter,
      endSeconds: sectionIndex >= 0 && sectionIndex < lastIndex
        ? roundAlignmentSeconds(chapter.endSeconds + offsetSeconds)
        : chapter.endSeconds,
      startSeconds: sectionIndex > 0
        ? roundAlignmentSeconds(chapter.startSeconds + offsetSeconds)
        : chapter.startSeconds
    };
  }

  return shifted;
}

export async function runChapterAudioAlignment(
  rawArgs: string[],
  policies: AlignmentPolicy[],
  options: {
    log?: (message: string) => void;
    now?: () => Date;
  } = {}
) {
  const args = parseAudioAlignmentArgs(rawArgs);
  const policy = selectAlignmentPolicy(args.workId, policies);
  const log = options.log ?? console.log;
  const sourcesFile = await readJsonFile(AUDIO_SOURCES_PATH, isAudioSourcesFile);
  const source = selectAudioSource(args.workId, sourcesFile.sources);

  if (!source.alignmentFile || !source.sourcePage) {
    throw new Error(
      `Audio source ${args.workId} must define alignmentFile and sourcePage in ${AUDIO_SOURCES_PATH}.`
    );
  }

  const sections = await loadSections(policy);
  const tracks = buildTracks(source, sections);
  const sectionsByTrack = tracks
    .map((track) => ({
      sections: sections.filter((section) => (
        trackForSection(source, sections, section)?.fileName === track.fileName
      )),
      track
    }))
    .filter(({ sections: trackSections }) => trackSections.length > 0);
  const selectedTracks = sectionsByTrack
    .filter(({ track }) => !args.trackFileName || track.fileName === args.trackFileName)
    .filter(({ track }) => args.book === null || track.book === args.book)
    .slice(0, args.limit ?? undefined);

  if (args.dryRun) {
    log(`Work: ${policy.name} (${policy.workId})`);
    log(`Tracks: ${tracks.length}`);
    log(`Chapters: ${sections.length}`);
    log(`Selected tracks: ${selectedTracks.length}`);
    for (const { sections: trackSections, track } of selectedTracks) {
      log(`${track.fileName}: ${trackSections.length} Chapters`);
    }

    return {
      chapterCount: sections.length,
      selectedTrackCount: selectedTracks.length,
      trackCount: tracks.length,
      workId: policy.workId
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to build Chapter Audio Alignment.");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const outputPath = path.join(PREVIEW_OUTPUT_DIR, source.alignmentFile);
  const existing = await readExistingAlignments(
    outputPath,
    args.reset,
    policy.boundaryOffsetSeconds,
    sections
  );
  const generated: Record<string, AlignedChapter> = {};
  const minConfidence = args.minConfidence ?? policy.matching.defaultMinConfidence;

  for (const { sections: trackSections, track } of selectedTracks) {
    const candidateSections = policy.alignmentScope === "book"
      ? sections.filter((section) => section.book === track.book)
      : trackSections;
    log(`Aligning ${track.label} (${candidateSections.length} candidate Chapters)`);
    const words = normalizeTranscriptWords(
      await loadTranscriptWords(client, track, TRANSCRIPT_CACHE_DIR)
    );
    const alignments = alignTrackSections(
      candidateSections,
      words,
      policy.matching,
      minConfidence,
      { selectedTrack: Boolean(args.trackFileName) }
    );

    for (const alignment of alignments) {
      generated[alignment.section.id] = {
        audioUrl: track.audioUrl,
        confidence: alignment.confidence,
        endSeconds: roundAlignmentSeconds(alignment.endSeconds),
        label: track.label,
        startSeconds: roundAlignmentSeconds(alignment.startSeconds)
      };
    }
  }

  const artifact = prepareAlignmentArtifact({
    boundaryOffsetSeconds: policy.boundaryOffsetSeconds,
    existing,
    generated,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    reset: args.reset,
    sections,
    source: source.sourcePage
  });

  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  log(`Wrote ${Object.keys(artifact.chapters).length} aligned Chapters to ${outputPath}`);

  return {
    chapterCount: sections.length,
    outputPath,
    selectedTrackCount: selectedTracks.length,
    trackCount: tracks.length,
    workId: policy.workId
  };
}

function selectAudioSource(workId: string, sources: AudioAlignmentSource[]) {
  return selectWorkConfiguration(workId, sources);
}

function selectWorkConfiguration<T extends { workId?: string }>(
  workId: string,
  configurations: T[]
) {
  const configuration = configurations.find(
    (candidate) => candidate.workId === workId
  );

  if (configuration) {
    return configuration;
  }

  const configuredWorkIds = configurations
    .flatMap((candidate) => candidate.workId ? [candidate.workId] : [])
    .sort();
  throw new Error(
    `Unknown Work ID ${workId}. Configured Work IDs: ${configuredWorkIds.join(", ")}`
  );
}

async function loadSections(policy: AlignmentPolicy) {
  const index = await readJsonFile(BOOK_INDEX_PATH, isBookIndex);
  const book = index.books.find((candidate) => candidate.id === policy.workId);

  if (!book) {
    throw new Error(`Missing ${policy.workId} in ${BOOK_INDEX_PATH}`);
  }

  const sections: ChapterAudioSection[] = [];

  for (const chapter of book.chapters) {
    const location = policy.parseChapterLocation(chapter.id);

    if (!location) {
      continue;
    }

    const asset = await readJsonFile(
      path.join("public", chapter.assetPath),
      isChapterAsset
    );
    sections.push({
      ...location,
      id: chapter.id,
      text: asset.verses.map((verse) => verse.text).join(" "),
      title: chapter.title
    });
  }

  return sections;
}

function buildTracks(
  source: AudioAlignmentSource,
  orderedSections: ChapterAudioSection[]
) {
  const explicitTracks = (source.tracks ?? []).map((track): ResolvedTrack => ({
    audioUrl: track.url ?? `${source.baseUrl}/${track.fileName}`,
    book: track.book,
    chapterEnd: track.chapterEnd,
    chapterStart: track.chapterStart,
    fileName: track.fileName,
    label: track.label
  }));

  if (explicitTracks.length > 0) {
    return explicitTracks.filter((track) => orderedSections.some((section) => (
      trackForSection(source, orderedSections, section)?.fileName === track.fileName
    )));
  }

  if (!source.baseUrl || !source.fileTemplate || !source.partsByBook) {
    return [];
  }

  return Object.entries(source.partsByBook)
    .sort(([left], [right]) => Number(left) - Number(right))
    .flatMap(([bookText, parts]) => {
      const book = Number(bookText);

      return parts.map((part): ResolvedTrack => {
        const fileName = source.fileTemplate?.replace("{part}", part) ?? "";

        return {
          audioUrl: `${source.baseUrl}/${fileName}`,
          book,
          fileName,
          label: formatTrackLabel(source.labelTemplate, book, part),
          part
        };
      });
    })
    .filter((track) => orderedSections.some((section) => (
      trackForSection(source, orderedSections, section)?.fileName === track.fileName
    )));
}

function trackForSection(
  source: AudioAlignmentSource,
  orderedSections: ChapterAudioSection[],
  section: ChapterAudioSection
): ResolvedTrack | null {
  const explicitTrack = source.tracks?.find((track) => (
    track.book === section.book &&
    track.chapterStart <= section.chapter &&
    track.chapterEnd >= section.chapter
  ));

  if (explicitTrack) {
    return {
      audioUrl: explicitTrack.url ?? `${source.baseUrl}/${explicitTrack.fileName}`,
      book: explicitTrack.book,
      chapterEnd: explicitTrack.chapterEnd,
      chapterStart: explicitTrack.chapterStart,
      fileName: explicitTrack.fileName,
      label: explicitTrack.label
    };
  }

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
    label: formatTrackLabel(source.labelTemplate, section.book, part),
    part
  };
}

function formatTrackLabel(template: string | undefined, book: number, part: string) {
  return (template ?? "Book {book:02d}, part {partLetter}")
    .replace(/\{book:02d\}/g, String(book).padStart(2, "0"))
    .replace(/\{book\}/g, String(book))
    .replace(/\{partLetter\}/g, part.slice(-1).toUpperCase())
    .replace(/\{part\}/g, part);
}

async function readExistingAlignments(
  outputPath: string,
  reset: boolean,
  boundaryOffsetSeconds: number | undefined,
  sections: ChapterAudioSection[]
) {
  if (reset) {
    return {};
  }

  try {
    const existing = await readJsonFile(outputPath, isAlignmentPayload);
    const chapters = existing.chapters ?? {};

    if (
      boundaryOffsetSeconds !== undefined &&
      existing.boundaryOffsetSeconds === boundaryOffsetSeconds
    ) {
      return shiftAlignmentBoundaries(chapters, sections, -boundaryOffsetSeconds);
    }

    return chapters;
  } catch {
    return {};
  }
}

async function readJsonFile<T>(
  filePath: string,
  isExpected: (value: unknown) => value is T
) {
  const value = parseAlignmentJson(await readFile(filePath, "utf8"));

  if (!isExpected(value)) {
    throw new Error(`Invalid JSON shape in ${filePath}`);
  }

  return value;
}

function isAudioSourcesFile(value: unknown): value is AudioSourcesFile {
  return isRecord(value) &&
    Array.isArray(value.sources) &&
    value.sources.every(isAudioSource);
}

function isAudioSource(value: unknown): value is AudioAlignmentSource {
  return isRecord(value) &&
    optionalString(value.alignmentFile) &&
    optionalString(value.baseUrl) &&
    optionalString(value.fileTemplate) &&
    optionalString(value.labelTemplate) &&
    optionalString(value.location) &&
    optionalString(value.sourcePage) &&
    optionalString(value.workId) &&
    (
      value.partsByBook === undefined ||
      (
        isRecord(value.partsByBook) &&
        Object.values(value.partsByBook).every((parts) => (
          Array.isArray(parts) && parts.every((part) => typeof part === "string")
        ))
      )
    ) &&
    (
      value.tracks === undefined ||
      (Array.isArray(value.tracks) && value.tracks.every(isAudioSourceTrack))
    );
}

function isAudioSourceTrack(value: unknown): value is AudioSourceTrack {
  return isRecord(value) &&
    typeof value.book === "number" &&
    typeof value.chapterEnd === "number" &&
    typeof value.chapterStart === "number" &&
    typeof value.fileName === "string" &&
    typeof value.label === "string" &&
    optionalString(value.url);
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
    (value.boundaryOffsetSeconds === undefined || typeof value.boundaryOffsetSeconds === "number") &&
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

export function findBestAlignmentWindow(
  haystack: string[],
  needle: string[],
  startIndex: number
) {
  if (needle.length === 0) {
    return { index: startIndex, score: 0 };
  }

  let best = { index: startIndex, score: -1 };
  const maxWindowExtra = 8;

  for (let index = startIndex; index < haystack.length; index += 1) {
    const window = haystack.slice(index, index + needle.length + maxWindowExtra);
    const score = longestCommonSubsequenceLength(needle, window) / needle.length;

    if (score > best.score) {
      best = { index, score };
    }

    if (score === 1) {
      break;
    }
  }

  return best;
}

export function longestCommonSubsequenceLength(left: string[], right: string[]) {
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

export function normalizeTranscriptWords(
  words: TranscriptWord[]
): NormalizedTranscriptWord[] {
  return words
    .map((word) => ({
      ...word,
      normalized: normalizeAlignmentToken(word.word)
    }))
    .filter((word) => word.normalized);
}

export function normalizeAlignmentText(value: string) {
  return value
    .split(/\s+/)
    .map(normalizeAlignmentToken)
    .filter(Boolean);
}

export function normalizeAlignmentToken(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

export function romanNumeralToNumber(value: string) {
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

export function toRomanNumeral(value: number) {
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

function numberFromWord(value: string) {
  for (let number = 1; number <= 99; number += 1) {
    if (numberWord(number) === value) {
      return number;
    }
  }

  return null;
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

export function roundAlignmentSeconds(value: number) {
  return Math.round(value * 10) / 10;
}

export function parseAlignmentJson(value: string): unknown {
  const parsed: unknown = JSON.parse(value);
  return parsed;
}
