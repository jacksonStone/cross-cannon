import {
  FIRST_FATHERS_WORK_ID,
  getCachedPreviewJson
} from "~/features/early-christian-preview/preview-cache";
import { getCenteredWindowRange } from "~/features/reader-window/window-range";

import type { BookIndex, BookSummary, ChapterEntry, PreviewManifest } from "./types";

export const SEARCH_EXAMPLES = [
  "repentance and mercy",
  "the resurrection of the body",
  "patience in suffering",
  "the unity of the church",
  "the incarnation",
  "prayer and fasting"
];

export const MAX_AUTHOR_FILTERS = 3;

const WORK_CHRONOLOGY: Record<string, number> = {
  "anf09:xii.iv": 96,
  "anf09:xii.vi": 120
};

const AUTHOR_CHRONOLOGY: Record<string, number> = {
  "clement of rome": 96,
  "ignatius": 108,
  "polycarp": 110,
  "papias": 120,
  "aristides": 125,
  "pastor of hermas": 140,
  "hermas": 140,
  "justin martyr": 155,
  "mathetes": 160,
  "tatian": 165,
  "athenagoras": 177,
  "theophilus": 180,
  "irenaeus": 185,
  "clement of alexandria": 195,
  "tertullian": 205,
  "minucius felix": 210,
  "hippolytus": 225,
  "origen": 230,
  "cyprian": 250,
  "commodianus": 255,
  "novatian": 255,
  "gregory thaumaturgus": 260,
  "dionysius": 265,
  "methodius": 300,
  "lactantius": 310,
  "eusebius": 325,
  "athanasius": 340,
  "cyril of jerusalem": 350,
  "hilary": 355,
  "basil": 370,
  "gregory of nazianzus": 375,
  "gregory of nyssa": 380,
  "ambrose": 385,
  "jerome": 390,
  "john chrysostom": 395,
  "augustine": 400,
  "sulpitius severus": 405,
  "cyril of alexandria": 425,
  "leo": 445,
  "gregory the great": 590
};

export function flattenChapters(bookIndex: BookIndex | null): ChapterEntry[] {
  if (!bookIndex) {
    return [];
  }

  const entries: ChapterEntry[] = [];

  for (const book of bookIndex.books) {
    for (const chapter of book.chapters) {
      entries.push({
        book,
        chapter,
        index: entries.length
      });
    }
  }

  return entries;
}

export function sortBookIndex(bookIndex: BookIndex): BookIndex {
  return {
    ...bookIndex,
    books: bookIndex.books
      .map((book, index) => ({ book, index }))
      .sort((left, right) => compareBooks(left.book, right.book, left.index, right.index))
      .map(({ book }) => ({
        ...book,
        chapters: [...book.chapters].sort((left, right) => left.chapter - right.chapter)
      }))
  };
}

export function readCachedBookIndex(
  manifestUrl: string,
  previewAssetVersion: string
) {
  const cachedManifest = getCachedPreviewJson<PreviewManifest>(
    manifestUrl,
    previewAssetVersion
  );

  if (!cachedManifest) {
    return null;
  }

  const cachedBookIndex = getCachedPreviewJson<BookIndex>(
    cachedManifest.bookIndexPath,
    previewAssetVersion
  );

  return cachedBookIndex ? sortBookIndex(cachedBookIndex) : null;
}

export function resolveActiveChapterId({
  activeChapterId,
  chapterById,
  chapters,
  initialChapterId
}: {
  activeChapterId: string;
  chapterById: Map<string, ChapterEntry>;
  chapters: ChapterEntry[];
  initialChapterId: string;
}) {
  if (activeChapterId && chapterById.has(activeChapterId)) {
    return activeChapterId;
  }

  if (initialChapterId && chapterById.has(initialChapterId)) {
    return initialChapterId;
  }

  return chapters[0]?.chapter.id ?? "";
}

export function getBookAuthorLabel(book: BookSummary) {
  return book.author
    ?? book.metadata.author
    ?? book.name;
}

export function getEarlyChristianBookDescription(book: BookSummary) {
  if (book.book && book.book !== book.name) {
    return book.book;
  }

  return null;
}

export function getEarlyChristianBookHeaderDetails(book: BookSummary) {
  return [
    { label: "Author", value: book.author ?? book.metadata.author ?? "" },
    { label: "Date", value: book.metadata.authorshipDateRange ?? "" },
    { label: "Source", value: book.metadata.source.title },
    { label: "Type", value: book.classification.bucket },
    { label: "Chapters", value: formatChapterCount(book.chapters.length) }
  ];
}

export function getChapterWindowRange(
  index: number,
  entries: ChapterEntry[],
  options: { after: number; before: number }
) {
  const range = getCenteredWindowRange({
    after: options.after,
    before: options.before,
    count: entries.length,
    index
  });

  return clampChapterWindowStartToBook(range, index, entries);
}

export function findChapterBookStartIndex(
  activeIndex: number,
  entries: ChapterEntry[]
) {
  const activeEntry = entries[activeIndex];

  if (!activeEntry) {
    return -1;
  }

  let bookStartIndex = activeIndex;

  while (
    bookStartIndex > 0
    && entries[bookStartIndex - 1]?.book.id === activeEntry.book.id
  ) {
    bookStartIndex -= 1;
  }

  return bookStartIndex;
}

export function dedupeBooks(chapters: ChapterEntry[]) {
  const seen = new Set<string>();
  const books: BookSummary[] = [];

  for (const entry of chapters) {
    if (seen.has(entry.book.id)) {
      continue;
    }

    seen.add(entry.book.id);
    books.push(entry.book);
  }

  return books;
}

export function formatBookOptionLabel(book: BookSummary) {
  return book.author ? `${book.name} - ${book.author}` : book.name;
}

export function getBookSearchText(book: BookSummary) {
  return [
    book.name,
    book.book,
    book.author,
    book.metadata.author,
    book.metadata.source.id,
    book.metadata.source.title,
    book.metadata.authorshipDateRange
  ].filter(Boolean).join(" ");
}

function compareBooks(
  left: BookSummary,
  right: BookSummary,
  leftIndex: number,
  rightIndex: number
) {
  const leftRank = getBookChronologyRank(left);
  const rightRank = getBookChronologyRank(right);

  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  const leftAuthor = getBookAuthorLabel(left);
  const rightAuthor = getBookAuthorLabel(right);
  const authorComparison = leftAuthor.localeCompare(rightAuthor);

  if (authorComparison !== 0) {
    return authorComparison;
  }

  const titleComparison = left.name.localeCompare(right.name);

  if (titleComparison !== 0) {
    return titleComparison;
  }

  return leftIndex - rightIndex;
}

function getBookChronologyRank(book: BookSummary) {
  if (book.id === FIRST_FATHERS_WORK_ID) {
    return 0;
  }

  const explicitWorkYear = WORK_CHRONOLOGY[book.id];

  if (explicitWorkYear) {
    return explicitWorkYear;
  }

  const normalizedAuthor = normalizeSortText(getBookAuthorLabel(book));
  const normalizedTitle = normalizeSortText(book.name);
  const knownAuthorYear = findKnownChronologyYear(normalizedAuthor)
    ?? findKnownChronologyYear(normalizedTitle);

  if (knownAuthorYear) {
    return knownAuthorYear;
  }

  return parseAuthorshipDateRange(book.metadata.authorshipDateRange) ?? 9999;
}

function findKnownChronologyYear(value: string) {
  for (const [key, year] of Object.entries(AUTHOR_CHRONOLOGY)) {
    if (value.includes(key)) {
      return year;
    }
  }

  return null;
}

function parseAuthorshipDateRange(value: string | null) {
  const normalized = normalizeSortText(value ?? "");

  if (!normalized) {
    return null;
  }

  const centuryMatch = normalized.match(/(\d+)(?:st|nd|rd|th)? century/);

  if (centuryMatch?.[1]) {
    return (Number(centuryMatch[1]) - 1) * 100 + 50;
  }

  const wordCentury = [
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth"
  ].findIndex((word) => normalized.includes(`${word} century`));

  if (wordCentury >= 0) {
    return wordCentury * 100 + 50;
  }

  const yearMatch = normalized.match(/\b([1-6]\d{2})\b/);

  if (yearMatch?.[1]) {
    return Number(yearMatch[1]);
  }

  return null;
}

function formatChapterCount(count: number) {
  return count === 1 ? "1 chapter" : `${count} chapters`;
}

function normalizeSortText(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampChapterWindowStartToBook(
  range: { endIndex: number; startIndex: number },
  activeIndex: number,
  entries: ChapterEntry[]
) {
  const bookStartIndex = findChapterBookStartIndex(activeIndex, entries);

  if (bookStartIndex < 0) {
    return range;
  }

  return {
    ...range,
    startIndex: Math.max(range.startIndex, bookStartIndex)
  };
}
