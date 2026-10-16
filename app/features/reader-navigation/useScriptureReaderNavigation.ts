import { useCallback, useMemo, useState } from "react";

import {
  buildChapterIndex,
  getPassageChapterKey
} from "~/features/passage-reader/chapter-index";
import type { StoredFilters } from "~/features/search/types";
import { useScriptureReaderWindow } from "~/features/reader-window/useReaderWindow";
import type { BrowserPassage } from "~/lib/scripture-cache-contract";

import {
  buildScriptureReaderUrl,
  updateReaderUrl
} from "./reader-links";

export function useScriptureReaderNavigation({
  filters,
  initialPassageId,
  isReady,
  onChapterChange,
  passages
}: {
  filters: StoredFilters;
  initialPassageId: string;
  isReady: boolean;
  onChapterChange?: (chapterKey: string, passageId?: string) => void;
  passages: BrowserPassage[];
}) {
  const chapterIndex = useMemo(() => buildChapterIndex(passages), [passages]);
  const orderedChapterEntries = chapterIndex.orderedChapterEntries;
  const [readerTarget, setReaderTarget] = useState({
    initialPassageId,
    passageId: initialPassageId
  });
  // External navigation supersedes any target selected by the audio session.
  if (readerTarget.initialPassageId !== initialPassageId) {
    setReaderTarget({ initialPassageId, passageId: initialPassageId });
  }
  const targetPassageId = readerTarget.initialPassageId === initialPassageId
    ? readerTarget.passageId
    : initialPassageId;
  const initialChapterKey =
    getPassageChapterKey(chapterIndex, targetPassageId)
    ?? orderedChapterEntries[0]?.key
    ?? null;
  const [activeChapterKey, setActiveChapterKey] = useState(initialChapterKey);
  const [selectedPassageId, setSelectedPassageId] = useState("");
  const activeChapter = activeChapterKey
    ? chapterIndex.chaptersByKey.get(activeChapterKey)
    : null;
  const initialChapterIndex = initialChapterKey
    ? chapterIndex.renderedChapterKeys.indexOf(initialChapterKey)
    : -1;
  const resetNavigation = useCallback(() => {
    setActiveChapterKey(initialChapterKey);
    setSelectedPassageId("");
  }, [initialChapterKey]);
  const updateActiveChapterFromScroll = useCallback((
    chapterKey: string,
    passageId?: string
  ) => {
    setActiveChapterKey(chapterKey);
    onChapterChange?.(chapterKey, passageId);
  }, [onChapterChange]);
  const scrollToTopWhenInitialPassageMissing = useCallback(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);
  const { renderedRange } = useScriptureReaderWindow({
    activeChapterKey,
    initialChapterIndex,
    initialChapterKey,
    initialPassageId: targetPassageId,
    isReady,
    itemCount: orderedChapterEntries.length,
    onActiveChapterChange: updateActiveChapterFromScroll,
    onMissingInitialPassage: scrollToTopWhenInitialPassageMissing,
    onReset: resetNavigation
  });
  const renderedChapterEntries = useMemo(() => {
    if (renderedRange.endIndex < renderedRange.startIndex) {
      return [];
    }

    return orderedChapterEntries
      .slice(
        Math.max(0, renderedRange.startIndex),
        renderedRange.endIndex + 1
      )
      .map((entry) => {
        const globalIndex = chapterIndex.renderedChapterKeys.indexOf(entry.key);
        const previousChapter = globalIndex > 0
          ? orderedChapterEntries[globalIndex - 1]?.chapter
          : null;

        return {
          ...entry,
          isBookBoundary:
            !previousChapter || previousChapter.book !== entry.chapter.book
        };
      });
  }, [
    chapterIndex.renderedChapterKeys,
    orderedChapterEntries,
    renderedRange.endIndex,
    renderedRange.startIndex
  ]);
  const isInitialChapterReadyToRender = Boolean(
    initialChapterKey
    && renderedChapterEntries.some((entry) => entry.key === activeChapterKey)
  );
  const toggleSelectedPassage = useCallback((passageId: string) => {
    const nextPassageId = selectedPassageId === passageId ? "" : passageId;
    const shareablePassageId = nextPassageId
      || activeChapter?.passages[0]?.id
      || initialPassageId;

    setSelectedPassageId(nextPassageId);

    if (shareablePassageId) {
      updateReaderUrl(
        buildScriptureReaderUrl(shareablePassageId, filters),
        "replace"
      );
    }
  }, [activeChapter?.passages, filters, initialPassageId, selectedPassageId]);

  const openAudioChapter = useCallback((key: string) => {
    const chapter = chapterIndex.chaptersByKey.get(key);
    const passageId = chapter?.passages[0]?.id;
    if (!passageId) return;
    // Reuse saved-place restoration: center the chapter window, wait for the
    // target passage to settle, then resume passive location tracking.
    setReaderTarget({ initialPassageId, passageId });
    onChapterChange?.(key, passageId);
    updateReaderUrl(buildScriptureReaderUrl(passageId, filters), "replace");
  }, [chapterIndex.chaptersByKey, filters, initialPassageId, onChapterChange]);

  return {
    activeChapter,
    openAudioChapter,
    chapterCountByBook: chapterIndex.chapterCountByBook,
    isInitialChapterReadyToRender,
    passageJumpInitialPassageId:
      activeChapter?.passages[0]?.id ?? initialPassageId,
    renderedChapterEntries,
    selectedPassageId,
    toggleSelectedPassage
  };
}
