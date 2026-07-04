import {
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef
} from "react";

import {
  expandWindowEnd,
  expandWindowStart,
  type WindowRange
} from "./window-range";

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

export const DEFAULT_READER_SCROLL_WINDOW = {
  edgePx: 2200,
  expandCount: 10,
  headerOffset: 118,
  initialAfter: 24,
  initialBefore: 10,
  initialScrollMaxFrames: 8,
  minReadingAnchorOffset: 220,
  readingAnchorRatio: 0.38
} as const;

const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function usePreservePrependedScroll({
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

export function useExpandableReaderWindow({
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

export function useInitialTargetScroll({
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
    let didCancel = false;
    let fontsSettled = document.fonts === undefined;

    const finishInitialScroll = () => {
      if (didCancel) {
        return;
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
    findTarget,
    headerOffset,
    isReady,
    maxFrames,
    onMissingTarget,
    onSettled,
    shouldScroll
  ]);
}

export function useReaderScrollWindow({
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
  const captureCurrentReadingAnchor = useCallback(() => (
    captureReadingAnchorSnapshot({
      anchorOptions,
      chapterSelector
    })
  ), [
    chapterSelector,
    headerOffset,
    minReadingAnchorOffset,
    readingAnchorRatio
  ]);

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

    lastReadingAnchorRef.current = captureCurrentReadingAnchor();
  }, [captureCurrentReadingAnchor, itemCount, trackingReady]);

  useEffect(() => {
    if (!trackingReady || itemCount === 0) {
      return;
    }

    let animationFrame = 0;
    let settleTimeout = 0;

    const restoreAnchor = () => {
      const snapshot = pendingResizeAnchorRef.current;

      if (!snapshot) {
        return;
      }

      restoreReadingAnchorSnapshot(snapshot, anchorOptions);
    };

    const finishResizePreservation = () => {
      restoreAnchor();
      pendingResizeAnchorRef.current = null;
      isPreservingResizeRef.current = false;
      lastReadingAnchorRef.current = captureCurrentReadingAnchor();
    };

    const scheduleResizePreservation = () => {
      pendingResizeAnchorRef.current ??= lastReadingAnchorRef.current
        ?? captureCurrentReadingAnchor();

      if (!pendingResizeAnchorRef.current) {
        return;
      }

      isPreservingResizeRef.current = true;

      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }

      if (settleTimeout) {
        window.clearTimeout(settleTimeout);
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        restoreAnchor();
      });
      settleTimeout = window.setTimeout(finishResizePreservation, 180);
    };

    window.addEventListener("resize", scheduleResizePreservation);
    window.visualViewport?.addEventListener("resize", scheduleResizePreservation);

    return () => {
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
    };
  }, [
    captureCurrentReadingAnchor,
    headerOffset,
    itemCount,
    minReadingAnchorOffset,
    readingAnchorRatio,
    trackingReady
  ]);

  useEffect(() => {
    if (!trackingReady || itemCount === 0) {
      return;
    }

    let animationFrame = 0;

    const updateActiveKeyFromAnchor = () => {
      if (
        !hasScrolledToInitialTargetRef.current
        || prependSnapshotRef.current
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
      if (animationFrame) {
        return;
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        updateActiveKeyFromAnchor();
      });
    };

    window.addEventListener("scroll", scheduleLocationUpdate, { passive: true });

    return () => {
      window.removeEventListener("scroll", scheduleLocationUpdate);

      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
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
    prependSnapshotRef,
    readingAnchorRatio,
    trackingReady
  ]);
}

function captureReadingAnchorSnapshot({
  anchorOptions,
  chapterSelector
}: {
  anchorOptions: ReadingAnchorOptions;
  chapterSelector: string;
}) {
  const anchorY = getReadingAnchorY(anchorOptions);
  const element = findElementAtReadingAnchor(
    [...document.querySelectorAll<HTMLElement>(".reader-passage")],
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
    selector: element.matches(".reader-passage") ? ".reader-passage" : chapterSelector
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
