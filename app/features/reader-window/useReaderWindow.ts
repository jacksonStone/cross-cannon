import {
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect
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

    let animationFrame = 0;

    const updateActiveKeyFromAnchor = () => {
      if (
        !hasScrolledToInitialTargetRef.current
        || prependSnapshotRef.current
      ) {
        return;
      }

      const currentChapter = findElementAtReadingAnchor(
        [...document.querySelectorAll<HTMLElement>(chapterSelector)],
        {
          headerOffset,
          minReadingAnchorOffset,
          readingAnchorRatio
        }
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
  const anchorY = Math.max(
    headerOffset + 40,
    Math.min(window.innerHeight * readingAnchorRatio, minReadingAnchorOffset)
  );

  return elements.find((element) => {
    const rect = element.getBoundingClientRect();
    return rect.top <= anchorY && rect.bottom >= anchorY;
  }) ?? elements.find((element) => element.getBoundingClientRect().top > anchorY)
    ?? elements[elements.length - 1];
}
