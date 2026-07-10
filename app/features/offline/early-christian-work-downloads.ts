import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { versionedPreviewUrl } from "~/features/early-christian-preview/preview-cache";

import type { BookIndex, BookSummary } from "~/features/early-christian-reader/types";

const CONTENT_CACHE = "cross-canon-content-v1";
const STORAGE_KEY = "cross-canon:offline-early-christian-works:v1";
const PERSISTENCE_REQUESTED_KEY = "cross-canon:offline-persistence-requested:v1";
const CHAPTER_DOWNLOAD_CONCURRENCY = 4;

export type OfflineWorkRecord = {
  chapterUrls: string[];
  complete?: boolean;
  completedAt: number;
  version: string;
};

type OfflineWorkRecords = Record<string, OfflineWorkRecord>;

export type WorkDownloadState = {
  completed: number;
  error: string | null;
  kind: "downloading" | "error" | "idle";
  total: number;
  workId: string;
  workName: string;
};

const IDLE_DOWNLOAD: WorkDownloadState = {
  completed: 0,
  error: null,
  kind: "idle",
  total: 0,
  workId: "",
  workName: ""
};

export function useEarlyChristianWorkDownloads({
  bookIndex,
  isOffline,
  previewAssetVersion
}: {
  bookIndex: BookIndex | null;
  isOffline: boolean;
  previewAssetVersion: string;
}) {
  const [records, setRecords] = useState<OfflineWorkRecords>(() => readOfflineWorkRecords());
  const [downloadState, setDownloadState] = useState<WorkDownloadState>(IDLE_DOWNLOAD);
  const [availableOfflineWorkId, setAvailableOfflineWorkId] = useState("");
  const [hasValidatedRecords, setHasValidatedRecords] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const backgroundAttemptRef = useRef("");
  const recordsRef = useRef(records);

  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  const persistRecords = useCallback((nextRecords: OfflineWorkRecords) => {
    recordsRef.current = nextRecords;
    setRecords(nextRecords);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextRecords));
  }, []);

  const validateRecords = useCallback(async () => {
    const currentRecords = recordsRef.current;

    if (typeof caches === "undefined") {
      if (Object.keys(currentRecords).length > 0) {
        persistRecords({});
      }
      setHasValidatedRecords(true);
      return;
    }

    const cache = await caches.open(CONTENT_CACHE);
    const validatedRecords: OfflineWorkRecords = {};

    for (const [workId, record] of Object.entries(currentRecords)) {
      const isComplete = await every(record.chapterUrls, async (url) => (
        Boolean(await cache.match(url))
      ));

      validatedRecords[workId] = {
        ...record,
        complete: isComplete
      };
    }

    if (!sameRecords(currentRecords, validatedRecords)) {
      persistRecords(validatedRecords);
    }

    setHasValidatedRecords(true);
  }, [persistRecords]);

  useEffect(() => {
    void validateRecords().catch(() => setHasValidatedRecords(true));
  }, [validateRecords]);

  const downloadWork = useCallback(async (
    book: BookSummary,
    { requestPersistence }: { requestPersistence: boolean }
  ) => {
    if (downloadState.kind === "downloading") {
      return;
    }

    if (typeof caches === "undefined") {
      setDownloadState({
        ...IDLE_DOWNLOAD,
        error: "Offline downloads are unavailable in this browser.",
        kind: "error",
        workId: book.id,
        workName: book.name
      });
      return;
    }

    if (requestPersistence) {
      await requestPersistentStorageOnce();
    }

    const chapterUrls = book.chapters.map((chapter) => (
      versionedPreviewUrl(chapter.assetPath, previewAssetVersion)
    ));
    const previousRecord = recordsRef.current[book.id];
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setDownloadState({
      completed: 0,
      error: null,
      kind: "downloading",
      total: chapterUrls.length,
      workId: book.id,
      workName: book.name
    });

    try {
      const cache = await caches.open(CONTENT_CACHE);
      let completed = 0;
      let nextIndex = 0;
      const workerCount = Math.min(CHAPTER_DOWNLOAD_CONCURRENCY, chapterUrls.length);

      await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextIndex < chapterUrls.length) {
          const url = chapterUrls[nextIndex];
          nextIndex += 1;

          if (controller.signal.aborted) {
            throw new DOMException("Download canceled", "AbortError");
          }

          try {
            const cached = await cache.match(url);

            if (!cached) {
              const response = await fetch(url, {
                cache: "no-store",
                signal: controller.signal
              });

              if (!response.ok) {
                throw new Error(`Failed to download chapter: ${response.status}`);
              }

              await cache.put(url, response.clone());
            }

            completed += 1;
            setDownloadState((current) => ({
              ...current,
              completed
            }));
          } catch (error) {
            controller.abort();
            throw error;
          }
        }
      }));

      const nextRecords = {
        ...recordsRef.current,
        [book.id]: {
          chapterUrls,
          complete: true,
          completedAt: Date.now(),
          version: previewAssetVersion
        }
      };
      persistRecords(nextRecords);
      if (previousRecord && previousRecord.version !== previewAssetVersion) {
        await deleteCachedUrls(previousRecord.chapterUrls);
      }
      setDownloadState({
        completed: chapterUrls.length,
        error: null,
        kind: "idle",
        total: chapterUrls.length,
        workId: book.id,
        workName: book.name
      });
      setAvailableOfflineWorkId(book.id);
      window.setTimeout(() => {
        setAvailableOfflineWorkId((current) => current === book.id ? "" : current);
      }, 3_000);
    } catch (error: unknown) {
      const wasCanceled = isAbortError(error);
      const isQuotaError = isQuotaExceeded(error);

      if (wasCanceled || isQuotaError) {
        await deleteCachedUrls(chapterUrls);
      }

      setDownloadState({
        completed: 0,
        error: wasCanceled
          ? null
          : isQuotaError
            ? "Not enough storage"
            : "Download interrupted. Try again.",
        kind: wasCanceled ? "idle" : "error",
        total: chapterUrls.length,
        workId: book.id,
        workName: book.name
      });
    } finally {
      abortControllerRef.current = null;
    }
  }, [downloadState.kind, persistRecords, previewAssetVersion]);

  const cancelDownload = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const removeWork = useCallback(async (bookId: string) => {
    const record = recordsRef.current[bookId];

    if (!record) {
      return;
    }

    await deleteCachedUrls(record.chapterUrls);
    const { [bookId]: _removed, ...nextRecords } = recordsRef.current;
    persistRecords(nextRecords);
  }, [persistRecords]);

  const downloadedWorkIds = useMemo(() => (
    new Set(
      Object.entries(records)
        .filter(([, record]) => record.complete !== false)
        .map(([workId]) => workId)
    )
  ), [records]);

  useEffect(() => {
    if (
      !bookIndex
      || downloadState.kind === "downloading"
      || !hasValidatedRecords
    ) {
      return;
    }

    if (isOffline) {
      backgroundAttemptRef.current = "";
      return;
    }

    const staleWork = bookIndex.books.find((book) => {
      const record = recordsRef.current[book.id];
      return record && (
        record.complete === false || record.version !== previewAssetVersion
      );
    });

    const staleRecord = staleWork ? recordsRef.current[staleWork.id] : undefined;
    const attemptKey = staleWork && staleRecord
      ? `${staleWork.id}:${staleRecord.version}:${String(staleRecord.complete)}`
      : "";

    if (
      staleWork
      && navigator.onLine
      && backgroundAttemptRef.current !== attemptKey
    ) {
      backgroundAttemptRef.current = attemptKey;
      void downloadWork(staleWork, { requestPersistence: false });
    }
  }, [
    bookIndex,
    downloadState.kind,
    downloadWork,
    hasValidatedRecords,
    isOffline,
    previewAssetVersion
  ]);

  return {
    availableOfflineWorkId,
    cancelDownload,
    downloadState,
    downloadWork: (book: BookSummary) => downloadWork(book, { requestPersistence: true }),
    downloadedWorkIds,
    hasValidatedRecords,
    removeWork
  };
}

function readOfflineWorkRecords(): OfflineWorkRecords {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(value).flatMap(([workId, record]) => {
        if (!isOfflineWorkRecord(record)) {
          return [];
        }

        return [[workId, record]];
      })
    );
  } catch {
    return {};
  }
}

function isOfflineWorkRecord(value: unknown): value is OfflineWorkRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Partial<OfflineWorkRecord>;

  return typeof record.completedAt === "number"
    && (record.complete === undefined || typeof record.complete === "boolean")
    && typeof record.version === "string"
    && Array.isArray(record.chapterUrls)
    && record.chapterUrls.every((url) => typeof url === "string");
}

async function requestPersistentStorageOnce() {
  try {
    if (window.localStorage.getItem(PERSISTENCE_REQUESTED_KEY)) {
      return;
    }

    window.localStorage.setItem(PERSISTENCE_REQUESTED_KEY, "1");

    if (!navigator.storage?.persist) {
      return;
    }

    if (!await navigator.storage.persisted()) {
      await navigator.storage.persist();
    }
  } catch {
    // Browser persistence is a best-effort protection, never a download blocker.
  }
}

async function deleteCachedUrls(urls: string[]) {
  if (typeof caches === "undefined") {
    return;
  }

  const cache = await caches.open(CONTENT_CACHE);
  await Promise.all(urls.map((url) => cache.delete(url)));
}

async function every<T>(values: T[], predicate: (value: T) => Promise<boolean>) {
  for (const value of values) {
    if (!await predicate(value)) {
      return false;
    }
  }

  return true;
}

function sameRecords(left: OfflineWorkRecords, right: OfflineWorkRecords) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => (
      right[key]?.chapterUrls.length === left[key].chapterUrls.length
      && right[key]?.chapterUrls.every((url, index) => url === left[key].chapterUrls[index])
      && right[key]?.complete === left[key].complete
      && right[key]?.completedAt === left[key].completedAt
      && right[key]?.version === left[key].version
    ));
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function isQuotaExceeded(error: unknown) {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}
