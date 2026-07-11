import { useEffect, useMemo, useState } from "react";

import type { BookIndex } from "~/features/early-christian-reader/types";

import { useEarlyChristianWorkDownloads } from "./early-christian-work-downloads";
import { useOfflineStatus } from "./OfflineProvider";

export function useEarlyChristianOfflineReader({
  bookIndex,
  initialChapterId,
  initialPassageRange,
  previewAssetVersion,
}: {
  bookIndex: BookIndex | null;
  initialChapterId: string;
  initialPassageRange: string;
  previewAssetVersion: string;
}) {
  const { hasInitializedOfflineDetection, isOffline } = useOfflineStatus();
  const [readerLinkChapterId, setReaderLinkChapterId] =
    useState(initialChapterId);
  const [readerLinkPassageRange, setReaderLinkPassageRange] =
    useState(initialPassageRange);
  const downloads = useEarlyChristianWorkDownloads({
    bookIndex,
    hasInitializedOfflineDetection,
    isOffline,
    previewAssetVersion,
  });
  const readerBookIndex = useMemo(() => {
    if (!bookIndex || !isOffline || !downloads.hasValidatedRecords) {
      return bookIndex;
    }

    return {
      ...bookIndex,
      books: bookIndex.books.filter((book) =>
        downloads.downloadedWorkIds.has(book.id)
      ),
    };
  }, [
    bookIndex,
    downloads.downloadedWorkIds,
    downloads.hasValidatedRecords,
    isOffline,
  ]);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const requestedChapterId = searchParams.get("chapter") ?? "";

    setReaderLinkChapterId(requestedChapterId);
    setReaderLinkPassageRange(
      requestedChapterId ? searchParams.get("passage") ?? "" : ""
    );
  }, [initialChapterId, initialPassageRange]);

  return {
    ...downloads,
    isOffline,
    readerBookIndex,
    readerLinkChapterId,
    readerLinkPassageRange,
  };
}
