import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from "react";

import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";

import {
  type EarlyChristianReaderTextMode as ReaderTextMode,
  type EarlyChristianReaderPassage as ReaderPassage,
  findLoadedPassage,
  findPassageTargetInChapter,
  groupChapterPassages,
  isSelectedReaderPassage,
  renderReaderPassageText
} from "~/features/early-christian-reader/reader-passages";
import {
  ReaderCorpusSwitch,
  rememberReaderCorpus
} from "~/features/reader-switch/ReaderCorpusSwitch";
import {
  createReaderLocation,
  readReaderLocation,
  readReaderPosition,
  readerLocationKey,
  rememberReaderLocation
} from "~/features/reader-position/reader-position";
import {
  EARLY_CHRISTIAN_MANIFEST_URL,
  EARLY_CHRISTIAN_PREVIEW_ASSET_VERSION,
  EARLY_CHRISTIAN_READER_POSITION_STORAGE_KEY,
  FIRST_FATHERS_WORK_ID,
  getCachedPreviewJson,
  getCachedPreviewJsonEntries,
  loadPreviewJson,
  rememberCachedPreviewJson
} from "~/features/early-christian-preview/preview-cache";
import { ReaderBookHeader } from "~/features/passage-reader/BookHeader";
import {
  DEFAULT_READER_SCROLL_WINDOW,
  useAnchoredReaderWindow,
  useReaderHeaderOffset
} from "~/features/reader-window/useReaderWindow";
import {
  getCenteredWindowRange
} from "~/features/reader-window/window-range";
import {
  BOOKS_BY_CANON,
  DEFAULT_CANON,
  DEFAULT_MATCH_COUNT,
  parseCanonMode
} from "~/features/search/canons";
import {
  readerSettingsStyle
} from "~/features/reader-settings/reader-settings";
import {
  ReaderPassageArticle,
  ReaderSettingsControl,
  ReaderTools,
  useStoredReaderSettings
} from "~/features/reader-ui/ReaderControls";
import { FilterModal } from "~/features/search/FilterModal";
import { keywordMatches } from "~/features/search/keyword-match";
import { withCalibratedMatchStrength } from "~/features/search/match-strength";
import {
  initialSearchModalFlowState,
  searchModalFlowReducer
} from "~/features/search/search-modal-flow";
import { SearchResults } from "~/features/search/SearchResults";
import { SearchTargetControl } from "~/features/search/SearchTargetControl";
import type {
  CanonMode,
  SearchActionData,
  SearchResult,
  SearchTargetCorpus
} from "~/features/search/types";
import { useScriptureLibrary } from "~/features/scripture/useScriptureLibrary";
import { searchScriptureSimilarToFathers } from "~/lib/cross-corpus-search.server";
import {
  getEarlyChristianAuthors,
  parseEarlyChristianAuthorFilters,
  searchEarlyChristianWorks,
  searchSimilarEarlyChristianPassages,
  type EarlyChristianSearchResult,
  type EarlyChristianSimilarSource
} from "~/lib/early-christian-search.server";
import { getClientIp, rateLimit } from "~/lib/rate-limit.server";
import { getScriptureCacheInfo } from "~/lib/scripture-cache.server";
import { searchScripture } from "~/lib/search.server";
import {
  isBackdropClick,
  useEscapeDismiss
} from "~/lib/use-dialog-dismiss";
import { useModalScrollLock } from "~/lib/use-modal-scroll-lock";

const CONFESSIONS_AUDIO_ALIGNMENT_URL =
  "/church-fathers-preview/confessions-audio-alignment.json";
const MANIFEST_URL = EARLY_CHRISTIAN_MANIFEST_URL;
const PREVIEW_ASSET_VERSION = EARLY_CHRISTIAN_PREVIEW_ASSET_VERSION;
const READER_POSITION_STORAGE_KEY = EARLY_CHRISTIAN_READER_POSITION_STORAGE_KEY;
const CHAPTER_WINDOW_BEFORE = DEFAULT_READER_SCROLL_WINDOW.initialBefore;
const CHAPTER_WINDOW_AFTER = DEFAULT_READER_SCROLL_WINDOW.initialAfter;
const CHAPTER_ASSET_LOAD_CONCURRENCY = 4;
const INITIAL_SCROLL_MAX_FRAMES = DEFAULT_READER_SCROLL_WINDOW.initialScrollMaxFrames;
const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
const SEARCH_EXAMPLES = [
  "repentance and mercy",
  "the resurrection of the body",
  "patience in suffering",
  "the unity of the church",
  "the incarnation",
  "prayer and fasting"
];
const MAX_AUTHOR_FILTERS = 3;
const CONFESSIONS_BOOK_ID = "npnf101:vi";
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
const CONFESSIONS_AUDIO_BASE_URL =
  "https://archive.org/download/confessions_augustine_0911_librivox";
const CONFESSIONS_AUDIO_TRACKS = [
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

type WorkClassification = {
  bucket: string;
  canonicalStatus: string;
  contentKind: string;
  cautionReason: string;
  doctrinalStatus: string;
  labels: string[];
  severity: number;
};

type SourceMetadata = {
  id: string;
  provider: string;
  sourceUrl: string;
  title: string;
};

type WorkMetadata = {
  author: string | null;
  authorshipDateRange: string | null;
  ccel: {
    id: string;
    sourceUrl: string;
    title: string;
  };
  source: SourceMetadata;
};

type ChapterSummary = {
  assetPath: string;
  chapter: number;
  id: string;
  title: string;
  verseCount: number;
};

type BookSummary = {
  author: string | null;
  book: string;
  chapters: ChapterSummary[];
  classification: WorkClassification;
  id: string;
  metadata: WorkMetadata;
  name: string;
};

type BookIndex = {
  books: BookSummary[];
  generatedAt: string;
  source: string;
};

let knownPreviewChapterIdsPromise: Promise<Set<string>> | null = null;

type PreviewManifest = {
  bookCount: number;
  bookIndexPath: string;
  chapterCount: number;
  generatedAt: string;
  source: string;
};

type ChapterAsset = {
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
  }>;
};

type ChapterEntry = {
  book: BookSummary;
  chapter: ChapterSummary;
  index: number;
};

type ChapterAssetLoadResult =
  | {
    asset: ChapterAsset;
    entry: ChapterEntry;
  }
  | {
    entry: ChapterEntry;
    error: string;
  };

type ChurchFathersActionData = {
  authors?: string[];
  books?: string[];
  canon?: CanonMode;
  error?: string;
  matchCount?: number;
  mode?: "theme" | "theme-scripture" | "similar" | "similar-scripture";
  question?: string;
  results?: EarlyChristianSearchResult[];
  retryAfterSeconds?: number;
  similarSource?: EarlyChristianSimilarSource;
  similarScriptureSource?: EarlyChristianSimilarSource;
  scriptureResults?: SearchResult[];
  targetCorpus?: SearchTargetCorpus;
};

type ConfessionsAudioAlignment = {
  chapters: Record<string, {
    audioUrl: string;
    confidence?: number;
    endSeconds?: number;
    label: string;
    startSeconds: number;
  }>;
  generatedAt?: string | null;
  source?: string;
};

export const meta: MetaFunction = () => [
  { title: "Early Christian Reader | Cross Canon" },
  {
    name: "description",
    content: "Read and search early Christian works in chapter context."
  }
];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const authorOptionsPromise: Promise<string[]> = getEarlyChristianAuthors()
    .catch(() => []);
  const [authorOptions, scriptureCache] = await Promise.all([
    authorOptionsPromise,
    getScriptureCacheInfo()
  ]);
  const requestedChapterId = url.searchParams.get("chapter") ?? "";
  const initialChapterId = requestedChapterId && await isKnownPreviewChapterId(requestedChapterId)
    ? requestedChapterId
    : "";

  return json({
    authorOptions,
    initialChapterId,
    initialPassageRange: initialChapterId ? url.searchParams.get("passage") ?? "" : "",
    manifestUrl: MANIFEST_URL,
    previewAssetVersion: PREVIEW_ASSET_VERSION,
    scriptureCacheKey: scriptureCache.version,
    scriptureCacheUrl: scriptureCache.url
  });
}

async function isKnownPreviewChapterId(chapterId: string) {
  knownPreviewChapterIdsPromise ??= readKnownPreviewChapterIds();
  return (await knownPreviewChapterIdsPromise).has(chapterId);
}

async function readKnownPreviewChapterIds() {
  const [{ readFile }, path] = await Promise.all([
    import("node:fs/promises"),
    import("node:path")
  ]);
  const bookIndexPath = path.resolve(
    process.cwd(),
    "public/church-fathers-preview/books.json"
  );
  const bookIndex = JSON.parse(await readFile(bookIndexPath, "utf8")) as BookIndex;
  const chapterIds = new Set<string>();

  for (const book of bookIndex.books) {
    for (const chapter of book.chapters) {
      chapterIds.add(chapter.id);
    }
  }

  return chapterIds;
}

export async function action({ request }: ActionFunctionArgs) {
  const ip = getClientIp(request);
  const limit = rateLimit(ip);

  if (!limit.allowed) {
    return json<ChurchFathersActionData>(
      {
        error: "Rate limit reached. Try again in a moment.",
        retryAfterSeconds: limit.retryAfterSeconds
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(limit.retryAfterSeconds)
        }
      }
    );
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "theme");
  const matchCount = parseMatchCount(formData);
  const authorFilters = await parseEarlyChristianAuthorFilters(
    formData.getAll("authors")
  );

  if ("response" in matchCount) {
    return matchCount.response;
  }

  if ("error" in authorFilters) {
    return json<ChurchFathersActionData>(
      { error: authorFilters.error },
      { status: 400 }
    );
  }

  if (intent === "similar-passage") {
    const sourcePassageId = String(formData.get("sourcePassageId") ?? "").trim();
    const similar = await searchSimilarEarlyChristianPassages(
      sourcePassageId,
      matchCount.value,
      authorFilters.authors
    );

    if (!similar) {
      return json<ChurchFathersActionData>(
        { error: "Choose an indexed passage to search from." },
        { status: 400 }
      );
    }

    return json<ChurchFathersActionData>({
      authors: authorFilters.authors,
      matchCount: matchCount.value,
      mode: "similar",
      results: similar.results,
      similarSource: similar.source,
      targetCorpus: "early-christian"
    });
  }

  if (intent === "similar-scripture") {
    const scriptureFilters = parseChurchFathersScriptureFilters(formData);

    if ("response" in scriptureFilters) {
      return scriptureFilters.response;
    }

    const sourcePassageId = String(formData.get("sourcePassageId") ?? "").trim();
    const similar = await searchScriptureSimilarToFathers(
      sourcePassageId,
      matchCount.value,
      scriptureFilters.searchBooks
    );

    if (!similar) {
      return json<ChurchFathersActionData>(
        { error: "Choose an indexed passage to search from." },
        { status: 400 }
      );
    }

    return json<ChurchFathersActionData>({
      books: scriptureFilters.books,
      canon: scriptureFilters.canon,
      matchCount: matchCount.value,
      mode: "similar-scripture",
      scriptureResults: withScriptureMatchStrength(similar.results),
      similarScriptureSource: similar.source,
      targetCorpus: "scripture"
    });
  }

  if (intent === "theme-scripture") {
    const scriptureFilters = parseChurchFathersScriptureFilters(formData);

    if ("response" in scriptureFilters) {
      return scriptureFilters.response;
    }

    const question = String(formData.get("question") ?? "").trim();

    if (question.length < 3) {
      return json<ChurchFathersActionData>(
        { error: "Enter a longer question." },
        { status: 400 }
      );
    }

    if (question.length > 500) {
      return json<ChurchFathersActionData>(
        { error: "Keep the question under 500 characters." },
        { status: 400 }
      );
    }

    const results = await searchScripture(
      question,
      matchCount.value,
      scriptureFilters.searchBooks
    );

    return json<ChurchFathersActionData>({
      books: scriptureFilters.books,
      canon: scriptureFilters.canon,
      matchCount: matchCount.value,
      mode: "theme-scripture",
      question,
      scriptureResults: withScriptureMatchStrength(results),
      targetCorpus: "scripture"
    });
  }

  const question = String(formData.get("question") ?? "").trim();

  if (question.length < 3) {
    return json<ChurchFathersActionData>(
      { error: "Enter a longer question." },
      { status: 400 }
    );
  }

  if (question.length > 500) {
    return json<ChurchFathersActionData>(
      { error: "Keep the question under 500 characters." },
      { status: 400 }
    );
  }

  return json<ChurchFathersActionData>({
    authors: authorFilters.authors,
    matchCount: matchCount.value,
    mode: "theme",
    question,
    results: await searchEarlyChristianWorks(
      question,
      matchCount.value,
      authorFilters.authors
    ),
    targetCorpus: "early-christian"
  });
}

function parseChurchFathersScriptureFilters(formData: FormData):
  | {
    books: string[];
    canon: CanonMode;
    searchBooks: string[];
  }
  | { response: ReturnType<typeof json<ChurchFathersActionData>> } {
  const canon = parseCanonMode(String(formData.get("canon") ?? ""));
  const canonBooks = BOOKS_BY_CANON[canon];
  const selectedBooks = formData
    .getAll("books")
    .map((value) => String(value).trim())
    .filter(Boolean);
  const books = Array.from(new Set(selectedBooks))
    .filter((book) => canonBooks.has(book));

  if (selectedBooks.length > 0 && books.length === 0) {
    return {
      response: json<ChurchFathersActionData>(
        { error: "Choose at least one book in the selected canon." },
        { status: 400 }
      )
    };
  }

  return {
    books,
    canon,
    searchBooks: books.length > 0 ? books : Array.from(canonBooks)
  };
}

export default function ChurchFathersReaderRoute() {
  const {
    authorOptions,
    initialChapterId,
    initialPassageRange,
    manifestUrl,
    previewAssetVersion,
    scriptureCacheKey,
    scriptureCacheUrl
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [manifest, setManifest] = useState<PreviewManifest | null>(() => (
    getCachedPreviewJson<PreviewManifest>(manifestUrl, previewAssetVersion) ?? null
  ));
  const [bookIndex, setBookIndex] = useState<BookIndex | null>(() => (
    readCachedBookIndex(manifestUrl, previewAssetVersion)
  ));
  const [confessionsAudioAlignment, setConfessionsAudioAlignment] =
    useState<ConfessionsAudioAlignment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedChapters, setLoadedChapters] = useState<Map<string, ChapterAsset>>(() => (
    getCachedChapterAssets(previewAssetVersion)
  ));
  const [chapterLoadErrors, setChapterLoadErrors] = useState<Map<string, string>>(() => new Map());
  const savedReaderLocation = readReaderLocation(READER_POSITION_STORAGE_KEY, "fathers");
  const initialStoredChapterId =
    savedReaderLocation?.chapterKey ?? readReaderPosition(READER_POSITION_STORAGE_KEY);
  const initialStoredPassageRange = savedReaderLocation?.passageRange ?? "";
  const initialActiveChapterId = initialChapterId || initialStoredChapterId;
  const initialSelectedPassage = initialPassageRange || (
    initialChapterId ? "" : initialStoredPassageRange
  );
  const savedReaderPositionRef = useRef(readerLocationKey(savedReaderLocation));
  const [activeChapterId, setActiveChapterId] = useState(() => (
    initialActiveChapterId
  ));
  const [targetChapterId, setTargetChapterId] = useState(() => initialActiveChapterId);
  const [targetPassageRange, setTargetPassageRange] = useState(initialSelectedPassage);
  const [selectedPassage, setSelectedPassage] = useState(initialSelectedPassage);
  const [selectedPassageChapterId, setSelectedPassageChapterId] = useState(
    initialSelectedPassage ? initialActiveChapterId : ""
  );
  const [searchFlow, dispatchSearchFlow] = useReducer(
    searchModalFlowReducer,
    initialSearchModalFlowState
  );
  const { readerSettings, setReaderSettings } = useStoredReaderSettings();
  const readerTheme = readerSettings.theme;
  const readerStyles = readerSettingsStyle(readerSettings);
  const readerHeaderOffset = useReaderHeaderOffset();
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [isJumpOpen, setIsJumpOpen] = useState(false);
  const [isAuthorFilterOpen, setIsAuthorFilterOpen] = useState(false);
  const [readerTextMode, setReaderTextMode] = useState<ReaderTextMode>("modernized");
  const [themeCorpus, setThemeCorpus] = useState<SearchTargetCorpus>("early-christian");
  const [canon, setCanon] = useState<CanonMode>(actionData?.canon ?? DEFAULT_CANON);
  const [matchCount, setMatchCount] = useState(actionData?.matchCount ?? DEFAULT_MATCH_COUNT);
  const [selectedScriptureBooks, setSelectedScriptureBooks] = useState<string[]>(
    () => actionData?.books ?? []
  );
  const [selectedAuthors, setSelectedAuthors] = useState<string[]>(() => (
    actionData?.authors ?? []
  ));
  const [exampleIndex, setExampleIndex] = useState(0);
  const [playingAudioKey, setPlayingAudioKey] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const headerTitleRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef(true);
  const lastAppliedInitialTargetRef = useRef("");
  const lastReportedChapterIdRef = useRef(savedReaderPositionRef.current);
  const loadingChapterIdsRef = useRef<Set<string>>(new Set());
  const playingAudioEndSecondsRef = useRef<number | null>(null);
  const readerTitleRef = useRef<HTMLHeadingElement | null>(null);

  const scriptureLibrary = useScriptureLibrary({
    scriptureCacheUrl
  });

  const chapters = useMemo(() => flattenChapters(bookIndex), [bookIndex]);
  const chapterById = useMemo(
    () => new Map(chapters.map((entry) => [entry.chapter.id, entry])),
    [chapters]
  );
  const resolvedActiveChapterId = useMemo(() => (
    resolveActiveChapterId({
      activeChapterId,
      chapterById,
      chapters,
      initialChapterId
    })
  ), [activeChapterId, chapterById, chapters, initialChapterId]);
  const activeEntry = resolvedActiveChapterId
    ? chapterById.get(resolvedActiveChapterId)
    : undefined;
  const resolvedTargetChapterId = targetChapterId && chapterById.has(targetChapterId)
    ? targetChapterId
    : resolvedActiveChapterId;
  const targetEntry = resolvedTargetChapterId
    ? chapterById.get(resolvedTargetChapterId)
    : undefined;
  const targetChapterIndex = targetEntry?.index;
  const initialWindowRange = useMemo(
    () => typeof targetChapterIndex === "number"
      ? getChapterWindowRange(targetChapterIndex, chapters)
      : { endIndex: -1, startIndex: 0 },
    [chapters, targetChapterIndex]
  );
  const readerWindowResetKey = `${resolvedTargetChapterId}|${targetPassageRange}`;
  const targetWindowEntries = useMemo(
    () => initialWindowRange.endIndex >= initialWindowRange.startIndex
      ? chapters.slice(
        Math.max(0, initialWindowRange.startIndex),
        initialWindowRange.endIndex + 1
      )
      : [],
    [chapters, initialWindowRange.endIndex, initialWindowRange.startIndex]
  );
  const isReady = Boolean(bookIndex && activeEntry);
  const activeChapterIndex = activeEntry?.index;
  const activeBookStartIndex = findChapterBookStartIndex(activeChapterIndex ?? -1, chapters);
  const selectedRangeForTargetChapter =
    selectedPassageChapterId === resolvedTargetChapterId ? selectedPassage : targetPassageRange;
  const isTargetWindowReady = Boolean(
    resolvedTargetChapterId
    && typeof targetChapterIndex === "number"
    && targetWindowEntries.some((entry) => entry.chapter.id === resolvedTargetChapterId)
    && targetWindowEntries.every((entry) => (
      entry.index > targetChapterIndex || loadedChapters.has(entry.chapter.id)
    ))
  );
  const focusedPassageKey = searchFlow.focusedId;
  const isSearchOpen = searchFlow.isOpen;
  const closeSearch = useCallback(() => {
    setIsAuthorFilterOpen(false);
    dispatchSearchFlow({ type: "close" });
  }, []);
  const openSearch = useCallback(() => dispatchSearchFlow({ type: "open" }), []);
  const setFocusedPassageKey = useCallback((focusedId: string | null) => {
    dispatchSearchFlow({
      focusedId,
      type: "set-focused"
    });
  }, []);
  const rememberReaderChapter = useCallback((chapterId: string, passageRange = "") => {
    rememberReaderLocation(READER_POSITION_STORAGE_KEY, createReaderLocation({
      chapterKey: chapterId,
      corpus: "fathers",
      passageRange: passageRange || undefined
    }), {
      lastReportedRef: lastReportedChapterIdRef,
      savedRef: savedReaderPositionRef
    });
  }, []);

  useModalScrollLock(isSearchOpen || isJumpOpen || isAuthorFilterOpen);
  const focusedPassage = focusedPassageKey
    ? findLoadedPassage(loadedChapters, focusedPassageKey, readerTextMode)
    : null;
  const activeAudio = activeEntry
    ? getEarlyChristianAudio(activeEntry, confessionsAudioAlignment)
    : null;
  const activeAudioUrl = activeAudio?.url ?? null;
  const activeAudioKey = activeAudio
    ? `${activeAudio.url}#${activeAudio.startSeconds ?? 0}`
    : null;
  const activeChapterHasModernizedText = Boolean(
    resolvedActiveChapterId
    && loadedChapters.get(resolvedActiveChapterId)?.verses.some((verse) => (
      Boolean(verse.modernizedText?.trim())
    ))
  );
  const isActiveChapterPlaying = Boolean(
    activeAudioKey && playingAudioKey === activeAudioKey
  );
  const isSearching = navigation.state === "submitting";
  const isFindingSimilarFathers = isSearching
    && navigation.formData?.get("intent") === "similar-passage";
  const activeHeaderTitle = activeEntry
    ? `${activeEntry.book.name} ${activeEntry.chapter.chapter}`
    : "";
  const selectedAuthorFilters = useMemo(() => {
    const knownAuthors = new Set(authorOptions);
    return selectedAuthors
      .filter((author) => knownAuthors.has(author))
      .slice(0, MAX_AUTHOR_FILTERS);
  }, [authorOptions, selectedAuthors]);
  const showScriptureFilters = themeCorpus === "scripture";
  const showAuthorFilters = themeCorpus === "early-christian";
  const visibleScriptureBooks = useMemo(
    () => Array.from(BOOKS_BY_CANON[canon]),
    [canon]
  );
  const selectedBooksForCanon = useMemo(
    () => selectedScriptureBooks.filter((book) => BOOKS_BY_CANON[canon].has(book)),
    [canon, selectedScriptureBooks]
  );
  const searchIntent = focusedPassageKey
    ? themeCorpus === "scripture" ? "similar-scripture" : "similar-passage"
    : themeCorpus === "scripture" ? "theme-scripture" : "theme";
  const activeFilterCount = (matchCount === DEFAULT_MATCH_COUNT ? 0 : 1)
    + (showScriptureFilters ? selectedBooksForCanon.length : 0)
    + (showAuthorFilters ? selectedAuthorFilters.length : 0);
  const findInitialChapterTarget = useCallback(() => {
    if (!resolvedTargetChapterId) {
      return null;
    }

    const chapterElement = document.querySelector<HTMLElement>(
      `[data-chapter-id="${cssEscape(resolvedTargetChapterId)}"]`
    );

    if (!chapterElement || !selectedRangeForTargetChapter) {
      return chapterElement;
    }

    return findPassageTargetInChapter(
      chapterElement,
      selectedRangeForTargetChapter
    ) ?? chapterElement;
  }, [resolvedTargetChapterId, selectedRangeForTargetChapter]);
  const updateActiveChapterFromScroll = useCallback((chapterId: string) => {
    rememberReaderChapter(chapterId);
    setActiveChapterId(chapterId);
  }, [rememberReaderChapter]);
  const getRenderedChapterId = useCallback((element: HTMLElement) => (
    element.dataset.chapterId
  ), []);
  const resetReaderWindow = useCallback(() => {
    setSelectedPassage(targetPassageRange);
    setSelectedPassageChapterId(targetPassageRange && resolvedTargetChapterId
      ? resolvedTargetChapterId
      : "");
  }, [resolvedTargetChapterId, targetPassageRange]);
  const { renderedRange, setRenderedRange } = useAnchoredReaderWindow({
    activeKey: resolvedActiveChapterId,
    chapterSelector: ".ec-reader-chapter",
    edgePx: DEFAULT_READER_SCROLL_WINDOW.edgePx,
    expandCount: DEFAULT_READER_SCROLL_WINDOW.expandCount,
    findInitialTarget: findInitialChapterTarget,
    getChapterKey: getRenderedChapterId,
    headerOffset: readerHeaderOffset,
    initialActiveKey: resolvedTargetChapterId,
    initialRange: initialWindowRange,
    initialScrollMaxFrames: INITIAL_SCROLL_MAX_FRAMES,
    initialScrollReady: isReady && isTargetWindowReady,
    itemCount: chapters.length,
    minStartIndex: activeBookStartIndex,
    minReadingAnchorOffset: DEFAULT_READER_SCROLL_WINDOW.minReadingAnchorOffset,
    onActiveKeyChange: updateActiveChapterFromScroll,
    onReset: resetReaderWindow,
    passageSelector: ".ec-reader-chapter .reader-passage",
    readingAnchorRatio: DEFAULT_READER_SCROLL_WINDOW.readingAnchorRatio,
    resetKey: readerWindowResetKey,
    trackingReady: isReady,
    windowReady: isReady
  });
  const renderedEntries = useMemo(
    () => renderedRange.endIndex >= renderedRange.startIndex
      ? chapters.slice(
        Math.max(0, renderedRange.startIndex),
        renderedRange.endIndex + 1
      )
      : [],
    [chapters, renderedRange.endIndex, renderedRange.startIndex]
  );
  const toggleSelectedBook = useCallback((book: string) => {
    if (!BOOKS_BY_CANON[canon].has(book)) {
      return;
    }

    setSelectedScriptureBooks((currentBooks) => (
      currentBooks.includes(book)
        ? currentBooks.filter((selectedBook) => selectedBook !== book)
        : [...currentBooks, book]
    ));
  }, [canon]);
  const updateCanon = useCallback((nextCanon: CanonMode) => {
    setCanon(nextCanon);
    setSelectedScriptureBooks((currentBooks) => (
      currentBooks.filter((book) => BOOKS_BY_CANON[nextCanon].has(book))
    ));
  }, []);
  const toggleSelectedAuthor = useCallback((author: string) => {
    if (!authorOptions.includes(author)) {
      return;
    }

    setSelectedAuthors((currentAuthors) => {
      if (currentAuthors.includes(author)) {
        return currentAuthors.filter((selectedAuthor) => selectedAuthor !== author);
      }

      if (currentAuthors.length >= MAX_AUTHOR_FILTERS) {
        return currentAuthors;
      }

      return [...currentAuthors, author];
    });
  }, [authorOptions]);
  const clearAuthorFilters = useCallback(() => {
    setMatchCount(DEFAULT_MATCH_COUNT);
    setSelectedScriptureBooks([]);
    setSelectedAuthors([]);
  }, []);

  const toggleActiveChapterAudio = useCallback(() => {
    const audio = audioRef.current;

    if (!audio || !activeAudio || !activeAudioKey || !activeAudioUrl) {
      return;
    }

    if (isActiveChapterPlaying) {
      audio.pause();
      playingAudioEndSecondsRef.current = null;
      setPlayingAudioKey(null);
      return;
    }

    audio.src = activeAudioUrl;
    audio.load();
    playingAudioEndSecondsRef.current = activeAudio.endSeconds ?? null;

    const playFromOffset = () => {
      try {
        audio.currentTime = Math.max(0, activeAudio.startSeconds ?? 0);
      } catch {
        // Some browsers reject seeking until enough metadata is available.
      }

      void audio.play()
        .then(() => setPlayingAudioKey(activeAudioKey))
        .catch(() => {
          playingAudioEndSecondsRef.current = null;
          setPlayingAudioKey(null);
        });
    };

    if (audio.readyState >= 1) {
      playFromOffset();
    } else {
      audio.addEventListener("loadedmetadata", playFromOffset, { once: true });
    }
  }, [activeAudio, activeAudioKey, activeAudioUrl, isActiveChapterPlaying]);

  useEffect(() => {
    if (actionData?.authors) {
      setSelectedAuthors(actionData.authors);
    }

    if (actionData?.books) {
      setSelectedScriptureBooks(actionData.books);
    }

    if (actionData?.canon) {
      setCanon(actionData.canon);
    }

    if (typeof actionData?.matchCount === "number") {
      setMatchCount(actionData.matchCount);
    }

    if (actionData?.targetCorpus) {
      setThemeCorpus(actionData.targetCorpus);
    } else if (actionData?.mode === "theme-scripture") {
      setThemeCorpus("scripture");
    } else if (actionData?.mode === "theme") {
      setThemeCorpus("early-christian");
    }
  }, [
    actionData?.authors,
    actionData?.books,
    actionData?.canon,
    actionData?.matchCount,
    actionData?.mode,
    actionData?.targetCorpus
  ]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    rememberReaderCorpus("fathers");
  }, []);

  useBrowserLayoutEffect(() => {
    const container = headerTitleRef.current;
    const title = readerTitleRef.current;

    if (!container || !title) {
      return;
    }

    let frameId = 0;
    const fitTitle = () => {
      title.style.fontSize = "";

      const availableWidth = container.clientWidth;

      if (availableWidth <= 0) {
        return;
      }

      const baseFontSize = Number.parseFloat(window.getComputedStyle(title).fontSize);
      const naturalWidth = title.scrollWidth;

      if (!Number.isFinite(baseFontSize) || baseFontSize <= 0 || naturalWidth <= 0) {
        return;
      }

      const fitScale = Math.min(1, Math.max(0.28, (availableWidth - 2) / naturalWidth));
      title.style.fontSize = `${baseFontSize * fitScale}px`;
    };
    const scheduleFit = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(fitTitle);
    };
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleFit);

    scheduleFit();
    resizeObserver?.observe(container);
    window.addEventListener("resize", scheduleFit);
    void document.fonts?.ready.then(scheduleFit).catch(() => undefined);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleFit);
      title.style.fontSize = "";
    };
  }, [activeHeaderTitle]);

  useEffect(() => {
    let ignore = false;

    loadPreviewJson<ConfessionsAudioAlignment>(
      CONFESSIONS_AUDIO_ALIGNMENT_URL,
      previewAssetVersion
    )
      .then((alignment) => {
        if (!ignore) {
          setConfessionsAudioAlignment(alignment);
        }
      })
      .catch(() => {
        if (!ignore) {
          setConfessionsAudioAlignment(null);
        }
      });

    return () => {
      ignore = true;
    };
  }, [previewAssetVersion]);

  useEffect(() => {
    let ignore = false;

    loadPreviewJson<PreviewManifest>(manifestUrl, previewAssetVersion)
      .then((loadedManifest) => {
        if (!ignore) {
          setLoadError(null);
          setManifest(loadedManifest);
        }
      })
      .catch((error: unknown) => {
        if (!ignore) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      ignore = true;
    };
  }, [manifestUrl, previewAssetVersion]);

  useEffect(() => {
    if (!manifest) {
      return;
    }

    let ignore = false;

    loadPreviewJson<BookIndex>(manifest.bookIndexPath, previewAssetVersion)
      .then((loadedIndex) => {
        if (!ignore) {
          const sortedIndex = sortBookIndex(loadedIndex);
          rememberCachedPreviewJson(manifest.bookIndexPath, previewAssetVersion, sortedIndex);
          setLoadError(null);
          setBookIndex(sortedIndex);
        }
      })
      .catch((error: unknown) => {
        if (!ignore) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      ignore = true;
    };
  }, [manifest?.bookIndexPath, previewAssetVersion]);

  useBrowserLayoutEffect(() => {
    if (!bookIndex) {
      return;
    }

    if (resolvedActiveChapterId && chapterById.has(resolvedActiveChapterId)) {
      if (activeChapterId !== resolvedActiveChapterId) {
        setActiveChapterId(resolvedActiveChapterId);
        setTargetChapterId(resolvedActiveChapterId);
        setTargetPassageRange("");
        setSelectedPassage("");
        setSelectedPassageChapterId("");
        rememberReaderChapter(resolvedActiveChapterId);
      }

      return;
    }
  }, [
    activeChapterId,
    bookIndex,
    chapterById,
    chapters.length,
    rememberReaderChapter,
    resolvedActiveChapterId
  ]);

  useBrowserLayoutEffect(() => {
    if (!bookIndex || !initialChapterId || !chapterById.has(initialChapterId)) {
      return;
    }

    const initialTargetKey = `${initialChapterId}|${initialPassageRange}`;

    if (lastAppliedInitialTargetRef.current === initialTargetKey) {
      return;
    }

    const targetEntry = chapterById.get(initialChapterId);

    if (!targetEntry) {
      return;
    }

    lastAppliedInitialTargetRef.current = initialTargetKey;
    setActiveChapterId(initialChapterId);
    setTargetChapterId(initialChapterId);
    setTargetPassageRange(initialPassageRange);
    setSelectedPassage(initialPassageRange);
    setSelectedPassageChapterId(initialPassageRange ? initialChapterId : "");
    rememberReaderChapter(initialChapterId, initialPassageRange);
  }, [
    bookIndex,
    chapterById,
    chapters.length,
    initialChapterId,
    initialPassageRange,
    rememberReaderChapter
  ]);

  useEffect(() => {
    if (!bookIndex || renderedEntries.length === 0) {
      return;
    }

    const missingEntries = renderedEntries
      .filter((entry) => (
        !loadedChapters.has(entry.chapter.id)
        && !chapterLoadErrors.has(entry.chapter.id)
        && !loadingChapterIdsRef.current.has(entry.chapter.id)
      ))
      .sort((left, right) => (
        distanceFromActiveChapter(left, activeChapterIndex)
        - distanceFromActiveChapter(right, activeChapterIndex)
      ));

    if (missingEntries.length === 0) {
      return;
    }

    for (const entry of missingEntries) {
      loadingChapterIdsRef.current.add(entry.chapter.id);
    }

    loadChapterAssets(
      missingEntries,
      previewAssetVersion,
      CHAPTER_ASSET_LOAD_CONCURRENCY
    )
      .then((results) => {
        if (!isMountedRef.current) {
          return;
        }

        setLoadedChapters((current) => {
          const next = new Map(current);

          for (const result of results) {
            if ("asset" in result) {
              next.set(result.asset.id, result.asset);
            }
          }

          return next;
        });

        setChapterLoadErrors((current) => {
          const next = new Map(current);

          for (const result of results) {
            if ("asset" in result) {
              next.delete(result.asset.id);
            } else {
              next.set(result.entry.chapter.id, result.error);
            }
          }

          return next;
        });
      })
      .finally(() => {
        for (const entry of missingEntries) {
          loadingChapterIdsRef.current.delete(entry.chapter.id);
        }
      });
  }, [
    activeChapterIndex,
    bookIndex,
    chapterLoadErrors,
    loadedChapters,
    previewAssetVersion,
    renderedEntries
  ]);

  useEscapeDismiss({
    isOpen: isSearchOpen,
    onDismiss: closeSearch
  });

  useEffect(() => {
    const interval = window.setInterval(() => {
      setExampleIndex((index) => (index + 1) % SEARCH_EXAMPLES.length);
    }, 2800);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (
      navigation.state === "submitting"
      && navigation.formData?.get("intent") === "similar-passage"
    ) {
      dispatchSearchFlow({
        focusedId: String(navigation.formData.get("sourcePassageId") ?? ""),
        type: "submitting-similar"
      });
    }
  }, [navigation.formData, navigation.state]);

  useEffect(() => {
    if (actionData?.mode === "similar" && actionData.similarSource) {
      dispatchSearchFlow({
        focusedId: actionData.similarSource.id,
        type: "similar-results"
      });
      return;
    }

    if (actionData?.mode === "similar-scripture" && actionData.similarScriptureSource) {
      dispatchSearchFlow({
        focusedId: actionData.similarScriptureSource.id,
        type: "similar-results"
      });
      return;
    }

    if (actionData?.mode === "theme") {
      dispatchSearchFlow({ type: "theme-results" });
    }
  }, [
    actionData?.mode,
    actionData?.similarScriptureSource?.id,
    actionData?.similarSource?.id
  ]);

  const openChapter = useCallback((chapterId: string, passageRange = "") => {
    const chapterEntry = chapterById.get(chapterId);

    if (!chapterEntry) {
      return false;
    }

    setRenderedRange(getChapterWindowRange(chapterEntry.index, chapters));
    setActiveChapterId(chapterId);
    setTargetChapterId(chapterId);
    setTargetPassageRange(passageRange);
    setSelectedPassage(passageRange);
    setSelectedPassageChapterId(passageRange ? chapterId : "");
    rememberReaderChapter(chapterId, passageRange);
    updateUrl(chapterId, passageRange);
    return true;
  }, [chapterById, chapters.length, rememberReaderChapter]);

  const openResult = useCallback((result: EarlyChristianSearchResult) => {
    const passageRange = rangeFromResult(result);

    if (openChapter(result.chapterId, passageRange)) {
      closeSearch();
    }
  }, [closeSearch, openChapter]);

  if (loadError) {
    return (
      <main className={`reader-shell reader-theme-${readerTheme}`}>
        <section className="reader-empty" role="alert">
          <p>Early Christian reader unavailable: {loadError}</p>
        </section>
        <ReaderCorpusSwitch current="fathers" />
      </main>
    );
  }

  if (!bookIndex || !activeEntry) {
    return (
      <main className={`reader-shell reader-theme-${readerTheme}`}>
        <section
          aria-busy="true"
          aria-labelledby="reader-loading-title"
          className={`reader-page reader-theme-${readerTheme} reader-loading`}
          style={readerStyles}
        >
          <header className="reader-header reader-loading-header">
            <div className="reader-header-title">
              <h1 id="reader-loading-title">Loading Early Christian Reader</h1>
            </div>
            <div className="reader-loading-meter" aria-hidden="true">
              <span />
            </div>
          </header>
        </section>
        <ReaderCorpusSwitch current="fathers" />
      </main>
    );
  }

  return (
    <main className={`reader-shell reader-theme-${readerTheme}`}>
      <data value={scriptureCacheKey} data-scripture-cache-key hidden />
      <section
        aria-labelledby="reader-title"
        className={`reader-page reader-theme-${readerTheme}`}
        style={readerStyles}
      >
        <header className="reader-header">
          <audio
            ref={audioRef}
            onEnded={() => {
              playingAudioEndSecondsRef.current = null;
              setPlayingAudioKey(null);
            }}
            onPause={() => {
              playingAudioEndSecondsRef.current = null;
              setPlayingAudioKey(null);
            }}
            onTimeUpdate={(event) => {
              const endSeconds = playingAudioEndSecondsRef.current;

              if (!endSeconds || event.currentTarget.currentTime < endSeconds) {
                return;
              }

              event.currentTarget.pause();
              playingAudioEndSecondsRef.current = null;
              setPlayingAudioKey(null);
            }}
            preload="none"
          />
          <div className="reader-header-title" ref={headerTitleRef}>
            <p className="eyebrow">Early Christian Works</p>
            <h1
              className="ec-reader-title"
              id="reader-title"
              ref={readerTitleRef}
              style={headerScaleStyle(activeHeaderTitle)}
            >
              {activeHeaderTitle}
            </h1>
          </div>
          <ReaderTools
            isOpen={isToolsOpen}
            onClose={() => {
              setIsToolsOpen(false);
              setIsJumpOpen(false);
            }}
            onOpen={() => setIsToolsOpen(true)}
          >
              <button
                aria-label={
                  activeAudio
                    ? `${isActiveChapterPlaying ? "Pause" : "Play"} Confessions audio covering ${activeAudio.label}`
                    : `Audio unavailable for this ${activeEntry.book.name} section`
                }
                className="context-button reader-icon-button"
                disabled={!activeAudioUrl}
                onClick={toggleActiveChapterAudio}
                title={
                  activeAudio
                    ? `${isActiveChapterPlaying ? "Pause" : "Play"} audio covering ${activeAudio.label}`
                    : "Audio unavailable"
                }
                type="button"
              >
                {isActiveChapterPlaying ? "❚❚" : "🔊"}
              </button>
              <button
                aria-label="Search"
                className="context-button reader-icon-button"
                onClick={() => {
                  setIsToolsOpen(false);
                  openSearch();
                }}
                title="Search"
                type="button"
              >
                🔍
              </button>
              <section className="passage-jump-launcher is-inline" aria-label="Jump">
                <button
                  className="context-button"
                  onClick={() => {
                    setIsToolsOpen(false);
                    setIsJumpOpen(true);
                  }}
                  type="button"
                >
                  Jump
                </button>
              </section>
              <ReaderSettingsControl
                onChange={setReaderSettings}
                settings={readerSettings}
              />
          </ReaderTools>
        </header>

        <div className="reader-passages">
          {renderedEntries.map((entry) => {
            const chapter = loadedChapters.get(entry.chapter.id);
            const chapterLoadError = chapterLoadErrors.get(entry.chapter.id);
            const previousEntry = entry.index > 0 ? chapters[entry.index - 1] : null;
            const isBookBoundary = !previousEntry || previousEntry.book.id !== entry.book.id;

            return (
              <section
                className={[
                  "reader-chapter",
                  "ec-reader-chapter",
                  isBookBoundary ? "is-book-boundary" : ""
                ].filter(Boolean).join(" ")}
                data-chapter-id={entry.chapter.id}
                key={entry.chapter.id}
              >
                {isBookBoundary ? (
                  <ReaderBookHeader
                    description={getEarlyChristianBookDescription(entry.book)}
                    details={getEarlyChristianBookHeaderDetails(entry.book)}
                    subtitle={getBookAuthorLabel(entry.book)}
                    title={entry.book.name}
                  />
                ) : null}
                <h2
                  className="reader-chapter-heading"
                  style={chapterHeadingScaleStyle(`${entry.book.name} ${entry.chapter.chapter}`)}
                >
                  {entry.book.name} {entry.chapter.chapter}
                  <span>{entry.book.author ?? entry.book.metadata.source.id.toUpperCase()}</span>
                </h2>
                {chapter ? (
                  <>
                    <p className="ec-chapter-title">{chapter.title}</p>
                    <div className="reader-chapter-passages">
                      {groupChapterPassages(chapter, readerTextMode).map((passage) => {
                        const isSelected = isSelectedReaderPassage({
                          chapterId: chapter.id,
                          passage,
                          selectedChapterId: selectedPassageChapterId,
                          selectedRange: selectedPassage
                        });

                        return (
                          <ReaderPassageArticle
                            actions={
                              <>
                                <Form method="post">
                                  <input type="hidden" name="intent" value="similar-passage" />
                                  <input type="hidden" name="targetCorpus" value="early-christian" />
                                  <input type="hidden" name="sourcePassageId" value={passage.key} />
                                  <EarlyChristianAuthorInputs authors={selectedAuthorFilters} />
                                  <button
                                    className="context-button"
                                    disabled={isSearching}
                                    type="submit"
                                  >
                                    {isFindingSimilarFathers ? (
                                      <>
                                        <span className="button-spinner" aria-hidden="true" />
                                        Finding similar
                                      </>
                                    ) : (
                                      "Similar passages"
                                    )}
                                  </button>
                                </Form>
                                {isSearching ? (
                                  <p className="reader-action-status" role="status">
                                    Searching similar passages...
                                  </p>
                                ) : null}
                              </>
                            }
                            dataAttributes={{
                              "data-passage-end": passage.verseEnd,
                              "data-passage-key": passage.key,
                              "data-passage-range": passage.rangeLabel,
                              "data-passage-start": passage.verseStart
                            }}
                            isSelected={isSelected}
                            key={passage.key}
                            onToggle={() => {
                              const nextRange = isSelected ? "" : passage.rangeLabel;
                              setSelectedPassage(nextRange);
                              setSelectedPassageChapterId(nextRange ? chapter.id : "");
                              updateUrl(chapter.id, nextRange);
                            }}
                            reference={passage.rangeLabel}
                            text={(
                              <span className="reader-verse">
                                {renderReaderPassageText(passage)}
                              </span>
                            )}
                          />
                        );
                      })}
                    </div>
                  </>
                ) : chapterLoadError ? (
                  <div className="reader-chapter-error" role="status">
                    <p>{chapterLoadError}</p>
                    <button
                      className="context-button"
                      onClick={() => {
                        setChapterLoadErrors((current) => {
                          const next = new Map(current);
                          next.delete(entry.chapter.id);
                          return next;
                        });
                      }}
                      type="button"
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  <div className="reader-loading-lines" aria-hidden="true">
                    <span className="reader-loading-line is-wide" />
                    <span className="reader-loading-line" />
                    <span className="reader-loading-line is-medium" />
                  </div>
                )}
              </section>
            );
          })}
        </div>
        {activeChapterHasModernizedText ? (
          <div className="reader-text-toggle" aria-label="Text version">
            {(["modernized", "original"] as const).map((mode) => (
              <button
                aria-pressed={readerTextMode === mode}
                className={readerTextMode === mode ? "is-active" : ""}
                key={mode}
                onClick={() => setReaderTextMode(mode)}
                title={mode === "modernized" ? "Show modernized text" : "Show original translation"}
                type="button"
              >
                {mode === "modernized" ? "Mod" : "Orig"}
              </button>
            ))}
          </div>
        ) : null}
        <ReaderCorpusSwitch current="fathers" />
      </section>

      {isSearchOpen ? (
        <div
          className={`search-modal-backdrop reader-theme-${readerTheme}`}
          onClick={(event) => {
            event.stopPropagation();

            if (isBackdropClick(event)) {
              closeSearch();
            }
          }}
        >
          <section
            aria-labelledby="search-modal-title"
            aria-modal="true"
            className="search-modal"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="search-modal-header">
              <div>
                <p className="eyebrow">Search</p>
                <h2 id="search-modal-title">Find chapters</h2>
              </div>
              <button
                className="filter-modal-close"
                onClick={closeSearch}
                type="button"
              >
                Close
              </button>
            </header>

            <div className="search-modal-body">
              <section
                aria-busy={isSearching}
                aria-label="Early Christian search"
                className={`search-band${isSearching ? " is-searching" : ""}`}
              >
                <Form method="post" className="search-form">
                  <input type="hidden" name="intent" value={searchIntent} />
                  {focusedPassageKey ? (
                    <input type="hidden" name="sourcePassageId" value={focusedPassageKey} />
                  ) : null}
                  {showScriptureFilters ? (
                    <input type="hidden" name="canon" value={canon} />
                  ) : null}
                  <input type="hidden" name="matchCount" value={matchCount} />
                  {showScriptureFilters ? selectedBooksForCanon.map((book) => (
                    <input key={book} type="hidden" name="books" value={book} />
                  )) : null}
                  {showAuthorFilters ? (
                    <EarlyChristianAuthorInputs authors={selectedAuthorFilters} />
                  ) : null}
                  <SearchTargetControl
                    disabled={isSearching}
                    value={themeCorpus}
                    onChange={setThemeCorpus}
                  />
                  {!focusedPassageKey ? (
                    <label htmlFor="question">
                      Search {themeCorpus === "scripture" ? "Bible" : "early Christian works"} for...
                    </label>
                  ) : null}
                  <div className="search-row">
                    <div className="search-primary">
                      {focusedPassageKey ? (
                        <div className="focused-passage">
                          <button
                            aria-label="Clear similar passage"
                            className="focused-passage-clear"
                            disabled={isSearching}
                            onClick={() => setFocusedPassageKey(null)}
                            type="button"
                          >
                            &times;
                          </button>
                          <h2>
                            {actionData?.similarSource?.reference
                              ?? actionData?.similarScriptureSource?.reference
                              ?? focusedPassage?.reference
                              ?? "Selected passage"}
                          </h2>
                          <p>
                            {actionData?.similarSource?.text
                              ?? actionData?.similarScriptureSource?.text
                              ?? focusedPassage?.text
                              ?? "Passage text is loading."}
                          </p>
                        </div>
                      ) : (
                        <textarea
                          defaultValue={actionData?.question ?? ""}
                          disabled={isSearching}
                          id="question"
                          maxLength={500}
                          minLength={3}
                          name="question"
                          placeholder={SEARCH_EXAMPLES[exampleIndex]}
                          required
                          rows={4}
                        />
                      )}
                    </div>
                    <div className="search-actions">
                      <button
                        aria-controls="filter-modal"
                        aria-expanded={isAuthorFilterOpen}
                        className={`filter-toggle${activeFilterCount > 0 ? " is-active" : ""}`}
                        disabled={isSearching}
                        onClick={() => setIsAuthorFilterOpen(true)}
                        type="button"
                      >
                        Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
                      </button>
                      <button
                        className="search-button"
                        disabled={isSearching || !isReady}
                        type="submit"
                      >
                        {isSearching ? (
                          <>
                            <span className="button-spinner" aria-hidden="true" />
                            {searchIntent === "theme-scripture"
                              ? "Searching Bible"
                              : searchIntent === "theme"
                              ? "Searching Fathers"
                              : searchIntent === "similar-scripture"
                              ? "Finding Bible"
                              : "Finding similar"}
                          </>
                        ) : searchIntent === "theme-scripture" ? (
                          "Search Bible"
                        ) : searchIntent === "theme" ? (
                          "Search Fathers"
                        ) : searchIntent === "similar-scripture" ? (
                          "Find Bible"
                        ) : focusedPassageKey ? (
                          "Find similar"
                        ) : (
                          "Search Fathers"
                        )}
                      </button>
                      {isSearching ? (
                        <p className="search-status" role="status">
                          {searchIntent === "theme-scripture"
                            ? "Searching Bible passages..."
                            : searchIntent === "similar-scripture"
                            ? "Finding Bible passages..."
                            : "Searching early Christian works..."}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <FilterModal
                    canon={canon}
                    earlyChristianAuthors={authorOptions}
                    isOpen={isAuthorFilterOpen}
                    isSearching={isSearching}
                    matchCount={matchCount}
                    selectedEarlyChristianAuthors={selectedAuthorFilters}
                    selectedBooks={selectedBooksForCanon}
                    showEarlyChristianAuthorFilters={showAuthorFilters}
                    showScriptureFilters={showScriptureFilters}
                    visibleBooks={visibleScriptureBooks}
                    onCanonChange={updateCanon}
                    onClearFilters={clearAuthorFilters}
                    onClose={() => setIsAuthorFilterOpen(false)}
                    onMatchCountChange={setMatchCount}
                    onToggleBook={toggleSelectedBook}
                    onToggleEarlyChristianAuthor={toggleSelectedAuthor}
                  />
                </Form>
              </section>

              {actionData?.error ? (
                <p className="notice" role="alert">
                  {actionData.error}
                  {actionData.retryAfterSeconds
                    ? ` ${actionData.retryAfterSeconds} seconds remaining.`
                    : ""}
                </p>
              ) : null}

              <EarlyChristianSearchResults
                authors={selectedAuthorFilters}
                canon={canon}
                isSearching={isSearching}
                onOpenResult={openResult}
                results={actionData?.results}
                scriptureBooks={selectedBooksForCanon}
                showEmptyState={!actionData?.scriptureResults}
              />

              {actionData?.scriptureResults ? (
                <SearchResults
                  actionData={churchFathersScriptureActionData(actionData)}
                  contextActionLabel="Jump to"
                  focusedPassageId={null}
                  passageLookup={scriptureLibrary.passageLookup}
                  results={actionData.scriptureResults}
                  showEmptyState={false}
                  showSimilarAction={false}
                />
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {isJumpOpen ? (
        <ChapterJump
          activeChapterId={activeEntry.chapter.id}
          chapters={chapters}
          onClose={() => setIsJumpOpen(false)}
          onJump={(chapterId) => {
            setIsJumpOpen(false);
            openChapter(chapterId);
          }}
        />
      ) : null}
    </main>
  );
}

function EarlyChristianSearchResults({
  authors,
  canon,
  isSearching,
  onOpenResult,
  results,
  scriptureBooks,
  showEmptyState = true
}: {
  authors: string[];
  canon: CanonMode;
  isSearching: boolean;
  onOpenResult: (result: EarlyChristianSearchResult) => void;
  results?: EarlyChristianSearchResult[];
  scriptureBooks: string[];
  showEmptyState?: boolean;
}) {
  const [selectedResult, setSelectedResult] = useState("");

  useEffect(() => {
    setSelectedResult("");
  }, [results]);

  return (
    <section className="results ec-results" aria-live="polite">
      {results?.length ? (
        results.map((result, index) => {
          const resultSelectionId = result.highlightPassage.id
            || `${result.chapterId}:${result.highlightPassage.rangeLabel}`;
          const isSelected = selectedResult === resultSelectionId;

          return (
            <article
              className={[
                "scripture-result",
                `match-level-${result.matchStrength}`,
                isSelected ? "is-selected" : ""
              ].filter(Boolean).join(" ")}
              key={`${result.chapterId}-${index}`}
            >
              <button
                aria-expanded={isSelected}
                className="scripture-result-button"
                onClick={() => setSelectedResult(isSelected ? "" : resultSelectionId)}
                type="button"
              >
                <span className="result-meta">
                  <span>{result.chapterReference}</span>
                  <span>{result.author ?? result.source.toUpperCase()}</span>
                  <span
                    aria-label={`${result.matchStrength} of 4 match strength`}
                    className="match-strength"
                    title={`${result.matchStrength} of 4 match strength`}
                  >
                    <span className="match-strength-label" aria-hidden="true">
                      Match strength
                    </span>
                    <span className="match-dots" aria-hidden="true">
                      {[1, 2, 3, 4].map((level) => (
                        <span
                          className={level <= result.matchStrength ? "is-active" : undefined}
                          key={level}
                        />
                      ))}
                    </span>
                  </span>
                </span>
                <span className="scripture-result-text">
                  {result.highlightPassage.rangeLabel ? (
                    <>
                      <span className="result-range-label">
                        {result.highlightPassage.rangeLabel}.
                      </span>{" "}
                    </>
                  ) : null}
                  {result.highlightPassage.text}
                </span>
              </button>
              {isSelected ? (
                <div className="result-actions">
                  <button
                    className="context-button"
                    onClick={() => onOpenResult(result)}
                    type="button"
                  >
                    Jump to
                  </button>
                  <Form method="post">
                    <input type="hidden" name="intent" value="similar-passage" />
                    <input type="hidden" name="targetCorpus" value="early-christian" />
                    <input
                      type="hidden"
                      name="sourcePassageId"
                      value={result.highlightPassage.id}
                    />
                    <EarlyChristianAuthorInputs authors={authors} />
                    <button
                      className="context-button"
                      disabled={isSearching}
                      type="submit"
                    >
                      {isSearching ? (
                        <>
                          <span className="button-spinner" aria-hidden="true" />
                          Finding similar
                        </>
                      ) : (
                        "Similar passages"
                      )}
                    </button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="similar-scripture" />
                    <input type="hidden" name="targetCorpus" value="scripture" />
                    <input
                      type="hidden"
                      name="sourcePassageId"
                      value={result.highlightPassage.id}
                    />
                    <ChurchFathersScriptureFilterInputs
                      books={scriptureBooks}
                      canon={canon}
                    />
                    <button
                      className="context-button"
                      disabled={isSearching}
                      type="submit"
                    >
                      {isSearching ? (
                        <>
                          <span className="button-spinner" aria-hidden="true" />
                          Finding Bible
                        </>
                      ) : (
                        "Similar Bible passages"
                      )}
                    </button>
                  </Form>
                </div>
              ) : null}
            </article>
          );
        })
      ) : showEmptyState ? (
        <div className="empty-state">
          <p>Early Christian results will appear here.</p>
        </div>
      ) : (
        null
      )}
    </section>
  );
}

function EarlyChristianAuthorInputs({ authors }: { authors: string[] }) {
  return (
    <>
      {authors.map((author) => (
        <input key={author} type="hidden" name="authors" value={author} />
      ))}
    </>
  );
}

function ChurchFathersScriptureFilterInputs({
  books,
  canon
}: {
  books: string[];
  canon: CanonMode;
}) {
  return (
    <>
      <input type="hidden" name="canon" value={canon} />
      {books.map((book) => (
        <input key={book} type="hidden" name="books" value={book} />
      ))}
    </>
  );
}

function ChapterJump({
  activeChapterId,
  chapters,
  onClose,
  onJump
}: {
  activeChapterId: string;
  chapters: ChapterEntry[];
  onClose: () => void;
  onJump: (chapterId: string) => void;
}) {
  const activeEntry = chapters.find((entry) => entry.chapter.id === activeChapterId)
    ?? chapters[0];
  const books = useMemo(() => dedupeBooks(chapters), [chapters]);
  const [selectedBookId, setSelectedBookId] = useState(activeEntry?.book.id ?? "");
  const [workQuery, setWorkQuery] = useState("");
  const selectedBook = books.find((book) => book.id === selectedBookId)
    ?? activeEntry?.book;
  const bookChapters = selectedBook
    ? chapters.filter((entry) => entry.book.id === selectedBook.id)
    : [];
  const visibleBooks = useMemo(() => {
    const trimmedQuery = workQuery.trim();

    if (trimmedQuery.length > 0) {
      return books
        .filter((book) => keywordMatches(trimmedQuery, getBookSearchText(book)))
        .slice(0, 24);
    }

    const selectedBooks = selectedBook ? [selectedBook] : [];
    const selectedBookIds = new Set(selectedBooks.map((book) => book.id));
    const unselectedMatches = books.filter((book) => !selectedBookIds.has(book.id));

    return [...selectedBooks, ...unselectedMatches].slice(0, 12);
  }, [books, selectedBook, workQuery]);

  return (
    <div
      className="passage-jump-backdrop"
      onClick={(event) => {
        event.stopPropagation();

            if (isBackdropClick(event)) {
              onClose();
            }
      }}
    >
      <section
        aria-labelledby="passage-jump-title"
        aria-modal="true"
        className="passage-jump-modal ec-jump-modal"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="passage-jump-modal-header">
          <div>
            <p className="eyebrow">Jump</p>
            <h2 id="passage-jump-title">Choose a work</h2>
          </div>
          <button className="filter-modal-close" onClick={onClose} type="button">
            Close
          </button>
        </header>

        <div className="passage-jump-modal-body">
          <label className="passage-jump-book">
            <span>Find work</span>
            <input
              autoComplete="off"
              className="passage-jump-search"
              onChange={(event) => setWorkQuery(event.currentTarget.value)}
              placeholder="City of God"
              type="search"
              value={workQuery}
            />
          </label>
          <div className="ec-work-options" aria-label="Works">
            {visibleBooks.length > 0 ? visibleBooks.map((book) => (
              <button
                className={[
                  "ec-work-option",
                  book.id === selectedBook?.id ? "is-selected" : ""
                ].filter(Boolean).join(" ")}
                key={book.id}
                onClick={() => setSelectedBookId(book.id)}
                title={formatBookOptionLabel(book)}
                type="button"
              >
                <span className="ec-work-title">{book.name}</span>
                <span className="ec-work-meta">{getBookAuthorLabel(book)}</span>
              </button>
            )) : (
              <p className="passage-jump-empty">No matches</p>
            )}
          </div>

          <div className="passage-jump-group" aria-label="Chapter">
            <span>Chapter</span>
            <div className="passage-jump-options">
              {bookChapters.map((entry) => (
                <button
                  className={entry.chapter.id === activeChapterId ? "is-selected" : undefined}
                  key={entry.chapter.id}
                  onClick={() => onJump(entry.chapter.id)}
                  title={entry.chapter.title}
                  type="button"
                >
                  {entry.chapter.chapter}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function flattenChapters(bookIndex: BookIndex | null): ChapterEntry[] {
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

function sortBookIndex(bookIndex: BookIndex): BookIndex {
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

function readCachedBookIndex(manifestUrl: string, previewAssetVersion: string) {
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

function resolveActiveChapterId({
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

function getBookAuthorLabel(book: BookSummary) {
  return book.author
    ?? book.metadata.author
    ?? book.name;
}

function getEarlyChristianBookDescription(book: BookSummary) {
  if (book.book && book.book !== book.name) {
    return book.book;
  }

  return null;
}

function getEarlyChristianBookHeaderDetails(book: BookSummary) {
  return [
    { label: "Author", value: book.author ?? book.metadata.author ?? "" },
    { label: "Date", value: book.metadata.authorshipDateRange ?? "" },
    { label: "Source", value: book.metadata.source.title },
    { label: "Type", value: book.classification.bucket },
    { label: "Chapters", value: formatChapterCount(book.chapters.length) }
  ];
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

function getChapterWindowRange(index: number, entries: ChapterEntry[]) {
  const range = getCenteredWindowRange({
    after: CHAPTER_WINDOW_AFTER,
    before: CHAPTER_WINDOW_BEFORE,
    count: entries.length,
    index
  });

  return clampChapterWindowStartToBook(range, index, entries);
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

function findChapterBookStartIndex(activeIndex: number, entries: ChapterEntry[]) {
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

function rangeFromResult(result: EarlyChristianSearchResult) {
  const start = result.highlightPassage.verseStart;
  const end = result.highlightPassage.verseEnd;

  if (!start) {
    return "";
  }

  return end && end !== start ? `${start}-${end}` : String(start);
}

function updateUrl(chapterId: string, passageRange = "") {
  const params = new URLSearchParams();

  if (chapterId) {
    params.set("chapter", chapterId);
  }

  if (passageRange) {
    params.set("passage", passageRange);
  }

  window.history.replaceState(null, "", `/church-fathers?${params.toString()}`);
}

function dedupeBooks(chapters: ChapterEntry[]) {
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

function formatBookOptionLabel(book: BookSummary) {
  return book.author ? `${book.name} - ${book.author}` : book.name;
}

function getBookSearchText(book: BookSummary) {
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

function getEarlyChristianAudio(
  entry: ChapterEntry,
  alignment: ConfessionsAudioAlignment | null
) {
  if (entry.book.id !== CONFESSIONS_BOOK_ID) {
    return null;
  }

  const alignedAudio = alignment?.chapters[entry.chapter.id];

  if (alignedAudio) {
    return {
      confidence: alignedAudio.confidence,
      endSeconds: alignedAudio.endSeconds,
      label: alignedAudio.label,
      startSeconds: alignedAudio.startSeconds,
      url: alignedAudio.audioUrl
    };
  }

  const location = parseConfessionsLocation(entry.chapter.id);

  if (!location) {
    return null;
  }

  const track = CONFESSIONS_AUDIO_TRACKS.find((candidate) => (
    candidate.book === location.book &&
    candidate.chapterStart <= location.chapter &&
    candidate.chapterEnd >= location.chapter
  ));

  return track
    ? {
      label: track.label,
      startSeconds: 0,
      url: `${CONFESSIONS_AUDIO_BASE_URL}/${track.fileName}`
    }
    : null;
}

function parseConfessionsLocation(chapterId: string) {
  const match = chapterId.match(/^npnf101:vi\.([IVXLCDM]+)(?:_1)?\.([IVXLCDM]+)$/);

  if (!match) {
    return null;
  }

  const book = romanNumeralToNumber(match[1]);
  const chapter = romanNumeralToNumber(match[2]);

  if (!book || !chapter) {
    return null;
  }

  return { book, chapter };
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

function parseMatchCount(formData: FormData):
  | { value: number }
  | { response: ReturnType<typeof json<ChurchFathersActionData>> } {
  const matchCount = Number(formData.get("matchCount") ?? 10);

  if (!Number.isInteger(matchCount) || matchCount < 5 || matchCount > 40) {
    return {
      response: json<ChurchFathersActionData>(
        { error: "Choose between 5 and 40 matches." },
        { status: 400 }
      )
    };
  }

  return { value: matchCount };
}

function getCachedChapterAssets(version: string) {
  const chapters = new Map<string, ChapterAsset>();

  for (const asset of getCachedPreviewJsonEntries<ChapterAsset>(
    version,
    "/church-fathers-preview/chapters/"
  )) {
    chapters.set(asset.id, asset);
  }

  return chapters;
}

async function loadChapterAssets(
  entries: ChapterEntry[],
  previewAssetVersion: string,
  concurrency: number
) {
  const results: ChapterAssetLoadResult[] = [];
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, entries.length));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < entries.length) {
      const entry = entries[nextIndex];
      nextIndex += 1;
      results.push(await loadChapterAsset(entry, previewAssetVersion));
    }
  }));

  return results;
}

async function loadChapterAsset(
  entry: ChapterEntry,
  previewAssetVersion: string
): Promise<ChapterAssetLoadResult> {
  try {
    return {
      asset: await loadPreviewJson<ChapterAsset>(
        entry.chapter.assetPath,
        previewAssetVersion
      ),
      entry
    };
  } catch (error: unknown) {
    return {
      entry,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function distanceFromActiveChapter(
  entry: ChapterEntry,
  activeChapterIndex: number | undefined
) {
  return typeof activeChapterIndex === "number"
    ? Math.abs(entry.index - activeChapterIndex)
    : entry.index;
}

function churchFathersScriptureActionData(
  actionData: ChurchFathersActionData | undefined
): SearchActionData | undefined {
  if (!actionData?.scriptureResults) {
    return undefined;
  }

  return {
    books: actionData.books,
    canon: actionData.canon,
    matchCount: actionData.matchCount,
    mode: actionData.mode === "theme-scripture" ? "theme" : "similar",
    question: actionData.question,
    results: actionData.scriptureResults,
    similarSource: actionData.similarScriptureSource
      ? {
        id: actionData.similarScriptureSource.id,
        reference: actionData.similarScriptureSource.reference
      }
      : undefined,
    targetCorpus: "scripture"
  };
}

const withScriptureMatchStrength = withCalibratedMatchStrength;

function headerScaleStyle(title: string) {
  return {
    "--ec-reader-title-scale": getTextScale(title.length, {
      floor: 0.48,
      startAt: 18,
      step: 0.015
    })
  } as CSSProperties;
}

function chapterHeadingScaleStyle(title: string) {
  return {
    "--ec-chapter-heading-scale": getTextScale(title.length, {
      floor: 0.74,
      startAt: 34,
      step: 0.0048
    })
  } as CSSProperties;
}

function getTextScale(
  length: number,
  options: { floor: number; startAt: number; step: number }
) {
  return Math.max(
    options.floor,
    1 - Math.max(0, length - options.startAt) * options.step
  );
}

function cssEscape(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}
