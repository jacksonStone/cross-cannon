import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  createReaderLocation,
  readReaderLocation,
  readReaderPosition,
  readerLocationKey,
  rememberReaderLocation
} from "~/features/reader-position/reader-position";
import {
  DEFAULT_READER_SCROLL_WINDOW,
  useAnchoredReaderWindow,
  useReaderHeaderOffset
} from "~/features/reader-window/useReaderWindow";

import {
  findChapterBookStartIndex,
  flattenChapters,
  getChapterWindowRange,
  resolveActiveChapterId
} from "./book-index";
import { findPassageTargetInChapter } from "./reader-passages";
import type { BookIndex, ChapterAsset, ChapterEntry } from "./types";

const CHAPTER_WINDOW_BEFORE = DEFAULT_READER_SCROLL_WINDOW.initialBefore;
const CHAPTER_WINDOW_AFTER = DEFAULT_READER_SCROLL_WINDOW.initialAfter;
const INITIAL_SCROLL_MAX_FRAMES = DEFAULT_READER_SCROLL_WINDOW.initialScrollMaxFrames;
const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export type EarlyChristianReaderNavigationState = {
  activeChapterId: string;
  selectedPassage: string;
  selectedPassageChapterId: string;
  targetChapterId: string;
  targetPassageRange: string;
};

type InitialReaderNavigationOptions = {
  initialChapterId: string;
  initialPassageRange: string;
  storedChapterId: string;
  storedPassageRange: string;
};

export function createInitialEarlyChristianReaderNavigation({
  initialChapterId,
  initialPassageRange,
  storedChapterId,
  storedPassageRange
}: InitialReaderNavigationOptions): EarlyChristianReaderNavigationState {
  const initialActiveChapterId = initialChapterId || storedChapterId;
  const initialSelectedPassage = initialPassageRange || (
    initialChapterId ? "" : storedPassageRange
  );

  return {
    activeChapterId: initialActiveChapterId,
    selectedPassage: initialSelectedPassage,
    selectedPassageChapterId: initialSelectedPassage ? initialActiveChapterId : "",
    targetChapterId: initialActiveChapterId,
    targetPassageRange: initialSelectedPassage
  };
}

export function createEarlyChristianReaderOpenState({
  chapterId,
  passageRange
}: {
  chapterId: string;
  passageRange: string;
}): EarlyChristianReaderNavigationState {
  return {
    activeChapterId: chapterId,
    selectedPassage: passageRange,
    selectedPassageChapterId: passageRange ? chapterId : "",
    targetChapterId: chapterId,
    targetPassageRange: passageRange
  };
}

export function resolveEarlyChristianReaderNavigation({
  chapters,
  initialChapterId,
  navigationState
}: {
  chapters: ChapterEntry[];
  initialChapterId: string;
  navigationState: EarlyChristianReaderNavigationState;
}) {
  const chapterById = new Map(chapters.map((entry) => [entry.chapter.id, entry]));
  const resolvedActiveChapterId = resolveActiveChapterId({
    activeChapterId: navigationState.activeChapterId,
    chapterById,
    chapters,
    initialChapterId
  });
  const activeEntry = resolvedActiveChapterId
    ? chapterById.get(resolvedActiveChapterId)
    : undefined;
  const resolvedTargetChapterId =
    navigationState.targetChapterId && chapterById.has(navigationState.targetChapterId)
      ? navigationState.targetChapterId
      : resolvedActiveChapterId;
  const targetEntry = resolvedTargetChapterId
    ? chapterById.get(resolvedTargetChapterId)
    : undefined;
  const targetChapterIndex = targetEntry?.index;
  const initialWindowRange = typeof targetChapterIndex === "number"
    ? getChapterWindowRange(targetChapterIndex, chapters, {
      after: CHAPTER_WINDOW_AFTER,
      before: CHAPTER_WINDOW_BEFORE
    })
    : { endIndex: -1, startIndex: 0 };
  const activeChapterIndex = activeEntry?.index;
  const activeBookStartIndex = findChapterBookStartIndex(activeChapterIndex ?? -1, chapters);
  const selectedRangeForTargetChapter =
    navigationState.selectedPassageChapterId === resolvedTargetChapterId
      ? navigationState.selectedPassage
      : navigationState.targetPassageRange;

  return {
    activeBookStartIndex,
    activeChapterIndex,
    activeEntry,
    chapterById,
    initialWindowRange,
    readerWindowResetKey: `${resolvedTargetChapterId}|${navigationState.targetPassageRange}`,
    resolvedActiveChapterId,
    resolvedTargetChapterId,
    selectedRangeForTargetChapter,
    targetChapterIndex
  };
}

export function isEarlyChristianReaderTargetWindowReady({
  chapters,
  loadedChapters,
  resolvedTargetChapterId,
  targetChapterIndex,
  windowRange
}: {
  chapters: ChapterEntry[];
  loadedChapters: Map<string, ChapterAsset>;
  resolvedTargetChapterId: string;
  targetChapterIndex: number | undefined;
  windowRange: { endIndex: number; startIndex: number };
}) {
  if (!resolvedTargetChapterId || typeof targetChapterIndex !== "number") {
    return false;
  }

  const targetWindowEntries = windowRange.endIndex >= windowRange.startIndex
    ? chapters.slice(
      Math.max(0, windowRange.startIndex),
      windowRange.endIndex + 1
    )
    : [];

  return targetWindowEntries.some((entry) => entry.chapter.id === resolvedTargetChapterId)
    && targetWindowEntries.every((entry) => (
      entry.index > targetChapterIndex || loadedChapters.has(entry.chapter.id)
    ));
}

export function updateEarlyChristianReaderUrl(chapterId: string, passageRange = "") {
  const params = new URLSearchParams();

  if (chapterId) {
    params.set("chapter", chapterId);
  }

  if (passageRange) {
    params.set("passage", passageRange);
  }

  window.history.replaceState(null, "", `/church-fathers?${params.toString()}`);
}

export function useEarlyChristianReaderNavigation({
  bookIndex,
  initialChapterId,
  initialPassageRange,
  loadedChapters,
  positionStorageKey,
  replaceUrl = updateEarlyChristianReaderUrl
}: {
  bookIndex: BookIndex | null;
  initialChapterId: string;
  initialPassageRange: string;
  loadedChapters: Map<string, ChapterAsset>;
  positionStorageKey: string;
  replaceUrl?: (chapterId: string, passageRange?: string) => void;
}) {
  const savedReaderLocation = readReaderLocation(positionStorageKey, "fathers");
  const initialStoredChapterId =
    savedReaderLocation?.chapterKey ?? readReaderPosition(positionStorageKey);
  const savedReaderPositionRef = useRef(readerLocationKey(savedReaderLocation));
  const lastAppliedInitialTargetRef = useRef("");
  const lastReportedChapterIdRef = useRef(savedReaderPositionRef.current);
  const readerHeaderOffset = useReaderHeaderOffset();
  const chapters = useMemo(() => flattenChapters(bookIndex), [bookIndex]);
  const [navigationState, setNavigationState] = useState(() => (
    createInitialEarlyChristianReaderNavigation({
      initialChapterId,
      initialPassageRange,
      storedChapterId: initialStoredChapterId,
      storedPassageRange: savedReaderLocation?.passageRange ?? ""
    })
  ));
  const navigationPlan = useMemo(() => (
    resolveEarlyChristianReaderNavigation({
      chapters,
      initialChapterId,
      navigationState
    })
  ), [chapters, initialChapterId, navigationState]);
  const isReady = Boolean(bookIndex && navigationPlan.activeEntry);
  const isTargetWindowReady = isEarlyChristianReaderTargetWindowReady({
    chapters,
    loadedChapters,
    resolvedTargetChapterId: navigationPlan.resolvedTargetChapterId,
    targetChapterIndex: navigationPlan.targetChapterIndex,
    windowRange: navigationPlan.initialWindowRange
  });
  const rememberReaderChapter = useCallback((chapterId: string, passageRange = "") => {
    rememberReaderLocation(positionStorageKey, createReaderLocation({
      chapterKey: chapterId,
      corpus: "fathers",
      passageRange: passageRange || undefined
    }), {
      lastReportedRef: lastReportedChapterIdRef,
      savedRef: savedReaderPositionRef
    });
  }, [positionStorageKey]);
  const findInitialChapterTarget = useCallback(() => {
    if (!navigationPlan.resolvedTargetChapterId) {
      return null;
    }

    const chapterElement = document.querySelector<HTMLElement>(
      `[data-chapter-id="${cssEscape(navigationPlan.resolvedTargetChapterId)}"]`
    );

    if (!chapterElement || !navigationPlan.selectedRangeForTargetChapter) {
      return chapterElement;
    }

    return findPassageTargetInChapter(
      chapterElement,
      navigationPlan.selectedRangeForTargetChapter
    ) ?? chapterElement;
  }, [
    navigationPlan.resolvedTargetChapterId,
    navigationPlan.selectedRangeForTargetChapter
  ]);
  const updateActiveChapterFromScroll = useCallback((chapterId: string) => {
    rememberReaderChapter(chapterId);
    setNavigationState((current) => ({
      ...current,
      activeChapterId: chapterId
    }));
  }, [rememberReaderChapter]);
  const getRenderedChapterId = useCallback((element: HTMLElement) => (
    element.dataset.chapterId
  ), []);
  const resetReaderWindow = useCallback(() => {
    setNavigationState((current) => ({
      ...current,
      selectedPassage: current.targetPassageRange,
      selectedPassageChapterId: current.targetPassageRange
        && navigationPlan.resolvedTargetChapterId
        ? navigationPlan.resolvedTargetChapterId
        : ""
    }));
  }, [navigationPlan.resolvedTargetChapterId]);
  const { renderedRange, setRenderedRange } = useAnchoredReaderWindow({
    activeKey: navigationPlan.resolvedActiveChapterId,
    chapterSelector: ".ec-reader-chapter",
    edgePx: DEFAULT_READER_SCROLL_WINDOW.edgePx,
    expandCount: DEFAULT_READER_SCROLL_WINDOW.expandCount,
    findInitialTarget: findInitialChapterTarget,
    getChapterKey: getRenderedChapterId,
    headerOffset: readerHeaderOffset,
    initialActiveKey: navigationPlan.resolvedTargetChapterId,
    initialRange: navigationPlan.initialWindowRange,
    initialScrollMaxFrames: INITIAL_SCROLL_MAX_FRAMES,
    initialScrollReady: isReady && isTargetWindowReady,
    itemCount: chapters.length,
    minStartIndex: navigationPlan.activeBookStartIndex,
    minReadingAnchorOffset: DEFAULT_READER_SCROLL_WINDOW.minReadingAnchorOffset,
    onActiveKeyChange: updateActiveChapterFromScroll,
    onReset: resetReaderWindow,
    passageSelector: ".ec-reader-chapter .reader-passage",
    readingAnchorRatio: DEFAULT_READER_SCROLL_WINDOW.readingAnchorRatio,
    resetKey: navigationPlan.readerWindowResetKey,
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
  const openChapter = useCallback((chapterId: string, passageRange = "") => {
    const chapterEntry = navigationPlan.chapterById.get(chapterId);

    if (!chapterEntry) {
      return false;
    }

    setRenderedRange(getChapterWindowRange(chapterEntry.index, chapters, {
      after: CHAPTER_WINDOW_AFTER,
      before: CHAPTER_WINDOW_BEFORE
    }));
    setNavigationState(createEarlyChristianReaderOpenState({
      chapterId,
      passageRange
    }));
    rememberReaderChapter(chapterId, passageRange);
    replaceUrl(chapterId, passageRange);
    return true;
  }, [
    chapters,
    navigationPlan.chapterById,
    rememberReaderChapter,
    replaceUrl,
    setRenderedRange
  ]);
  const selectPassage = useCallback((chapterId: string, passageRange = "") => {
    setNavigationState((current) => ({
      ...current,
      selectedPassage: passageRange,
      selectedPassageChapterId: passageRange ? chapterId : ""
    }));
    replaceUrl(chapterId, passageRange);
  }, [replaceUrl]);

  useBrowserLayoutEffect(() => {
    if (!bookIndex) {
      return;
    }

    if (
      navigationPlan.resolvedActiveChapterId
      && navigationPlan.chapterById.has(navigationPlan.resolvedActiveChapterId)
      && navigationState.activeChapterId !== navigationPlan.resolvedActiveChapterId
    ) {
      setNavigationState((current) => ({
        ...current,
        activeChapterId: navigationPlan.resolvedActiveChapterId,
        selectedPassage: "",
        selectedPassageChapterId: "",
        targetChapterId: navigationPlan.resolvedActiveChapterId,
        targetPassageRange: ""
      }));
      rememberReaderChapter(navigationPlan.resolvedActiveChapterId);
    }
  }, [
    bookIndex,
    navigationPlan.chapterById,
    navigationPlan.resolvedActiveChapterId,
    navigationState.activeChapterId,
    rememberReaderChapter
  ]);

  useBrowserLayoutEffect(() => {
    if (
      !bookIndex
      || !initialChapterId
      || !navigationPlan.chapterById.has(initialChapterId)
    ) {
      return;
    }

    const initialTargetKey = `${initialChapterId}|${initialPassageRange}`;

    if (lastAppliedInitialTargetRef.current === initialTargetKey) {
      return;
    }

    lastAppliedInitialTargetRef.current = initialTargetKey;
    setNavigationState(createEarlyChristianReaderOpenState({
      chapterId: initialChapterId,
      passageRange: initialPassageRange
    }));
    rememberReaderChapter(initialChapterId, initialPassageRange);
  }, [
    bookIndex,
    initialChapterId,
    initialPassageRange,
    navigationPlan.chapterById,
    rememberReaderChapter
  ]);

  return {
    activeChapterIndex: navigationPlan.activeChapterIndex,
    activeEntry: navigationPlan.activeEntry,
    chapters,
    isReady,
    openChapter,
    renderedEntries,
    resolvedActiveChapterId: navigationPlan.resolvedActiveChapterId,
    selectPassage,
    selectedPassage: navigationState.selectedPassage,
    selectedPassageChapterId: navigationState.selectedPassageChapterId
  };
}

function cssEscape(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}
