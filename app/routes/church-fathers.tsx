import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from "react";

import type { MetaFunction } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation } from "@remix-run/react";

import {
  type EarlyChristianReaderTextMode as ReaderTextMode,
  findLoadedPassage,
  findPassageTargetInChapter
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
  EARLY_CHRISTIAN_READER_POSITION_STORAGE_KEY
} from "~/features/early-christian-preview/preview-cache";
import {
  findChapterBookStartIndex,
  flattenChapters,
  getChapterWindowRange,
  MAX_AUTHOR_FILTERS,
  resolveActiveChapterId,
  SEARCH_EXAMPLES
} from "~/features/early-christian-reader/book-index";
import {
  normalizeEarlyChristianAudio
} from "~/features/early-christian-reader/chapter-assets";
import { ChapterList } from "~/features/early-christian-reader/ChapterList";
import { ChapterJump } from "~/features/early-christian-reader/ChapterJump";
import {
  churchFathersAction,
  churchFathersLoader
} from "~/features/early-christian-reader/route.server";
import { EarlyChristianReaderHeader } from "~/features/early-christian-reader/ReaderHeader";
import { SearchDialog } from "~/features/early-christian-reader/SearchDialog";
import {
  useEarlyChristianBookIndex,
  useEarlyChristianChapterAssets,
  useRenderedChapterAssetLoader
} from "~/features/early-christian-reader/useEarlyChristianReaderAssets";
import {
  DEFAULT_READER_SCROLL_WINDOW,
  useAnchoredReaderWindow,
  useReaderHeaderOffset
} from "~/features/reader-window/useReaderWindow";
import {
  BOOKS_BY_CANON,
  DEFAULT_CANON,
  DEFAULT_MATCH_COUNT
} from "~/features/search/canons";
import {
  readerSettingsStyle
} from "~/features/reader-settings/reader-settings";
import { useStoredReaderSettings } from "~/features/reader-ui/ReaderControls";
import {
  initialSearchModalFlowState,
  searchModalFlowReducer
} from "~/features/search/search-modal-flow";
import type {
  CanonMode,
  SearchTargetCorpus
} from "~/features/search/types";
import { useScriptureLibrary } from "~/features/scripture/useScriptureLibrary";
import {
  type EarlyChristianSearchResult,
} from "~/lib/early-christian-search.server";
import {
  useEscapeDismiss
} from "~/lib/use-dialog-dismiss";
import { useModalScrollLock } from "~/lib/use-modal-scroll-lock";

const MANIFEST_URL = EARLY_CHRISTIAN_MANIFEST_URL;
const PREVIEW_ASSET_VERSION = EARLY_CHRISTIAN_PREVIEW_ASSET_VERSION;
const READER_POSITION_STORAGE_KEY = EARLY_CHRISTIAN_READER_POSITION_STORAGE_KEY;
const CHAPTER_WINDOW_BEFORE = DEFAULT_READER_SCROLL_WINDOW.initialBefore;
const CHAPTER_WINDOW_AFTER = DEFAULT_READER_SCROLL_WINDOW.initialAfter;
const INITIAL_SCROLL_MAX_FRAMES = DEFAULT_READER_SCROLL_WINDOW.initialScrollMaxFrames;
const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

type ChapterAudioPlayback = {
  audio: NonNullable<ReturnType<typeof normalizeEarlyChristianAudio>>;
  key: string;
  preferContinuous?: boolean;
};

type ChapterAudioPlaybackResult = "continued" | "loaded" | null;

export const meta: MetaFunction = () => [
  { title: "Early Christian Reader | Cross Canon" },
  {
    name: "description",
    content: "Read and search early Christian works in chapter context."
  }
];

export const loader = churchFathersLoader;
export const action = churchFathersAction;

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
  const { bookIndex, loadError } = useEarlyChristianBookIndex({
    manifestUrl,
    previewAssetVersion
  });
  const {
    chapterLoadErrors,
    loadedChapters,
    setChapterLoadErrors,
    setLoadedChapters
  } = useEarlyChristianChapterAssets(previewAssetVersion);
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
  const isToolsOpenRef = useRef(isToolsOpen);
  const lastAppliedInitialTargetRef = useRef("");
  const lastReportedChapterIdRef = useRef(savedReaderPositionRef.current);
  const playingAudioEndSecondsRef = useRef<number | null>(null);
  const suppressNextAudioPauseRef = useRef(false);
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
      ? getChapterWindowRange(targetChapterIndex, chapters, {
        after: CHAPTER_WINDOW_AFTER,
        before: CHAPTER_WINDOW_BEFORE
      })
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
    ? normalizeEarlyChristianAudio(activeEntry.chapter.audio)
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
  useRenderedChapterAssetLoader({
    activeChapterIndex,
    bookIndex,
    chapterLoadErrors,
    loadedChapters,
    previewAssetVersion,
    renderedEntries,
    setChapterLoadErrors,
    setLoadedChapters
  });
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

  const openChapter = useCallback((chapterId: string, passageRange = "") => {
    const chapterEntry = chapterById.get(chapterId);

    if (!chapterEntry) {
      return false;
    }

    setRenderedRange(getChapterWindowRange(chapterEntry.index, chapters, {
      after: CHAPTER_WINDOW_AFTER,
      before: CHAPTER_WINDOW_BEFORE
    }));
    setActiveChapterId(chapterId);
    setTargetChapterId(chapterId);
    setTargetPassageRange(passageRange);
    setSelectedPassage(passageRange);
    setSelectedPassageChapterId(passageRange ? chapterId : "");
    rememberReaderChapter(chapterId, passageRange);
    updateUrl(chapterId, passageRange);
    return true;
  }, [chapterById, chapters, rememberReaderChapter]);

  const playChapterAudio = useCallback(({
    audio: chapterAudio,
    key,
    preferContinuous = false
  }: ChapterAudioPlayback): ChapterAudioPlaybackResult => {
    const audio = audioRef.current;

    if (!audio) {
      return null;
    }

    const nextAudioUrl = new URL(chapterAudio.url, window.location.href).href;
    const canContinueCurrentSource = preferContinuous && audio.currentSrc === nextAudioUrl;
    playingAudioEndSecondsRef.current = chapterAudio.endSeconds ?? null;

    if (canContinueCurrentSource) {
      setPlayingAudioKey(key);

      if (audio.paused) {
        try {
          audio.currentTime = Math.max(0, chapterAudio.startSeconds ?? 0);
        } catch {
          // Some browsers reject seeking until enough metadata is available.
        }

        void audio.play()
          .then(() => setPlayingAudioKey(key))
          .catch(() => {
            playingAudioEndSecondsRef.current = null;
            setPlayingAudioKey(null);
          });
      }

      return "continued";
    }

    audio.src = chapterAudio.url;
    audio.load();

    const playFromOffset = () => {
      try {
        audio.currentTime = Math.max(0, chapterAudio.startSeconds ?? 0);
      } catch {
        // Some browsers reject seeking until enough metadata is available.
      }

      void audio.play()
        .then(() => setPlayingAudioKey(key))
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

    return "loaded";
  }, []);

  const playNextChapterAudio = useCallback(() => {
    if (typeof activeChapterIndex !== "number") {
      return null;
    }

    const nextEntry = chapters[activeChapterIndex + 1];
    const nextAudio = normalizeEarlyChristianAudio(nextEntry?.chapter.audio);

    if (!nextEntry || !nextAudio) {
      return null;
    }

    openChapter(nextEntry.chapter.id);
    return playChapterAudio({
      audio: nextAudio,
      key: `${nextAudio.url}#${nextAudio.startSeconds ?? 0}`,
      preferContinuous: true
    });
  }, [activeChapterIndex, chapters, openChapter, playChapterAudio]);

  const toggleActiveChapterAudio = useCallback(() => {
    const audio = audioRef.current;

    if (!audio || !activeAudio || !activeAudioKey) {
      return;
    }

    if (isActiveChapterPlaying) {
      audio.pause();
      playingAudioEndSecondsRef.current = null;
      setPlayingAudioKey(null);
      return;
    }

    playChapterAudio({
      audio: activeAudio,
      key: activeAudioKey
    });
  }, [activeAudio, activeAudioKey, isActiveChapterPlaying, playChapterAudio]);

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
    rememberReaderCorpus("fathers");
  }, []);

  useBrowserLayoutEffect(() => {
    isToolsOpenRef.current = isToolsOpen;
  }, [isToolsOpen]);

  useBrowserLayoutEffect(() => {
    const container = headerTitleRef.current;
    const title = readerTitleRef.current;

    if (!container || !title || isToolsOpen) {
      return;
    }

    let frameId = 0;
    let didCancel = false;
    const fitTitle = () => {
      if (didCancel || isToolsOpenRef.current) {
        return;
      }

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

    scheduleFit();
    void document.fonts?.ready.then(scheduleFit).catch(() => undefined);

    return () => {
      didCancel = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [activeHeaderTitle, isToolsOpen]);

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
        <EarlyChristianReaderHeader
          activeAudio={activeAudio}
          activeAudioUrl={activeAudioUrl}
          activeHeaderTitle={activeHeaderTitle}
          audioRef={audioRef}
          headerTitleRef={headerTitleRef}
          isActiveChapterPlaying={isActiveChapterPlaying}
          isToolsOpen={isToolsOpen}
          onAudioEnded={() => {
            const playbackResult = playNextChapterAudio();

            if (playbackResult) {
              suppressNextAudioPauseRef.current = playbackResult === "loaded";
              return;
            }

            playingAudioEndSecondsRef.current = null;
            setPlayingAudioKey(null);
          }}
          onAudioPause={() => {
            if (suppressNextAudioPauseRef.current) {
              suppressNextAudioPauseRef.current = false;
              return;
            }

            playingAudioEndSecondsRef.current = null;
            setPlayingAudioKey(null);
          }}
          onAudioTimeUpdate={(event) => {
            const endSeconds = playingAudioEndSecondsRef.current;

            if (!endSeconds || event.currentTarget.currentTime < endSeconds) {
              return;
            }

            const playbackResult = playNextChapterAudio();

            if (playbackResult) {
              suppressNextAudioPauseRef.current = playbackResult === "loaded";
              return;
            }

            event.currentTarget.pause();
            playingAudioEndSecondsRef.current = null;
            setPlayingAudioKey(null);
          }}
          onCloseTools={() => {
            setIsToolsOpen(false);
            setIsJumpOpen(false);
          }}
          onOpenJump={() => {
            setIsToolsOpen(false);
            setIsJumpOpen(true);
          }}
          onOpenSearch={() => {
            setIsToolsOpen(false);
            openSearch();
          }}
          onOpenTools={() => setIsToolsOpen(true)}
          readerSettings={readerSettings}
          readerTitleRef={readerTitleRef}
          setReaderSettings={setReaderSettings}
          toggleActiveChapterAudio={toggleActiveChapterAudio}
        />

        <ChapterList
          chapterLoadErrors={chapterLoadErrors}
          chapters={chapters}
          isFindingSimilarFathers={isFindingSimilarFathers}
          isSearching={isSearching}
          loadedChapters={loadedChapters}
          readerTextMode={readerTextMode}
          renderedEntries={renderedEntries}
          selectedAuthorFilters={selectedAuthorFilters}
          selectedPassage={selectedPassage}
          selectedPassageChapterId={selectedPassageChapterId}
          setChapterLoadErrors={setChapterLoadErrors}
          setSelectedPassage={setSelectedPassage}
          setSelectedPassageChapterId={setSelectedPassageChapterId}
          updateUrl={updateUrl}
        />
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
        <SearchDialog
          actionData={actionData}
          activeFilterCount={activeFilterCount}
          authorOptions={authorOptions}
          canon={canon}
          closeSearch={closeSearch}
          examplePlaceholder={SEARCH_EXAMPLES[exampleIndex]}
          focusedPassage={focusedPassage}
          focusedPassageKey={focusedPassageKey}
          isAuthorFilterOpen={isAuthorFilterOpen}
          isReady={isReady}
          isSearching={isSearching}
          matchCount={matchCount}
          onCanonChange={updateCanon}
          onClearFilters={clearAuthorFilters}
          onCloseAuthorFilters={() => setIsAuthorFilterOpen(false)}
          onMatchCountChange={setMatchCount}
          onOpenAuthorFilters={() => setIsAuthorFilterOpen(true)}
          onOpenResult={openResult}
          onSetFocusedPassageKey={setFocusedPassageKey}
          onTargetCorpusChange={setThemeCorpus}
          onToggleBook={toggleSelectedBook}
          onToggleEarlyChristianAuthor={toggleSelectedAuthor}
          passageLookup={scriptureLibrary.passageLookup}
          readerTheme={readerTheme}
          searchIntent={searchIntent}
          selectedAuthorFilters={selectedAuthorFilters}
          selectedBooksForCanon={selectedBooksForCanon}
          showAuthorFilters={showAuthorFilters}
          showScriptureFilters={showScriptureFilters}
          themeCorpus={themeCorpus}
          visibleScriptureBooks={visibleScriptureBooks}
        />
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

function cssEscape(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}
