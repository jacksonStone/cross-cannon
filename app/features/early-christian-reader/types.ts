export type { ChurchFathersActionData } from "~/features/search/types";

export type WorkClassification = {
  bucket: string;
  canonicalStatus: string;
  contentKind: string;
  cautionReason: string;
  doctrinalStatus: string;
  labels: string[];
  severity: number;
};

export type SourceMetadata = {
  id: string;
  provider: string;
  sourceUrl: string;
  title: string;
};

export type WorkMetadata = {
  author: string | null;
  authorshipDateRange: string | null;
  ccel?: {
    id: string;
    sourceUrl: string;
    title: string;
  };
  source: SourceMetadata;
  genre?: "Commentaries" | "Theology" | "Spiritual Reading";
  tradition?: string;
  translator?: string;
  edition?: string;
  rights?: string;
};

export type EarlyChristianAudio = {
  confidence?: number;
  endSeconds?: number;
  label: string;
  startSeconds: number;
  url: string;
};

export type ChapterSummary = {
  assetPath: string;
  audio?: EarlyChristianAudio;
  chapter: number;
  id: string;
  title: string;
  verseCount: number;
  reference?: string;
  scriptureReference?: { book: string; chapter: number };
};

export type BookSummary = {
  author: string | null;
  book: string;
  chapters: ChapterSummary[];
  classification: WorkClassification;
  id: string;
  metadata: WorkMetadata;
  name: string;
};

export type BookIndex = {
  defaultWorkId?: string;
  books: BookSummary[];
  generatedAt: string;
  source: string;
};

export type PreviewManifest = {
  bookCount: number;
  bookIndexPath: string;
  chapterCount: number;
  generatedAt: string;
  source: string;
};

export type ChapterAsset = {
  author: string | null;
  book: string;
  chapter: number;
  classification: WorkClassification;
  id: string;
  lineage: string[];
  metadata: WorkMetadata;
  originalBook: string | null;
  sourceVolumeId: string;
  title: string;
  reference?: string;
  scriptureReference?: { book: string; chapter: number };
  notes?: Array<{ id: string; text: string }>;
  source: {
    id: string;
    sourceUrl: string;
    title: string;
  };
  verses: Array<{
    book: string;
    chapter: number;
    modernizedText?: string;
    verse: number;
    text: string;
    scriptureVerseStart?: number;
    scriptureVerseEnd?: number;
    sourceParagraph?: number;
  }>;
};

export type ChapterEntry = {
  book: BookSummary;
  chapter: ChapterSummary;
  index: number;
};

export type ChapterAssetLoadResult =
  | {
    asset: ChapterAsset;
    entry: ChapterEntry;
  }
  | {
    entry: ChapterEntry;
    error: string;
  };
