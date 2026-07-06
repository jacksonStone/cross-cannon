import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";

import {
  getCachedPreviewJson,
  loadPreviewJson,
  rememberCachedPreviewJson
} from "~/features/early-christian-preview/preview-cache";

import {
  getCachedChapterAssets,
  loadChapterAssets,
  distanceFromActiveChapter
} from "./chapter-assets";
import {
  readCachedBookIndex,
  sortBookIndex
} from "./book-index";
import type {
  BookIndex,
  ChapterAsset,
  ChapterEntry,
  PreviewManifest
} from "./types";

const CHAPTER_ASSET_LOAD_CONCURRENCY = 4;

export function useEarlyChristianBookIndex({
  manifestUrl,
  previewAssetVersion
}: {
  manifestUrl: string;
  previewAssetVersion: string;
}) {
  const [manifest, setManifest] = useState<PreviewManifest | null>(() => (
    getCachedPreviewJson<PreviewManifest>(manifestUrl, previewAssetVersion) ?? null
  ));
  const [bookIndex, setBookIndex] = useState<BookIndex | null>(() => (
    readCachedBookIndex(manifestUrl, previewAssetVersion)
  ));
  const [loadError, setLoadError] = useState<string | null>(null);
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
  }, [manifest, previewAssetVersion]);

  return {
    bookIndex,
    loadError
  };
}

export function useEarlyChristianChapterAssets(previewAssetVersion: string) {
  const [loadedChapters, setLoadedChapters] = useState<Map<string, ChapterAsset>>(() => (
    getCachedChapterAssets(previewAssetVersion)
  ));
  const [chapterLoadErrors, setChapterLoadErrors] = useState<Map<string, string>>(() => new Map());

  return {
    chapterLoadErrors,
    loadedChapters,
    setChapterLoadErrors,
    setLoadedChapters
  };
}

export function useRenderedChapterAssetLoader({
  activeChapterIndex,
  bookIndex,
  chapterLoadErrors,
  loadedChapters,
  previewAssetVersion,
  renderedEntries,
  setChapterLoadErrors,
  setLoadedChapters
}: {
  activeChapterIndex: number | undefined;
  bookIndex: BookIndex | null;
  chapterLoadErrors: Map<string, string>;
  loadedChapters: Map<string, ChapterAsset>;
  previewAssetVersion: string;
  renderedEntries: ChapterEntry[];
  setChapterLoadErrors: Dispatch<SetStateAction<Map<string, string>>>;
  setLoadedChapters: Dispatch<SetStateAction<Map<string, ChapterAsset>>>;
}) {
  const isMountedRef = useRef(true);
  const loadingChapterIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

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
}
