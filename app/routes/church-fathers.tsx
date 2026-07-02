import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";

import {
  ReaderCorpusSwitch,
  rememberReaderCorpus
} from "~/features/reader-switch/ReaderCorpusSwitch";
import { BOOKS_BY_CANON, DEFAULT_CANON } from "~/features/search/canons";
import { SearchResults } from "~/features/search/SearchResults";
import type { SearchActionData, SearchResult } from "~/features/search/types";
import { useScriptureLibrary } from "~/features/scripture/useScriptureLibrary";
import { searchScriptureSimilarToFathers } from "~/lib/cross-corpus-search.server";
import {
  searchEarlyChristianWorks,
  searchSimilarEarlyChristianPassages,
  type EarlyChristianSearchResult,
  type EarlyChristianSimilarSource
} from "~/lib/early-christian-search.server";
import { getClientIp, rateLimit } from "~/lib/rate-limit.server";
import { getScriptureCacheInfo } from "~/lib/scripture-cache.server";
import { useModalScrollLock } from "~/lib/use-modal-scroll-lock";

const MANIFEST_URL = "/church-fathers-preview/manifest.json";
const CONFESSIONS_AUDIO_ALIGNMENT_URL =
  "/church-fathers-preview/confessions-audio-alignment.json";
const PREVIEW_ASSET_VERSION = "early-christian-preview-20260701b";
const READER_POSITION_STORAGE_KEY = "cross-cannon:church-fathers-position:v1";
const READER_SETTINGS_STORAGE_KEY = "cross-cannon:reader-settings:v1";
const READER_THEMES = ["paper", "sepia", "dark", "contrast"] as const;
const CHAPTER_WINDOW_BEFORE = 5;
const CHAPTER_WINDOW_AFTER = 10;
const CHAPTER_WINDOW_EXPAND_COUNT = 8;
const CHAPTER_WINDOW_EDGE_PX = 1800;
const HEADER_SCROLL_OFFSET = 118;
const CHAPTER_UPDATE_OFFSET = HEADER_SCROLL_OFFSET + 48;
const INITIAL_SCROLL_MAX_FRAMES = 8;
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
const CONFESSIONS_BOOK_ID = "npnf101:vi";
const FIRST_FATHERS_WORK_ID = "anf09:xii.iv";
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

type ReaderTheme = typeof READER_THEMES[number];

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

type ReaderPassage = {
  key: string;
  rangeLabel: string;
  reference: string;
  text: string;
  verseEnd: number;
  verseStart: number;
};

type ChurchFathersActionData = {
  error?: string;
  matchCount?: number;
  mode?: "theme" | "similar" | "similar-scripture";
  question?: string;
  results?: EarlyChristianSearchResult[];
  retryAfterSeconds?: number;
  similarSource?: EarlyChristianSimilarSource;
  similarScriptureSource?: EarlyChristianSimilarSource;
  scriptureResults?: SearchResult[];
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
  const scriptureCache = await getScriptureCacheInfo();
  const requestedChapterId = url.searchParams.get("chapter") ?? "";
  const initialChapterId = requestedChapterId && await isKnownPreviewChapterId(requestedChapterId)
    ? requestedChapterId
    : "";

  return json({
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

  if ("response" in matchCount) {
    return matchCount.response;
  }

  if (intent === "similar-passage") {
    const sourcePassageId = String(formData.get("sourcePassageId") ?? "").trim();
    const similar = await searchSimilarEarlyChristianPassages(sourcePassageId, matchCount.value);

    if (!similar) {
      return json<ChurchFathersActionData>(
        { error: "Choose an indexed passage to search from." },
        { status: 400 }
      );
    }

    return json<ChurchFathersActionData>({
      matchCount: matchCount.value,
      mode: "similar",
      results: similar.results,
      similarSource: similar.source
    });
  }

  if (intent === "similar-scripture") {
    const sourcePassageId = String(formData.get("sourcePassageId") ?? "").trim();
    const similar = await searchScriptureSimilarToFathers(
      sourcePassageId,
      matchCount.value,
      Array.from(BOOKS_BY_CANON[DEFAULT_CANON])
    );

    if (!similar) {
      return json<ChurchFathersActionData>(
        { error: "Choose an indexed passage to search from." },
        { status: 400 }
      );
    }

    return json<ChurchFathersActionData>({
      matchCount: matchCount.value,
      mode: "similar-scripture",
      scriptureResults: withScriptureMatchStrength(similar.results),
      similarScriptureSource: similar.source
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
    matchCount: matchCount.value,
    mode: "theme",
    question,
    results: await searchEarlyChristianWorks(question, matchCount.value)
  });
}

export default function ChurchFathersReaderRoute() {
  const {
    initialChapterId,
    initialPassageRange,
    manifestUrl,
    previewAssetVersion,
    scriptureCacheKey,
    scriptureCacheUrl
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [manifest, setManifest] = useState<PreviewManifest | null>(null);
  const [bookIndex, setBookIndex] = useState<BookIndex | null>(null);
  const [confessionsAudioAlignment, setConfessionsAudioAlignment] =
    useState<ConfessionsAudioAlignment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedChapters, setLoadedChapters] = useState<Map<string, ChapterAsset>>(() => new Map());
  const [chapterLoadErrors, setChapterLoadErrors] = useState<Map<string, string>>(() => new Map());
  const [activeChapterId, setActiveChapterId] = useState(initialChapterId);
  const [selectedPassage, setSelectedPassage] = useState(initialPassageRange);
  const [selectedPassageChapterId, setSelectedPassageChapterId] = useState(
    initialPassageRange ? initialChapterId : ""
  );
  const [focusedPassageKey, setFocusedPassageKey] = useState<string | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>("paper");
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [isJumpOpen, setIsJumpOpen] = useState(false);
  const [exampleIndex, setExampleIndex] = useState(0);
  const [playingAudioKey, setPlayingAudioKey] = useState<string | null>(null);
  const [renderedRange, setRenderedRange] = useState({
    endIndex: -1,
    startIndex: 0
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canReportLocationRef = useRef(false);
  const hasScrolledToSelectionRef = useRef(false);
  const headerTitleRef = useRef<HTMLDivElement | null>(null);
  const lastReportedChapterIdRef = useRef("");
  const playingAudioEndSecondsRef = useRef<number | null>(null);
  const prependSnapshotRef = useRef<{
    scrollHeight: number;
    scrollY: number;
  } | null>(null);
  const readerTitleRef = useRef<HTMLHeadingElement | null>(null);

  useModalScrollLock(isSearchOpen || isJumpOpen);

  const scriptureLibrary = useScriptureLibrary({
    scriptureCacheUrl
  });

  const chapters = useMemo(() => flattenChapters(bookIndex), [bookIndex]);
  const chapterById = useMemo(
    () => new Map(chapters.map((entry) => [entry.chapter.id, entry])),
    [chapters]
  );
  const activeEntry = activeChapterId ? chapterById.get(activeChapterId) : undefined;
  const renderedEntries = useMemo(
    () => renderedRange.endIndex >= renderedRange.startIndex
      ? chapters.slice(
        Math.max(0, renderedRange.startIndex),
        renderedRange.endIndex + 1
      )
      : [],
    [chapters, renderedRange.endIndex, renderedRange.startIndex]
  );
  const isReady = Boolean(bookIndex && activeEntry);
  const focusedPassage = focusedPassageKey
    ? findLoadedPassage(loadedChapters, focusedPassageKey)
    : null;
  const activeAudio = activeEntry
    ? getEarlyChristianAudio(activeEntry, confessionsAudioAlignment)
    : null;
  const activeAudioUrl = activeAudio?.url ?? null;
  const activeAudioKey = activeAudio
    ? `${activeAudio.url}#${activeAudio.startSeconds ?? 0}`
    : null;
  const isActiveChapterPlaying = Boolean(
    activeAudioKey && playingAudioKey === activeAudioKey
  );
  const isSearching = navigation.state === "submitting";
  const isFindingSimilarFathers = isSearching
    && navigation.formData?.get("intent") === "similar-passage";
  const isFindingSimilarScripture = isSearching
    && navigation.formData?.get("intent") === "similar-scripture";
  const activeHeaderTitle = activeEntry
    ? `${activeEntry.book.name} ${activeEntry.chapter.chapter}`
    : "";

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
    setReaderTheme(readSavedReaderTheme());
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

  useBrowserLayoutEffect(() => {
    if (typeof window === "undefined" || !("scrollRestoration" in window.history)) {
      return;
    }

    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  useEffect(() => {
    let ignore = false;

    fetch(versionedPreviewUrl(CONFESSIONS_AUDIO_ALIGNMENT_URL, previewAssetVersion), {
      cache: "no-store"
    })
      .then((response) => {
        if (!response.ok) {
          return null;
        }

        return response.json() as Promise<ConfessionsAudioAlignment>;
      })
      .then((alignment) => {
        if (!ignore && alignment) {
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

    fetch(versionedPreviewUrl(manifestUrl, previewAssetVersion), { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load manifest: ${response.status}`);
        }

        return response.json() as Promise<PreviewManifest>;
      })
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

    fetch(versionedPreviewUrl(manifest.bookIndexPath, previewAssetVersion), { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load work index: ${response.status}`);
        }

        return response.json() as Promise<BookIndex>;
      })
      .then((loadedIndex) => {
        if (!ignore) {
          setLoadError(null);
          setBookIndex(sortBookIndex(loadedIndex));
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

  useEffect(() => {
    if (!bookIndex) {
      return;
    }

    if (activeChapterId && chapterById.has(activeChapterId)) {
      const activeChapterIndex = chapterById.get(activeChapterId)?.index ?? 0;
      setRenderedRange((range) => (
        rangeContainsIndex(range, activeChapterIndex)
          ? range
          : getChapterWindowRange(activeChapterIndex, chapters.length)
      ));
      return;
    }

    const rememberedChapterId = window.localStorage.getItem(READER_POSITION_STORAGE_KEY);
    const rememberedChapter = rememberedChapterId
      ? chapterById.get(rememberedChapterId)
      : undefined;
    const nextEntry = rememberedChapter ?? chapters[0];
    const nextChapterId = nextEntry?.chapter.id ?? "";

    if (!nextChapterId) {
      return;
    }

    setActiveChapterId(nextChapterId);
    setSelectedPassage("");
    setSelectedPassageChapterId("");
    setRenderedRange(getChapterWindowRange(nextEntry.index, chapters.length));
    canReportLocationRef.current = false;
    lastReportedChapterIdRef.current = nextChapterId;
    hasScrolledToSelectionRef.current = false;
    updateUrl(nextChapterId, "");
  }, [activeChapterId, bookIndex, chapterById, chapters]);

  useEffect(() => {
    if (!bookIndex || renderedEntries.length === 0) {
      return;
    }

    let ignore = false;
    const missingEntries = renderedEntries.filter((entry) => (
      !loadedChapters.has(entry.chapter.id)
      && !chapterLoadErrors.has(entry.chapter.id)
    ));

    if (missingEntries.length === 0) {
      return;
    }

    Promise.all(
      missingEntries.map((entry) => fetch(
        versionedPreviewUrl(entry.chapter.assetPath, previewAssetVersion),
        { cache: "no-store" }
      )
        .then(async (response): Promise<ChapterAssetLoadResult> => {
          if (!response.ok) {
            return {
              entry,
              error: `Failed to load chapter: ${response.status}`
            };
          }

          return {
            asset: await response.json() as ChapterAsset,
            entry
          };
        })
        .catch((error: unknown): ChapterAssetLoadResult => ({
          entry,
          error: error instanceof Error ? error.message : String(error)
        })))
    )
      .then((results) => {
        if (ignore) {
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
      });

    return () => {
      ignore = true;
    };
  }, [bookIndex, chapterLoadErrors, loadedChapters, previewAssetVersion, renderedEntries]);

  useEffect(() => {
    if (!isSearchOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSearchOpen(false);
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isSearchOpen]);

  useBrowserLayoutEffect(() => {
    const snapshot = prependSnapshotRef.current;

    if (!snapshot) {
      return;
    }

    prependSnapshotRef.current = null;

    const nextScrollHeight = document.documentElement.scrollHeight;
    const addedHeight = nextScrollHeight - snapshot.scrollHeight;

    if (addedHeight > 0) {
      window.scrollTo({
        behavior: "auto",
        left: 0,
        top: snapshot.scrollY + addedHeight
      });
    }
  }, [renderedRange.startIndex]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    const enableLocationReporting = () => {
      canReportLocationRef.current = true;
    };
    const enableLocationReportingFromKey = (event: KeyboardEvent) => {
      if (
        event.key === "ArrowDown"
        || event.key === "ArrowUp"
        || event.key === "PageDown"
        || event.key === "PageUp"
        || event.key === " "
        || event.key === "Home"
        || event.key === "End"
      ) {
        enableLocationReporting();
      }
    };

    window.addEventListener("wheel", enableLocationReporting, { passive: true });
    window.addEventListener("touchmove", enableLocationReporting, { passive: true });
    window.addEventListener("keydown", enableLocationReportingFromKey);

    return () => {
      window.removeEventListener("wheel", enableLocationReporting);
      window.removeEventListener("touchmove", enableLocationReporting);
      window.removeEventListener("keydown", enableLocationReportingFromKey);
    };
  }, [isReady]);

  useEffect(() => {
    if (!isReady || chapters.length === 0) {
      return;
    }

    let frame = 0;

    const expandRenderedWindow = () => {
      frame = 0;

      const distanceToTop = window.scrollY;
      const distanceToBottom = document.documentElement.scrollHeight
        - (window.scrollY + window.innerHeight);

      if (distanceToTop < CHAPTER_WINDOW_EDGE_PX) {
        setRenderedRange((range) => {
          if (range.startIndex <= 0) {
            return range;
          }

          const nextStartIndex = Math.max(
            0,
            range.startIndex - CHAPTER_WINDOW_EXPAND_COUNT
          );

          if (nextStartIndex === range.startIndex) {
            return range;
          }

          prependSnapshotRef.current = {
            scrollHeight: document.documentElement.scrollHeight,
            scrollY: window.scrollY
          };

          return {
            ...range,
            startIndex: nextStartIndex
          };
        });
      }

      if (distanceToBottom < CHAPTER_WINDOW_EDGE_PX) {
        setRenderedRange((range) => {
          if (range.endIndex >= chapters.length - 1) {
            return range;
          }

          return {
            ...range,
            endIndex: Math.min(
              chapters.length - 1,
              range.endIndex + CHAPTER_WINDOW_EXPAND_COUNT
            )
          };
        });
      }
    };

    const scheduleExpand = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(expandRenderedWindow);
      }
    };

    window.addEventListener("scroll", scheduleExpand, { passive: true });
    window.addEventListener("resize", scheduleExpand);
    window.requestAnimationFrame(expandRenderedWindow);

    return () => {
      window.removeEventListener("scroll", scheduleExpand);
      window.removeEventListener("resize", scheduleExpand);

      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [chapters.length, isReady]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    let frame = 0;

    const updateLocation = () => {
      frame = 0;
      const chapterElements = [
        ...document.querySelectorAll<HTMLElement>(".ec-reader-chapter")
      ];
      const currentChapter = findElementAtChapterUpdateLine(chapterElements);
      const chapterId = currentChapter?.dataset.chapterId;

      if (!hasScrolledToSelectionRef.current || !canReportLocationRef.current) {
        return;
      }

      if (chapterId && chapterId !== lastReportedChapterIdRef.current) {
        lastReportedChapterIdRef.current = chapterId;
        window.localStorage.setItem(READER_POSITION_STORAGE_KEY, chapterId);
        setActiveChapterId(chapterId);
        updateUrl(
          chapterId,
          selectedPassageChapterId === chapterId ? selectedPassage : ""
        );
      }
    };

    const scheduleUpdate = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(updateLocation);
      }
    };

    window.addEventListener("scroll", scheduleUpdate, { passive: true });

    return () => {
      window.removeEventListener("scroll", scheduleUpdate);

      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [isReady, selectedPassage, selectedPassageChapterId]);

  useBrowserLayoutEffect(() => {
    if (!activeChapterId || hasScrolledToSelectionRef.current) {
      return;
    }

    const activeChapterIndex = activeEntry?.index;
    const isTargetWindowReady = typeof activeChapterIndex === "number"
      && renderedEntries.some((entry) => entry.chapter.id === activeChapterId)
      && renderedEntries.every((entry) => (
        entry.index > activeChapterIndex || loadedChapters.has(entry.chapter.id)
      ));

    if (!isTargetWindowReady) {
      return;
    }

    const selectedRangeForActiveChapter =
      selectedPassageChapterId === activeChapterId ? selectedPassage : "";

    const findTarget = () => selectedRangeForActiveChapter
      ? document.querySelector<HTMLElement>(
        `[data-chapter-id="${cssEscape(activeChapterId)}"] [data-passage-range="${cssEscape(selectedRangeForActiveChapter)}"]`
      )
      : document.querySelector<HTMLElement>(
        `[data-chapter-id="${cssEscape(activeChapterId)}"]`
      );

    const scrollToTarget = () => {
      const target = findTarget();

      if (!target) {
        return false;
      }

      window.scrollTo({
        behavior: "auto",
        left: 0,
        top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - HEADER_SCROLL_OFFSET)
      });

      return true;
    };

    let frame = 0;
    let frameCount = 0;
    let didCancel = false;
    let fontsSettled = document.fonts === undefined;

    const finishInitialScroll = () => {
      if (didCancel) {
        return;
      }

      scrollToTarget();
      canReportLocationRef.current = false;
      hasScrolledToSelectionRef.current = true;
      lastReportedChapterIdRef.current = activeChapterId;
    };

    const scheduleScroll = () => {
      if (!frame && !hasScrolledToSelectionRef.current) {
        frame = window.requestAnimationFrame(runScroll);
      }
    };

    const runScroll = () => {
      frame = 0;
      frameCount += 1;

      const foundTarget = scrollToTarget();

      if (
        (foundTarget && fontsSettled && frameCount >= 2)
        || frameCount >= INITIAL_SCROLL_MAX_FRAMES
      ) {
        finishInitialScroll();
        return;
      }

      scheduleScroll();
    };

    scheduleScroll();
    void document.fonts?.ready
      .then(() => {
        fontsSettled = true;
        scheduleScroll();
      })
      .catch(() => {
        fontsSettled = true;
        scheduleScroll();
      });

    return () => {
      didCancel = true;

      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [
    activeChapterId,
    activeEntry?.index,
    loadedChapters,
    renderedEntries,
    selectedPassage,
    selectedPassageChapterId
  ]);

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
      setFocusedPassageKey(String(navigation.formData.get("sourcePassageId") ?? ""));
      setIsSearchOpen(true);
    }
  }, [navigation.formData, navigation.state]);

  useEffect(() => {
    if (actionData?.mode === "similar" && actionData.similarSource) {
      setFocusedPassageKey(actionData.similarSource.id);
      setIsSearchOpen(true);
      return;
    }

    if (actionData?.mode === "similar-scripture" && actionData.similarScriptureSource) {
      setFocusedPassageKey(actionData.similarScriptureSource.id);
      setIsSearchOpen(true);
      return;
    }

    if (actionData?.mode === "theme") {
      setFocusedPassageKey(null);
      setIsSearchOpen(true);
    }
  }, [actionData?.mode, actionData?.similarSource?.id]);

  const openChapter = useCallback((chapterId: string, passageRange = "") => {
    const chapterEntry = chapterById.get(chapterId);

    if (!chapterEntry) {
      return false;
    }

    hasScrolledToSelectionRef.current = false;
    canReportLocationRef.current = false;
    lastReportedChapterIdRef.current = chapterId;
    setRenderedRange(getChapterWindowRange(chapterEntry.index, chapters.length));
    setActiveChapterId(chapterId);
    setSelectedPassage(passageRange);
    setSelectedPassageChapterId(passageRange ? chapterId : "");
    window.localStorage.setItem(READER_POSITION_STORAGE_KEY, chapterId);
    updateUrl(chapterId, passageRange);
    return true;
  }, [chapterById, chapters.length]);

  const openResult = useCallback((result: EarlyChristianSearchResult) => {
    const passageRange = rangeFromResult(result);

    if (openChapter(result.chapterId, passageRange)) {
      setIsSearchOpen(false);
    }
  }, [openChapter]);

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
          style={readerStyle()}
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
        style={readerStyle()}
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
          {!isToolsOpen ? (
            <button
              aria-expanded={false}
              aria-label="Open reader tools"
              className="context-button reader-icon-button reader-tools-trigger"
              onClick={() => setIsToolsOpen(true)}
              title="Open reader tools"
              type="button"
            >
              ⋮
            </button>
          ) : (
            <div className="reader-header-actions">
              <button
                aria-label="Close reader tools"
                className="context-button reader-icon-button reader-tools-close"
                onClick={() => {
                  setIsToolsOpen(false);
                  setIsJumpOpen(false);
                }}
                title="Close reader tools"
                type="button"
              >
                ×
              </button>
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
                  setIsSearchOpen(true);
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
            </div>
          )}
        </header>

        <div className="reader-passages">
          {renderedEntries.map((entry) => {
            const chapter = loadedChapters.get(entry.chapter.id);
            const chapterLoadError = chapterLoadErrors.get(entry.chapter.id);

            return (
              <section
                className="reader-chapter ec-reader-chapter"
                data-chapter-id={entry.chapter.id}
                key={entry.chapter.id}
              >
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
                      {groupChapterPassages(chapter).map((passage) => {
                        const isSelected =
                          selectedPassageChapterId === chapter.id
                          && selectedPassage === passage.rangeLabel;

                        return (
                          <article
                            className={[
                              "reader-passage",
                              isSelected ? "is-selected" : ""
                            ].filter(Boolean).join(" ")}
                            data-passage-key={passage.key}
                            data-passage-range={passage.rangeLabel}
                            key={passage.key}
                          >
                            <button
                              aria-expanded={isSelected}
                              className="reader-passage-button"
                              onClick={() => {
                                const nextRange = isSelected ? "" : passage.rangeLabel;
                                setSelectedPassage(nextRange);
                                setSelectedPassageChapterId(nextRange ? chapter.id : "");
                                updateUrl(chapter.id, nextRange);
                              }}
                              type="button"
                            >
                              <span className="reader-passage-reference">
                                {passage.rangeLabel}
                              </span>
                              <span className="reader-passage-text">
                                <span className="reader-verse">
                                  {passage.text}
                                </span>
                              </span>
                            </button>
                            {isSelected ? (
                              <div className="reader-passage-actions">
                                <Form method="post">
                                  <input type="hidden" name="intent" value="similar-passage" />
                                  <input type="hidden" name="sourcePassageId" value={passage.key} />
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
                                <Form method="post">
                                  <input type="hidden" name="intent" value="similar-scripture" />
                                  <input type="hidden" name="sourcePassageId" value={passage.key} />
                                  <input type="hidden" name="matchCount" value={actionData?.matchCount ?? 10} />
                                  <button
                                    className="context-button"
                                    disabled={isSearching}
                                    type="submit"
                                  >
                                    {isFindingSimilarScripture ? (
                                      <>
                                        <span className="button-spinner" aria-hidden="true" />
                                        Finding Bible
                                      </>
                                    ) : (
                                      "Similar Bible passages"
                                    )}
                                  </button>
                                </Form>
                                {isSearching ? (
                                  <p className="reader-action-status" role="status">
                                    Searching similar passages...
                                  </p>
                                ) : null}
                              </div>
                            ) : null}
                          </article>
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
        <ReaderCorpusSwitch current="fathers" />
      </section>

      {isSearchOpen ? (
        <div
          className={`search-modal-backdrop reader-theme-${readerTheme}`}
          onClick={(event) => {
            event.stopPropagation();

            if (event.target === event.currentTarget) {
              setIsSearchOpen(false);
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
                onClick={() => setIsSearchOpen(false)}
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
                  {focusedPassageKey ? (
                    <>
                      <input
                        type="hidden"
                        name="intent"
                        value={actionData?.mode === "similar-scripture"
                          ? "similar-scripture"
                          : "similar-passage"}
                      />
                      <input type="hidden" name="sourcePassageId" value={focusedPassageKey} />
                    </>
                  ) : null}
                  <input type="hidden" name="matchCount" value={actionData?.matchCount ?? 10} />
                  {!focusedPassageKey ? (
                    <label htmlFor="question">Search early Christian works for...</label>
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
                        className="search-button"
                        disabled={isSearching || !isReady}
                        type="submit"
                      >
                        {isSearching ? (
                          <>
                            <span className="button-spinner" aria-hidden="true" />
                            Searching
                          </>
                        ) : focusedPassageKey ? (
                          "Find similar"
                        ) : (
                          "Search"
                        )}
                      </button>
                      {isSearching ? (
                        <p className="search-status" role="status">
                          Searching early Christian works...
                        </p>
                      ) : null}
                    </div>
                  </div>
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
                isSearching={isSearching}
                onOpenResult={openResult}
                results={actionData?.results}
                showEmptyState={actionData?.mode !== "similar-scripture"}
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
  isSearching,
  onOpenResult,
  results,
  showEmptyState = true
}: {
  isSearching: boolean;
  onOpenResult: (result: EarlyChristianSearchResult) => void;
  results?: EarlyChristianSearchResult[];
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
          const isSelected = selectedResult === result.chapterId;

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
                onClick={() => setSelectedResult(isSelected ? "" : result.chapterId)}
                type="button"
              >
                <span className="result-meta">
                  <span>{result.chapterReference}</span>
                  <span>{result.author ?? result.source.toUpperCase()}</span>
                  <span
                    aria-label={`${result.matchStrength} of 4 match strength`}
                    className="match-dots"
                    title={`${result.matchStrength} of 4 match strength`}
                  >
                    {[1, 2, 3, 4].map((level) => (
                      <span
                        aria-hidden="true"
                        className={level <= result.matchStrength ? "is-active" : undefined}
                        key={level}
                      />
                    ))}
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
                    <input
                      type="hidden"
                      name="sourcePassageId"
                      value={result.highlightPassage.id}
                    />
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
                    <input
                      type="hidden"
                      name="sourcePassageId"
                      value={result.highlightPassage.id}
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
  const [selectedBookId, setSelectedBookId] = useState(activeEntry?.book.id ?? "");
  const selectedBook = chapters.find((entry) => entry.book.id === selectedBookId)?.book
    ?? activeEntry?.book;
  const bookChapters = selectedBook
    ? chapters.filter((entry) => entry.book.id === selectedBook.id)
    : [];

  return (
    <div
      className="passage-jump-backdrop"
      onClick={(event) => {
        event.stopPropagation();

        if (event.target === event.currentTarget) {
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
            <span>Work</span>
            <select
              value={selectedBook?.id ?? ""}
              onChange={(event) => setSelectedBookId(event.target.value)}
            >
              {dedupeBooks(chapters).map((book) => (
                <option key={book.id} value={book.id}>
                  {formatBookOptionLabel(book)}
                </option>
              ))}
            </select>
          </label>

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

function normalizeSortText(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getChapterWindowRange(index: number, count: number) {
  if (count <= 0) {
    return {
      endIndex: -1,
      startIndex: 0
    };
  }

  return {
    endIndex: Math.min(count - 1, index + CHAPTER_WINDOW_AFTER),
    startIndex: Math.max(0, index - CHAPTER_WINDOW_BEFORE)
  };
}

function rangeContainsIndex(
  range: { endIndex: number; startIndex: number },
  index: number
) {
  return range.endIndex >= range.startIndex
    && index >= range.startIndex
    && index <= range.endIndex;
}

function groupChapterPassages(chapter: ChapterAsset): ReaderPassage[] {
  const passages: ReaderPassage[] = [];
  let current: ChapterAsset["verses"] = [];

  for (const verse of chapter.verses) {
    current.push(verse);

    if (current.length >= 3) {
      passages.push(buildReaderPassage(chapter, current));
      current = [];
    }
  }

  if (current.length > 0) {
    if (passages.length > 0 && current.length < 3) {
      const previous = passages.pop();
      const previousVerses = previous
        ? chapter.verses.filter((verse) => (
          verse.verse >= previous.verseStart && verse.verse <= previous.verseEnd
        ))
        : [];
      passages.push(buildReaderPassage(chapter, [...previousVerses, ...current]));
    } else {
      passages.push(buildReaderPassage(chapter, current));
    }
  }

  return passages;
}

function buildReaderPassage(chapter: ChapterAsset, verses: ChapterAsset["verses"]): ReaderPassage {
  const first = verses[0];
  const last = verses[verses.length - 1];
  const rangeLabel = last.verse === first.verse
    ? String(first.verse)
    : `${first.verse}-${last.verse}`;

  return {
    key: `${chapter.id}:${first.verse}-${last.verse}`,
    rangeLabel,
    reference: `${chapter.book} ${chapter.chapter}:${rangeLabel}`,
    text: verses.map((verse) => verse.text.trim()).join(" "),
    verseEnd: last.verse,
    verseStart: first.verse
  };
}

function findLoadedPassage(chapters: Map<string, ChapterAsset>, key: string) {
  const rangeMatch = key.match(/^(.+):(\d+)-(\d+)$/);

  if (!rangeMatch) {
    return null;
  }

  const [, chapterId, verseStart, verseEnd] = rangeMatch;
  const chapter = chapters.get(chapterId);

  if (!chapter) {
    return null;
  }

  return groupChapterPassages(chapter).find((passage) => (
    passage.verseStart === Number(verseStart) && passage.verseEnd === Number(verseEnd)
  )) ?? null;
}

function findElementAtChapterUpdateLine(elements: HTMLElement[]) {
  if (elements.length === 0) {
    return null;
  }

  let firstVisibleElement: HTMLElement | null = null;
  let activeElement: HTMLElement | null = null;

  for (const element of elements) {
    const rect = element.getBoundingClientRect();

    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      continue;
    }

    firstVisibleElement ??= element;

    if (rect.top <= CHAPTER_UPDATE_OFFSET) {
      activeElement = element;
    }
  }

  return activeElement ?? firstVisibleElement;
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

function versionedPreviewUrl(path: string, version: string) {
  const separator = path.includes("?") ? "&" : "?";

  return `${path}${separator}v=${encodeURIComponent(version)}`;
}

function readSavedReaderTheme(): ReaderTheme {
  if (typeof window === "undefined") {
    return "paper";
  }

  try {
    const savedSettings = window.localStorage.getItem(READER_SETTINGS_STORAGE_KEY);

    if (!savedSettings) {
      return "paper";
    }

    const parsedSettings = JSON.parse(savedSettings) as { theme?: unknown };
    return isReaderTheme(parsedSettings.theme) ? parsedSettings.theme : "paper";
  } catch {
    return "paper";
  }
}

function isReaderTheme(value: unknown): value is ReaderTheme {
  return typeof value === "string" && READER_THEMES.includes(value as ReaderTheme);
}

function readerStyle() {
  return {
    "--reader-content-width": "820px",
    "--reader-font-scale": 1,
    "--reader-line-height": 1.72
  } as CSSProperties;
}

function churchFathersScriptureActionData(
  actionData: ChurchFathersActionData | undefined
): SearchActionData | undefined {
  if (!actionData?.scriptureResults) {
    return undefined;
  }

  return {
    matchCount: actionData.matchCount,
    mode: "similar",
    results: actionData.scriptureResults,
    similarSource: actionData.similarScriptureSource
      ? {
        id: actionData.similarScriptureSource.id,
        reference: actionData.similarScriptureSource.reference
      }
      : undefined
  };
}

function withScriptureMatchStrength(results: Array<Omit<SearchResult, "matchStrength">>) {
  const scores = results
    .map((result) => result.score)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  const min = scores.length ? Math.min(...scores) : null;
  const max = scores.length ? Math.max(...scores) : null;
  const spread = min !== null && max !== null ? max - min : 0;
  const denominator = Math.max(results.length - 1, 1);

  return results.map((result, index) => {
    let matchStrength = Math.max(1, 4 - Math.floor((index / denominator) * 4));

    if (typeof result.score === "number" && Number.isFinite(result.score)) {
      matchStrength = spread > 0
        ? 1 + Math.round(((result.score - (min ?? result.score)) / spread) * 3)
        : 4;
    }

    return {
      ...result,
      matchStrength: Math.max(1, Math.min(4, matchStrength))
    };
  });
}

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
