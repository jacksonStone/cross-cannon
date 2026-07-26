import {
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";

import {
  expandWindowEnd,
  expandWindowStart,
  getCenteredWindowRange,
  type WindowRange
} from "./window-range";
import { shouldPreserveReaderAnchorOnResize } from "./reader-resize";

type PrependSnapshot = {
  scrollHeight: number;
  scrollY: number;
};

type ReadingAnchorOptions = {
  headerOffset: number;
  minReadingAnchorOffset: number;
  readingAnchorRatio: number;
};

type ReadingAnchorSnapshot = {
  attribute: string;
  key: string;
  offsetRatio: number;
  selector: string;
};

const READING_ANCHOR_KEY_ATTRIBUTES = [
  "data-passage-id",
  "data-passage-key",
  "data-chapter-key",
  "data-chapter-id"
] as const;

const DEFAULT_READER_SCROLL_WINDOW = {
  edgePx: 2200,
  expandCount: 10,
  headerOffset: 118,
  initialAfter: 24,
  initialBefore: 10,
  initialScrollMaxFrames: 8,
  minReadingAnchorOffset: 220,
  readingAnchorRatio: 0.38
} as const;
const READER_RESIZE_PREPARE_MS = 600;
const READER_RESIZE_SETTLE_MS = 180;

const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function readReaderHeaderOffset({
  fallback = DEFAULT_READER_SCROLL_WINDOW.headerOffset,
  rootSelector = ".reader-page"
}: {
  fallback?: number;
  rootSelector?: string;
} = {}) {
  if (typeof window === "undefined") {
    return fallback;
  }

  const root = document.querySelector<HTMLElement>(rootSelector);
  const rawValue = root
    ? window.getComputedStyle(root).getPropertyValue("--reader-header-offset").trim()
    : "";
  const parsedValue = Number.parseFloat(rawValue);

  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function useReaderHeaderOffset({
  fallback = DEFAULT_READER_SCROLL_WINDOW.headerOffset,
  rootSelector = ".reader-page"
}: {
  fallback?: number;
  rootSelector?: string;
} = {}) {
  const [headerOffset, setHeaderOffset] = useState(fallback);

  useEffect(() => {
    const updateHeaderOffset = () => {
      setHeaderOffset(readReaderHeaderOffset({ fallback, rootSelector }));
    };

    updateHeaderOffset();
    window.addEventListener("resize", updateHeaderOffset);
    window.visualViewport?.addEventListener("resize", updateHeaderOffset);

    return () => {
      window.removeEventListener("resize", updateHeaderOffset);
      window.visualViewport?.removeEventListener("resize", updateHeaderOffset);
    };
  }, [fallback, rootSelector]);

  return headerOffset;
}

function useAnchoredReaderWindow({
  activeKey,
  chapterSelector,
  edgePx,
  expandCount,
  findInitialTarget,
  getChapterKey,
  headerOffset,
  initialActiveKey,
  initialRange,
  initialScrollMaxFrames,
  initialScrollReady,
  itemCount,
  minReadingAnchorOffset,
  minStartIndex,
  onActiveKeyChange,
  onInitialScrollSettled,
  onMissingInitialTarget,
  onReset,
  passageSelector = ".reader-passage",
  readingAnchorRatio,
  resetKey,
  trackingReady = true,
  windowReady = true
}: {
  activeKey: string | null;
  chapterSelector: string;
  edgePx: number;
  expandCount: number;
  findInitialTarget: () => HTMLElement | null;
  getChapterKey: (element: HTMLElement) => string | null | undefined;
  headerOffset: number;
  initialActiveKey: string | null;
  initialRange: WindowRange;
  initialScrollMaxFrames: number;
  initialScrollReady: boolean;
  itemCount: number;
  minReadingAnchorOffset: number;
  minStartIndex?: number;
  onActiveKeyChange: (key: string) => void;
  onInitialScrollSettled?: () => void;
  onMissingInitialTarget?: () => void;
  onReset?: () => void;
  passageSelector?: string;
  readingAnchorRatio: number;
  resetKey: string;
  trackingReady?: boolean;
  windowReady?: boolean;
}) {
  const activeKeyRef = useRef<string | null>(initialActiveKey);
  const hasScrolledToInitialTargetRef = useRef(false);
  const prependSnapshotRef = useRef<PrependSnapshot | null>(null);
  const [hasCompletedInitialScroll, setHasCompletedInitialScroll] = useState(false);
  const [renderedRange, setRenderedRange] = useState(initialRange);

  useBrowserLayoutEffect(() => {
    activeKeyRef.current = initialActiveKey;
    hasScrolledToInitialTargetRef.current = false;
    prependSnapshotRef.current = null;
    setHasCompletedInitialScroll(false);
    setRenderedRange(initialRange);
    onReset?.();
  }, [
    initialActiveKey,
    initialRange.endIndex,
    initialRange.startIndex,
    onReset,
    resetKey
  ]);

  useEffect(() => {
    activeKeyRef.current = activeKey;
  }, [activeKey]);

  const finishInitialScroll = useCallback(() => {
    hasScrolledToInitialTargetRef.current = true;
    setHasCompletedInitialScroll(true);
    onInitialScrollSettled?.();
  }, [onInitialScrollSettled]);
  const isLocationTrackingReady = trackingReady && hasCompletedInitialScroll;

  useReaderScrollWindow({
    activeKeyRef,
    chapterSelector,
    edgePx,
    expandCount,
    findInitialTarget,
    getChapterKey,
    hasScrolledToInitialTargetRef,
    headerOffset,
    initialScrollMaxFrames,
    initialScrollReady,
    itemCount,
    minStartIndex,
    minReadingAnchorOffset,
    onActiveKeyChange,
    onInitialScrollSettled: finishInitialScroll,
    onMissingInitialTarget,
    passageSelector,
    prependSnapshotRef,
    readingAnchorRatio,
    setRange: setRenderedRange,
    startIndex: renderedRange.startIndex,
    trackingReady: isLocationTrackingReady,
    windowReady: windowReady && hasCompletedInitialScroll
  });

  return {
    activeKeyRef,
    hasCompletedInitialScroll,
    renderedRange,
    setRenderedRange
  };
}

export function useScriptureReaderWindow({
  activeChapterKey,
  initialChapterIndex,
  initialChapterKey,
  initialPassageId,
  isReady,
  itemCount,
  onActiveChapterChange,
  onMissingInitialPassage,
  onReset
}: {
  activeChapterKey: string | null;
  initialChapterIndex: number;
  initialChapterKey: string | null;
  initialPassageId: string;
  isReady: boolean;
  itemCount: number;
  onActiveChapterChange: (chapterKey: string) => void;
  onMissingInitialPassage?: () => void;
  onReset?: () => void;
}) {
  const headerOffset = useReaderHeaderOffset();
  const initialRange = getCenteredWindowRange({
    after: DEFAULT_READER_SCROLL_WINDOW.initialAfter,
    before: DEFAULT_READER_SCROLL_WINDOW.initialBefore,
    count: itemCount,
    index: initialChapterIndex
  });
  const findInitialPassageTarget = useCallback(
    () => findRenderedPassageElement(initialPassageId),
    [initialPassageId]
  );
  const getRenderedChapterKey = useCallback((element: HTMLElement) => (
    element.dataset.chapterKey
  ), []);

  return useAnchoredReaderWindow({
    activeKey: activeChapterKey,
    chapterSelector: ".reader-chapter",
    edgePx: DEFAULT_READER_SCROLL_WINDOW.edgePx,
    expandCount: DEFAULT_READER_SCROLL_WINDOW.expandCount,
    findInitialTarget: findInitialPassageTarget,
    getChapterKey: getRenderedChapterKey,
    headerOffset,
    initialActiveKey: initialChapterKey,
    initialRange,
    initialScrollMaxFrames: DEFAULT_READER_SCROLL_WINDOW.initialScrollMaxFrames,
    initialScrollReady: isReady && itemCount > 0,
    itemCount,
    minReadingAnchorOffset: DEFAULT_READER_SCROLL_WINDOW.minReadingAnchorOffset,
    onActiveKeyChange: onActiveChapterChange,
    onMissingInitialTarget: onMissingInitialPassage,
    onReset,
    readingAnchorRatio: DEFAULT_READER_SCROLL_WINDOW.readingAnchorRatio,
    resetKey: `${initialPassageId}|${initialChapterKey ?? ""}`,
    trackingReady: true,
    windowReady: isReady
  });
}

export function useEarlyChristianReaderWindow({
  activeChapterId,
  initialChapterId,
  initialPassageRange,
  initialRange,
  isReady,
  isTargetWindowReady,
  itemCount,
  minStartIndex,
  onActiveChapterChange,
  onReset
}: {
  activeChapterId: string;
  initialChapterId: string;
  initialPassageRange: string;
  initialRange: WindowRange;
  isReady: boolean;
  isTargetWindowReady: boolean;
  itemCount: number;
  minStartIndex: number;
  onActiveChapterChange: (chapterId: string) => void;
  onReset: () => void;
}) {
  const headerOffset = useReaderHeaderOffset();
  const findInitialTarget = useCallback(() => (
    findEarlyChristianReaderTarget(initialChapterId, initialPassageRange)
  ), [initialChapterId, initialPassageRange]);
  const getRenderedChapterId = useCallback((element: HTMLElement) => (
    element.dataset.chapterId
  ), []);

  return useAnchoredReaderWindow({
    activeKey: activeChapterId,
    chapterSelector: ".ec-reader-chapter",
    edgePx: DEFAULT_READER_SCROLL_WINDOW.edgePx,
    expandCount: DEFAULT_READER_SCROLL_WINDOW.expandCount,
    findInitialTarget,
    getChapterKey: getRenderedChapterId,
    headerOffset,
    initialActiveKey: initialChapterId,
    initialRange,
    initialScrollMaxFrames: DEFAULT_READER_SCROLL_WINDOW.initialScrollMaxFrames,
    initialScrollReady: isReady && isTargetWindowReady,
    itemCount,
    minStartIndex,
    minReadingAnchorOffset: DEFAULT_READER_SCROLL_WINDOW.minReadingAnchorOffset,
    onActiveKeyChange: onActiveChapterChange,
    onReset,
    passageSelector: ".ec-reader-chapter .reader-passage",
    readingAnchorRatio: DEFAULT_READER_SCROLL_WINDOW.readingAnchorRatio,
    resetKey: `${initialChapterId}|${initialPassageRange}`,
    trackingReady: isReady,
    windowReady: isReady
  });
}

function usePreservePrependedScroll({
  prependSnapshotRef,
  startIndex
}: {
  prependSnapshotRef: MutableRefObject<PrependSnapshot | null>;
  startIndex: number;
}) {
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
  }, [prependSnapshotRef, startIndex]);
}

function findRenderedPassageElement(passageId: string) {
  return [...document.querySelectorAll<HTMLElement>(".reader-passage")]
    .find((element) => element.dataset.passageId === passageId) ?? null;
}

function findEarlyChristianReaderTarget(chapterId: string, passageRange: string) {
  if (!chapterId) {
    return null;
  }

  const chapterElement = document.querySelector<HTMLElement>(
    `[data-chapter-id="${cssEscape(chapterId)}"]`
  );

  if (!chapterElement || !passageRange) {
    return chapterElement;
  }

  const exactTarget = chapterElement.querySelector<HTMLElement>(
    `[data-passage-range="${cssEscape(passageRange)}"]`
  );

  if (exactTarget) {
    return exactTarget;
  }

  const [startValue, endValue = startValue] = passageRange.split("-");
  const start = Number(startValue);
  const end = Number(endValue);

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return chapterElement;
  }

  return [...chapterElement.querySelectorAll<HTMLElement>(
    "[data-passage-start][data-passage-end]"
  )].find((element) => {
    const passageStart = Number(element.dataset.passageStart);
    const passageEnd = Number(element.dataset.passageEnd);

    return Number.isFinite(passageStart)
      && Number.isFinite(passageEnd)
      && passageStart <= start
      && passageEnd >= end;
  }) ?? chapterElement;
}

function cssEscape(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}

function useExpandableReaderWindow({
  edgePx,
  expandCount,
  expandOnMount = true,
  isReady,
  itemCount,
  minStartIndex = 0,
  prependSnapshotRef,
  setRange
}: {
  edgePx: number;
  expandCount: number;
  expandOnMount?: boolean;
  isReady: boolean;
  itemCount: number;
  minStartIndex?: number;
  prependSnapshotRef: MutableRefObject<PrependSnapshot | null>;
  setRange: (value: SetStateAction<WindowRange>) => void;
}) {
  useEffect(() => {
    if (!isReady || itemCount === 0) {
      return;
    }

    let frame = 0;

    const expandRenderedWindow = () => {
      frame = 0;

      const distanceToTop = window.scrollY;
      const distanceToBottom = document.documentElement.scrollHeight
        - (window.scrollY + window.innerHeight);

      if (distanceToTop < edgePx) {
        setRange((range) => {
          const nextRange = expandWindowStart(range, expandCount, minStartIndex);

          if (nextRange === range) {
            return range;
          }

          prependSnapshotRef.current = {
            scrollHeight: document.documentElement.scrollHeight,
            scrollY: window.scrollY
          };

          return nextRange;
        });
      }

      if (distanceToBottom < edgePx) {
        setRange((range) => expandWindowEnd(range, itemCount, expandCount));
      }
    };

    const scheduleExpand = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(expandRenderedWindow);
      }
    };

    window.addEventListener("scroll", scheduleExpand, { passive: true });
    window.addEventListener("resize", scheduleExpand);

    if (expandOnMount) {
      window.requestAnimationFrame(expandRenderedWindow);
    }

    return () => {
      window.removeEventListener("scroll", scheduleExpand);
      window.removeEventListener("resize", scheduleExpand);

      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [
    edgePx,
    expandCount,
    expandOnMount,
    isReady,
    itemCount,
    minStartIndex,
    prependSnapshotRef,
    setRange
  ]);
}

function useInitialTargetScroll({
  findTarget,
  headerOffset,
  isReady,
  maxFrames,
  onMissingTarget,
  onSettled,
  shouldScroll
}: {
  findTarget: () => HTMLElement | null;
  headerOffset: number;
  isReady: boolean;
  maxFrames: number;
  onMissingTarget?: () => void;
  onSettled: () => void;
  shouldScroll: () => boolean;
}) {
  useBrowserLayoutEffect(() => {
    if (!isReady || !shouldScroll()) {
      return;
    }

    const scrollToTarget = () => {
      const target = findTarget();

      if (!target) {
        onMissingTarget?.();
        return false;
      }

      window.scrollTo({
        behavior: "auto",
        left: 0,
        top: Math.max(
          0,
          target.getBoundingClientRect().top + window.scrollY - headerOffset
        )
      });

      return true;
    };

    let frame = 0;
    let frameCount = 0;
    let settleTimer = 0;
    let didCancel = false;
    let fontsSettled = document.fonts === undefined;

    const finishInitialScroll = () => {
      if (didCancel) {
        return;
      }

      if (settleTimer) {
        window.clearTimeout(settleTimer);
        settleTimer = 0;
      }

      scrollToTarget();
      onSettled();
    };

    const scheduleScroll = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(runScroll);
      }
    };

    const runScroll = () => {
      frame = 0;
      frameCount += 1;

      const foundTarget = scrollToTarget();

      if (!shouldScroll()) {
        return;
      }

      if (
        (foundTarget && fontsSettled && frameCount >= 2)
        || frameCount >= maxFrames
      ) {
        finishInitialScroll();
        return;
      }

      scheduleScroll();
    };

    scheduleScroll();
    settleTimer = window.setTimeout(finishInitialScroll, 600);
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

      if (settleTimer) {
        window.clearTimeout(settleTimer);
      }
    };
  }, [
    findTarget,
    headerOffset,
    isReady,
    maxFrames,
    onMissingTarget,
    onSettled,
    shouldScroll
  ]);
}

function useReaderScrollWindow({
  activeKeyRef,
  chapterSelector,
  edgePx,
  expandCount,
  findInitialTarget,
  getChapterKey,
  hasScrolledToInitialTargetRef,
  headerOffset,
  initialScrollMaxFrames,
  initialScrollReady,
  itemCount,
  minStartIndex,
  minReadingAnchorOffset,
  onActiveKeyChange,
  onInitialScrollSettled,
  onMissingInitialTarget,
  passageSelector = ".reader-passage",
  prependSnapshotRef,
  readingAnchorRatio,
  setRange,
  startIndex,
  trackingReady,
  windowReady
}: {
  activeKeyRef: MutableRefObject<string | null>;
  chapterSelector: string;
  edgePx: number;
  expandCount: number;
  findInitialTarget: () => HTMLElement | null;
  getChapterKey: (element: HTMLElement) => string | null | undefined;
  hasScrolledToInitialTargetRef: MutableRefObject<boolean>;
  headerOffset: number;
  initialScrollMaxFrames: number;
  initialScrollReady: boolean;
  itemCount: number;
  minStartIndex?: number;
  minReadingAnchorOffset: number;
  onActiveKeyChange: (key: string) => void;
  onInitialScrollSettled: () => void;
  onMissingInitialTarget?: () => void;
  passageSelector?: string;
  prependSnapshotRef: MutableRefObject<PrependSnapshot | null>;
  readingAnchorRatio: number;
  setRange: (value: SetStateAction<WindowRange>) => void;
  startIndex: number;
  trackingReady: boolean;
  windowReady: boolean;
}) {
  const settleInitialScroll = useCallback(() => {
    hasScrolledToInitialTargetRef.current = true;
    onInitialScrollSettled();
  }, [hasScrolledToInitialTargetRef, onInitialScrollSettled]);
  const shouldScrollToInitialTarget = useCallback(
    () => !hasScrolledToInitialTargetRef.current,
    [hasScrolledToInitialTargetRef]
  );
  const lastReadingAnchorRef = useRef<ReadingAnchorSnapshot | null>(null);
  const pendingResizeAnchorRef = useRef<ReadingAnchorSnapshot | null>(null);
  const isPreservingResizeRef = useRef(false);
  const anchorOptions = {
    headerOffset,
    minReadingAnchorOffset,
    readingAnchorRatio
  };
  const anchorOptionsRef = useRef(anchorOptions);
  anchorOptionsRef.current = anchorOptions;
  const captureCurrentReadingAnchor = useCallback(() => (
    captureReadingAnchorSnapshot({
      anchorOptions,
      chapterSelector,
      passageSelector
    })
  ), [
    chapterSelector,
    headerOffset,
    minReadingAnchorOffset,
    passageSelector,
    readingAnchorRatio
  ]);
  const captureCurrentReadingAnchorRef = useRef(captureCurrentReadingAnchor);
  captureCurrentReadingAnchorRef.current = captureCurrentReadingAnchor;

  useInitialTargetScroll({
    findTarget: findInitialTarget,
    headerOffset,
    isReady: initialScrollReady,
    maxFrames: initialScrollMaxFrames,
    onMissingTarget: onMissingInitialTarget,
    onSettled: settleInitialScroll,
    shouldScroll: shouldScrollToInitialTarget
  });

  usePreservePrependedScroll({
    prependSnapshotRef,
    startIndex
  });

  useExpandableReaderWindow({
    edgePx,
    expandCount,
    expandOnMount: false,
    isReady: windowReady,
    itemCount,
    minStartIndex,
    prependSnapshotRef,
    setRange
  });

  useEffect(() => {
    if (!trackingReady || itemCount === 0) {
      return;
    }

    lastReadingAnchorRef.current = captureCurrentReadingAnchorRef.current();
  }, [itemCount, trackingReady]);

  useEffect(() => {
    if (!trackingReady || itemCount === 0) {
      return;
    }

    let animationFrame = 0;
    let isRestoringLayoutResize = false;
    let settleTimeout = 0;
    let layoutWidth = document.documentElement.clientWidth;

    const restoreAnchor = () => {
      const snapshot = pendingResizeAnchorRef.current;

      if (!snapshot) {
        return;
      }

      restoreReadingAnchorSnapshot(snapshot, anchorOptionsRef.current);
    };

    const finishResizePreservation = () => {
      restoreAnchor();
      pendingResizeAnchorRef.current = null;
      isPreservingResizeRef.current = false;
      isRestoringLayoutResize = false;
      lastReadingAnchorRef.current = captureCurrentReadingAnchorRef.current();
    };

    const finishHeightOnlyResize = () => {
      pendingResizeAnchorRef.current = null;
      isPreservingResizeRef.current = false;
      isRestoringLayoutResize = false;
      lastReadingAnchorRef.current = captureCurrentReadingAnchorRef.current();
    };

    const scheduleResizePreservation = () => {
      const nextLayoutWidth = document.documentElement.clientWidth;
      pendingResizeAnchorRef.current ??= lastReadingAnchorRef.current
        ?? captureCurrentReadingAnchorRef.current();

      if (!pendingResizeAnchorRef.current) {
        return;
      }

      isPreservingResizeRef.current = true;

      if (settleTimeout) {
        window.clearTimeout(settleTimeout);
      }

      if (!shouldPreserveReaderAnchorOnResize(layoutWidth, nextLayoutWidth)) {
        settleTimeout = window.setTimeout(
          isRestoringLayoutResize
            ? finishResizePreservation
            : finishHeightOnlyResize,
          isRestoringLayoutResize
            ? READER_RESIZE_SETTLE_MS
            : READER_RESIZE_PREPARE_MS
        );
        return;
      }

      layoutWidth = nextLayoutWidth;
      isRestoringLayoutResize = true;

      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        restoreAnchor();
      });
      settleTimeout = window.setTimeout(
        finishResizePreservation,
        READER_RESIZE_SETTLE_MS
      );
    };

    window.addEventListener("orientationchange", scheduleResizePreservation);
    window.addEventListener("resize", scheduleResizePreservation);
    window.visualViewport?.addEventListener("resize", scheduleResizePreservation);

    return () => {
      window.removeEventListener("orientationchange", scheduleResizePreservation);
      window.removeEventListener("resize", scheduleResizePreservation);
      window.visualViewport?.removeEventListener("resize", scheduleResizePreservation);

      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }

      if (settleTimeout) {
        window.clearTimeout(settleTimeout);
      }

      pendingResizeAnchorRef.current = null;
      isPreservingResizeRef.current = false;
      isRestoringLayoutResize = false;
    };
  }, [itemCount, trackingReady]);

  useEffect(() => {
    if (!trackingReady || itemCount === 0) {
      return;
    }

    let updateTimer = 0;

    const updateActiveKeyFromAnchor = () => {
      if (
        prependSnapshotRef.current
        || isPreservingResizeRef.current
      ) {
        return;
      }

      lastReadingAnchorRef.current = captureCurrentReadingAnchor();
      const currentChapter = findElementAtReadingAnchor(
        [...document.querySelectorAll<HTMLElement>(chapterSelector)],
        anchorOptions
      );
      const currentKey = currentChapter ? getChapterKey(currentChapter) : null;

      if (!currentKey || currentKey === activeKeyRef.current) {
        return;
      }

      activeKeyRef.current = currentKey;
      onActiveKeyChange(currentKey);
    };

    const scheduleLocationUpdate = () => {
      if (updateTimer) {
        return;
      }

      updateTimer = window.setTimeout(() => {
        updateTimer = 0;
        updateActiveKeyFromAnchor();
      }, 0);
    };

    window.addEventListener("scroll", scheduleLocationUpdate, { passive: true });
    document.addEventListener("scroll", scheduleLocationUpdate, { passive: true });
    scheduleLocationUpdate();

    return () => {
      window.removeEventListener("scroll", scheduleLocationUpdate);
      document.removeEventListener("scroll", scheduleLocationUpdate);

      if (updateTimer) {
        window.clearTimeout(updateTimer);
      }
    };
  }, [
    activeKeyRef,
    chapterSelector,
    captureCurrentReadingAnchor,
    getChapterKey,
    hasScrolledToInitialTargetRef,
    headerOffset,
    itemCount,
    minReadingAnchorOffset,
    onActiveKeyChange,
    passageSelector,
    prependSnapshotRef,
    readingAnchorRatio,
    trackingReady
  ]);
}

function captureReadingAnchorSnapshot({
  anchorOptions,
  chapterSelector,
  passageSelector
}: {
  anchorOptions: ReadingAnchorOptions;
  chapterSelector: string;
  passageSelector: string;
}) {
  const anchorY = getReadingAnchorY(anchorOptions);
  const element = findElementAtReadingAnchor(
    [...document.querySelectorAll<HTMLElement>(passageSelector)],
    anchorOptions
  ) ?? findElementAtReadingAnchor(
    [...document.querySelectorAll<HTMLElement>(chapterSelector)],
    anchorOptions
  );

  if (!element) {
    return null;
  }

  const stableKey = getStableElementKey(element);

  if (!stableKey) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  const offsetRatio = rect.height > 0
    ? Math.max(0, Math.min(1, (anchorY - rect.top) / rect.height))
    : 0;

  return {
    ...stableKey,
    offsetRatio,
    selector: element.matches(passageSelector) ? passageSelector : chapterSelector
  };
}

function restoreReadingAnchorSnapshot(
  snapshot: ReadingAnchorSnapshot,
  anchorOptions: ReadingAnchorOptions
) {
  const element = [...document.querySelectorAll<HTMLElement>(snapshot.selector)]
    .find((candidate) => candidate.getAttribute(snapshot.attribute) === snapshot.key);

  if (!element) {
    return;
  }

  const rect = element.getBoundingClientRect();
  const anchorY = getReadingAnchorY(anchorOptions);

  window.scrollTo({
    behavior: "auto",
    left: 0,
    top: Math.max(
      0,
      window.scrollY + rect.top + (rect.height * snapshot.offsetRatio) - anchorY
    )
  });
}

function getStableElementKey(element: HTMLElement) {
  for (const attribute of READING_ANCHOR_KEY_ATTRIBUTES) {
    const key = element.getAttribute(attribute);

    if (key) {
      return {
        attribute,
        key
      };
    }
  }

  return null;
}

function findElementAtReadingAnchor(
  elements: HTMLElement[],
  {
    headerOffset,
    minReadingAnchorOffset,
    readingAnchorRatio
  }: {
    headerOffset: number;
    minReadingAnchorOffset: number;
    readingAnchorRatio: number;
  }
) {
  const anchorY = getReadingAnchorY({
    headerOffset,
    minReadingAnchorOffset,
    readingAnchorRatio
  });

  return elements.find((element) => {
    const rect = element.getBoundingClientRect();
    return rect.top <= anchorY && rect.bottom >= anchorY;
  }) ?? elements.find((element) => element.getBoundingClientRect().top > anchorY)
    ?? elements[elements.length - 1];
}

function getReadingAnchorY({
  headerOffset,
  minReadingAnchorOffset,
  readingAnchorRatio
}: ReadingAnchorOptions) {
  return Math.max(
    headerOffset + 40,
    Math.min(window.innerHeight * readingAnchorRatio, minReadingAnchorOffset)
  );
}
