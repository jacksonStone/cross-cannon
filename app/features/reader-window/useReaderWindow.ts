import {
  type MutableRefObject,
  type SetStateAction,
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
  prependSnapshotRef,
  setRange
}: {
  edgePx: number;
  expandCount: number;
  expandOnMount?: boolean;
  isReady: boolean;
  itemCount: number;
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
          const nextRange = expandWindowStart(range, expandCount);

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
    let didSettle = false;
    let fontsSettled = document.fonts === undefined;

    const settle = () => {
      if (didSettle) {
        return;
      }

      didSettle = true;
      onSettled();
    };

    const finishInitialScroll = () => {
      if (didCancel) {
        return;
      }

      scrollToTarget();
      settle();
    };

    const abortInitialScroll = () => {
      if (didCancel) {
        return;
      }

      didCancel = true;

      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }

      settle();
    };

    const abortInitialScrollForKey = (event: KeyboardEvent) => {
      if (isScrollKey(event.key)) {
        abortInitialScroll();
      }
    };

    const scheduleScroll = () => {
      if (didCancel) {
        return;
      }

      if (!frame) {
        frame = window.requestAnimationFrame(runScroll);
      }
    };

    const runScroll = () => {
      if (didCancel) {
        return;
      }

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
    window.addEventListener("wheel", abortInitialScroll, { passive: true });
    window.addEventListener("touchmove", abortInitialScroll, { passive: true });
    window.addEventListener("keydown", abortInitialScrollForKey);
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
      window.removeEventListener("wheel", abortInitialScroll);
      window.removeEventListener("touchmove", abortInitialScroll);
      window.removeEventListener("keydown", abortInitialScrollForKey);

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

function isScrollKey(key: string) {
  return key === "ArrowDown"
    || key === "ArrowUp"
    || key === "End"
    || key === "Home"
    || key === "PageDown"
    || key === "PageUp"
    || key === " ";
}
