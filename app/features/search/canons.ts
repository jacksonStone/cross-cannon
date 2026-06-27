import type { CanonMode } from "./types";

export const DEFAULT_CANON: CanonMode = "protestant";
export const DEFAULT_MATCH_COUNT = 10;
export const FILTER_STORAGE_KEY = "cross-cannon:filters:v1";

const PROTESTANT_BOOKS = [
  "Genesis",
  "Exodus",
  "Leviticus",
  "Numbers",
  "Deuteronomy",
  "Joshua",
  "Judges",
  "Ruth",
  "1 Samuel",
  "2 Samuel",
  "1 Kings",
  "2 Kings",
  "1 Chronicles",
  "2 Chronicles",
  "Ezra",
  "Nehemiah",
  "Esther",
  "Job",
  "Psalms",
  "Proverbs",
  "Ecclesiastes",
  "Song of Songs",
  "Isaiah",
  "Jeremiah",
  "Lamentations",
  "Ezekiel",
  "Daniel",
  "Hosea",
  "Joel",
  "Amos",
  "Obadiah",
  "Jonah",
  "Micah",
  "Nahum",
  "Habakkuk",
  "Zephaniah",
  "Haggai",
  "Zechariah",
  "Malachi",
  "Matthew",
  "Mark",
  "Luke",
  "John",
  "Acts",
  "Romans",
  "1 Corinthians",
  "2 Corinthians",
  "Galatians",
  "Ephesians",
  "Philippians",
  "Colossians",
  "1 Thessalonians",
  "2 Thessalonians",
  "1 Timothy",
  "2 Timothy",
  "Titus",
  "Philemon",
  "Hebrews",
  "James",
  "1 Peter",
  "2 Peter",
  "1 John",
  "2 John",
  "3 John",
  "Jude",
  "Revelation"
];

const CATHOLIC_DEUTEROCANONICAL_BOOKS = [
  "Tobit",
  "Judith",
  "Wisdom",
  "Sirach",
  "Baruch",
  "Daniel (Greek)",
  "Esther (Greek)",
  "1 Maccabees",
  "2 Maccabees"
];

const CATHOLIC_BOOKS = [
  ...PROTESTANT_BOOKS,
  ...CATHOLIC_DEUTEROCANONICAL_BOOKS
];

const ORTHODOX_ADDITIONAL_BOOKS = [
  "1 Esdras",
  "2 Esdras",
  "Prayer of Manasseh",
  "Psalm 151",
  "3 Maccabees",
  "4 Maccabees"
];

const ORTHODOX_BOOKS = [
  ...CATHOLIC_BOOKS,
  ...ORTHODOX_ADDITIONAL_BOOKS
];

const CANONICAL_BOOK_ORDER = new Map(
  [
    "Genesis",
    "Exodus",
    "Leviticus",
    "Numbers",
    "Deuteronomy",
    "Joshua",
    "Judges",
    "Ruth",
    "1 Samuel",
    "2 Samuel",
    "1 Kings",
    "2 Kings",
    "1 Chronicles",
    "2 Chronicles",
    "1 Esdras",
    "2 Esdras",
    "Ezra",
    "Nehemiah",
    "Tobit",
    "Judith",
    "Esther",
    "Esther (Greek)",
    "1 Maccabees",
    "2 Maccabees",
    "3 Maccabees",
    "4 Maccabees",
    "Job",
    "Psalms",
    "Psalm 151",
    "Proverbs",
    "Ecclesiastes",
    "Song of Songs",
    "Wisdom",
    "Sirach",
    "Prayer of Manasseh",
    "Isaiah",
    "Jeremiah",
    "Lamentations",
    "Baruch",
    "Ezekiel",
    "Daniel",
    "Daniel (Greek)",
    ...PROTESTANT_BOOKS.slice(PROTESTANT_BOOKS.indexOf("Hosea"))
  ].map((book, index) => [book, index])
);

export const BOOKS_BY_CANON = {
  protestant: new Set(PROTESTANT_BOOKS),
  catholic: new Set(CATHOLIC_BOOKS),
  orthodox: new Set(ORTHODOX_BOOKS)
} satisfies Record<CanonMode, Set<string>>;

export function parseCanonMode(value: string): CanonMode {
  if (value === "catholic" || value === "orthodox") {
    return value;
  }

  return DEFAULT_CANON;
}

export function sortCanonicalBooks(books: string[]) {
  return [...books].sort((left, right) => {
    const leftOrder = CANONICAL_BOOK_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = CANONICAL_BOOK_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return left.localeCompare(right);
  });
}
