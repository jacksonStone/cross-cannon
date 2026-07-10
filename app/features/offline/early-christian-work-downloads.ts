import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { versionedPreviewUrl } from "~/features/early-christian-preview/preview-cache";
import type {
  BookIndex,
  BookSummary,
} from "~/features/early-christian-reader/types";

import {
  GENERAL_CONTENT_CACHE,
  type OfflineWorkRecord,
  type OfflineWorkRecords,
  cleanupInactiveWorkGenerations,
  deleteWorkGeneration,
  readOfflineWorkRecords,
  workGenerationCacheName,
  writeOfflineWorkRecords,
} from "./offline-work-storage.client";

const PERSISTENCE_REQUESTED_KEY =
  "cross-canon:offline-persistence-requested:v1";
const CHAPTER_DOWNLOAD_CONCURRENCY = 4;

type DownloadSource = "background" | "manual";

export type WorkDownloadState = {
  completed: number;
  error: string | null;
  kind: "downloading" | "error" | "idle";
  source: DownloadSource;
  total: number;
  workId: string;
  workName: string;
};

type ActiveDownload = {
  promise: Promise<void>;
  source: DownloadSource;
};

const IDLE_DOWNLOAD: WorkDownloadState = {
  completed: 0,
  error: null,
  kind: "idle",
  source: "manual",
  total: 0,
  workId: "",
  workName: "",
};

export function useEarlyChristianWorkDownloads({
  bookIndex,
  hasCheckedReachability,
  isOffline,
  previewAssetVersion,
}: {
  bookIndex: BookIndex | null;
  hasCheckedReachability: boolean;
  isOffline: boolean;
  previewAssetVersion: string;
}) {
  const [records, setRecords] = useState<OfflineWorkRecords>({});
  const [downloadState, setDownloadState] =
    useState<WorkDownloadState>(IDLE_DOWNLOAD);
  const [availableOfflineWorkId, setAvailableOfflineWorkId] = useState("");
  const [hasValidatedRecords, setHasValidatedRecords] = useState(false);
  const recordsRef = useRef(records);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeDownloadRef = useRef<ActiveDownload | null>(null);
  const backgroundAttemptRef = useRef("");

  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  const persistRecords = useCallback(
    async (nextRecords: OfflineWorkRecords) => {
      await writeOfflineWorkRecords(nextRecords);
      recordsRef.current = nextRecords;
      setRecords(nextRecords);
    },
    []
  );

  useEffect(() => {
    let ignore = false;

    void readOfflineWorkRecords()
      .then(validateOfflineWorkRecords)
      .then(async (loadedRecords) => {
        await writeOfflineWorkRecords(loadedRecords);
        await cleanupInactiveWorkGenerations(loadedRecords);

        if (!ignore) {
          recordsRef.current = loadedRecords;
          setRecords(loadedRecords);
          setHasValidatedRecords(true);
        }
      })
      .catch(() => {
        if (!ignore) {
          setHasValidatedRecords(true);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  const performDownload = useCallback(
    async (
      book: BookSummary,
      source: DownloadSource,
      requestPersistence: boolean
    ) => {
      if (typeof caches === "undefined") {
        setDownloadState({
          ...IDLE_DOWNLOAD,
          error: "Offline downloads are unavailable in this browser.",
          kind: "error",
          source,
          workId: book.id,
          workName: book.name,
        });
        return;
      }

      if (requestPersistence) {
        await requestPersistentStorageOnce();
      }

      const chapterDownloads = book.chapters.map((chapter) => ({
        chapterId: chapter.id,
        url: versionedPreviewUrl(chapter.assetPath, previewAssetVersion),
      }));
      const chapterUrls = chapterDownloads.map((chapter) => chapter.url);
      const previousRecord = recordsRef.current[book.id];
      const matchingPending =
        previousRecord?.pending?.version === previewAssetVersion
          ? previousRecord.pending
          : null;
      const isRepair =
        previousRecord?.version === previewAssetVersion &&
        previousRecord.complete === false;
      const stageCacheName =
        matchingPending?.cacheName ??
        (isRepair
          ? previousRecord.cacheName
          : workGenerationCacheName(book.id, previewAssetVersion));
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setDownloadState({
        completed: 0,
        error: null,
        kind: "downloading",
        source,
        total: chapterUrls.length,
        workId: book.id,
        workName: book.name,
      });

      try {
        const startedRecord = createStartedRecord({
          chapterUrls,
          previousRecord,
          stageCacheName,
          version: previewAssetVersion,
        });
        await persistRecords({
          ...recordsRef.current,
          [book.id]: startedRecord,
        });
        const stageCache = await caches.open(stageCacheName);
        const generalCache = await caches.open(GENERAL_CONTENT_CACHE);
        let completed = 0;
        let nextIndex = 0;
        const workerCount = Math.min(
          CHAPTER_DOWNLOAD_CONCURRENCY,
          chapterDownloads.length
        );

        await Promise.all(
          Array.from({ length: workerCount }, async () => {
            while (nextIndex < chapterDownloads.length) {
              const chapter = chapterDownloads[nextIndex];
              nextIndex += 1;

              if (controller.signal.aborted) {
                throw new DOMException("Download canceled", "AbortError");
              }

              try {
                let cached = await stageCache.match(chapter.url);

                if (
                  cached &&
                  !(await isValidEarlyChristianChapterResponse(
                    cached,
                    chapter.chapterId
                  ))
                ) {
                  await stageCache.delete(chapter.url);
                  cached = undefined;
                }

                if (!cached) {
                  const reusable = await generalCache.match(chapter.url);

                  if (
                    reusable &&
                    (await isValidEarlyChristianChapterResponse(
                      reusable,
                      chapter.chapterId
                    ))
                  ) {
                    await stageCache.put(chapter.url, reusable);
                    cached = reusable;
                  }
                }

                if (!cached) {
                  const response = await fetch(chapter.url, {
                    cache: "no-store",
                    headers: { "X-Cross-Canon-Download": "1" },
                    signal: controller.signal,
                  });

                  if (!response.ok) {
                    throw new Error(
                      `Failed to download chapter: ${response.status}`
                    );
                  }

                  if (
                    !(await isValidEarlyChristianChapterResponse(
                      response,
                      chapter.chapterId
                    ))
                  ) {
                    throw new Error("Downloaded Chapter was invalid.");
                  }

                  await stageCache.put(chapter.url, response.clone());
                }

                completed += 1;
                setDownloadState((current) => ({ ...current, completed }));
              } catch (error) {
                controller.abort();
                throw error;
              }
            }
          })
        );

        const nextRecords = {
          ...recordsRef.current,
          [book.id]: {
            cacheName: stageCacheName,
            chapterUrls,
            complete: true,
            completedAt: Date.now(),
            version: previewAssetVersion,
          },
        };
        await persistRecords(nextRecords);
        setDownloadState({
          completed: chapterUrls.length,
          error: null,
          kind: "idle",
          source,
          total: chapterUrls.length,
          workId: book.id,
          workName: book.name,
        });

        if (source === "manual") {
          setAvailableOfflineWorkId(book.id);
          window.setTimeout(() => {
            setAvailableOfflineWorkId((current) =>
              current === book.id ? "" : current
            );
          }, 3_000);
        }
      } catch (error: unknown) {
        const wasCanceled = isAbortError(error);
        const isQuotaError = isQuotaExceeded(error);

        if (wasCanceled || isQuotaError) {
          await deleteWorkGeneration(stageCacheName);
          await rollbackStartedRecord(
            book.id,
            previousRecord,
            recordsRef.current,
            persistRecords
          );
        }

        setDownloadState({
          completed: 0,
          error: wasCanceled
            ? null
            : isQuotaError
            ? "Not enough storage"
            : "Download interrupted. Try again.",
          kind: wasCanceled ? "idle" : "error",
          source,
          total: chapterUrls.length,
          workId: book.id,
          workName: book.name,
        });
      } finally {
        abortControllerRef.current = null;
      }
    },
    [persistRecords, previewAssetVersion]
  );

  const startDownload = useCallback(
    (
      book: BookSummary,
      source: DownloadSource,
      requestPersistence: boolean
    ) => {
      const promise = performDownload(book, source, requestPersistence);
      const activeDownload = { promise, source };
      activeDownloadRef.current = activeDownload;
      void promise.finally(() => {
        if (activeDownloadRef.current === activeDownload) {
          activeDownloadRef.current = null;
        }
      });
      return promise;
    },
    [performDownload]
  );

  const downloadWork = useCallback(
    async (book: BookSummary) => {
      const activeDownload = activeDownloadRef.current;

      if (activeDownload?.source === "background") {
        abortControllerRef.current?.abort();
        await activeDownload.promise;
      } else if (activeDownload) {
        return;
      }

      await startDownload(book, "manual", true);
    },
    [startDownload]
  );

  const cancelDownload = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const removeWork = useCallback(
    async (bookId: string) => {
      const record = recordsRef.current[bookId];

      if (!record) {
        return;
      }

      const { [bookId]: _removed, ...nextRecords } = recordsRef.current;
      await persistRecords(nextRecords);
      await Promise.all([
        deleteWorkGeneration(record.cacheName),
        deleteWorkGeneration(record.pending?.cacheName ?? ""),
      ]);
    },
    [persistRecords]
  );

  const downloadedWorkIds = useMemo(
    () =>
      new Set(
        Object.entries(records)
          .filter(([, record]) => record.complete)
          .map(([workId]) => workId)
      ),
    [records]
  );

  useEffect(() => {
    if (
      !bookIndex ||
      !hasCheckedReachability ||
      !hasValidatedRecords ||
      activeDownloadRef.current
    ) {
      return;
    }

    if (isOffline) {
      backgroundAttemptRef.current = "";
      return;
    }

    const staleWork = bookIndex.books.find((book) => {
      const record = recordsRef.current[book.id];
      return (
        record &&
        (record.complete === false ||
          record.version !== previewAssetVersion ||
          record.pending?.version === previewAssetVersion)
      );
    });
    const attemptKey = staleWork
      ? `${staleWork.id}:${previewAssetVersion}`
      : "";

    if (
      staleWork &&
      navigator.onLine &&
      backgroundAttemptRef.current !== attemptKey
    ) {
      backgroundAttemptRef.current = attemptKey;
      void startDownload(staleWork, "background", false);
    }
  }, [
    bookIndex,
    downloadState.kind,
    hasCheckedReachability,
    hasValidatedRecords,
    isOffline,
    previewAssetVersion,
    records,
    startDownload,
  ]);

  return {
    availableOfflineWorkId,
    cancelDownload,
    downloadState,
    downloadWork,
    downloadedWorkIds,
    hasValidatedRecords,
    removeWork,
  };
}

function createStartedRecord({
  chapterUrls,
  previousRecord,
  stageCacheName,
  version,
}: {
  chapterUrls: string[];
  previousRecord: OfflineWorkRecord | undefined;
  stageCacheName: string;
  version: string;
}): OfflineWorkRecord {
  if (previousRecord?.complete) {
    return {
      ...previousRecord,
      pending: {
        cacheName: stageCacheName,
        chapterUrls,
        version,
      },
    };
  }

  return {
    cacheName: stageCacheName,
    chapterUrls,
    complete: false,
    completedAt: previousRecord?.completedAt ?? Date.now(),
    version,
  };
}

async function rollbackStartedRecord(
  bookId: string,
  previousRecord: OfflineWorkRecord | undefined,
  currentRecords: OfflineWorkRecords,
  persistRecords: (records: OfflineWorkRecords) => Promise<void>
) {
  if (previousRecord?.complete) {
    const { pending: _pending, ...activeRecord } = previousRecord;
    await persistRecords({
      ...removeRecord(currentRecords, bookId),
      [bookId]: activeRecord,
    });
    return;
  }

  await persistRecords(removeRecord(currentRecords, bookId));
}

function removeRecord(records: OfflineWorkRecords, bookId: string) {
  const { [bookId]: _removed, ...remaining } = records;
  return remaining;
}

async function validateOfflineWorkRecords(records: OfflineWorkRecords) {
  const validated: OfflineWorkRecords = {};

  for (const [workId, record] of Object.entries(records)) {
    const cache = await caches.open(record.cacheName);
    const complete = await every(record.chapterUrls, async (url) => {
      const response = await cache.match(url);
      return Boolean(
        response && (await isValidEarlyChristianChapterResponse(response))
      );
    });
    validated[workId] = { ...record, complete };
  }

  return validated;
}

async function requestPersistentStorageOnce() {
  try {
    if (window.localStorage.getItem(PERSISTENCE_REQUESTED_KEY)) {
      return;
    }

    window.localStorage.setItem(PERSISTENCE_REQUESTED_KEY, "1");

    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // Persistence is best-effort and never blocks a download.
  }
}

async function every<T>(
  values: T[],
  predicate: (value: T) => Promise<boolean>
) {
  for (const value of values) {
    if (!(await predicate(value))) {
      return false;
    }
  }

  return true;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function isQuotaExceeded(error: unknown) {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}

export async function isValidEarlyChristianChapterResponse(
  response: Response,
  expectedId?: string
) {
  try {
    const value: unknown = await response.clone().json();

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const chapter = value as { id?: unknown; verses?: unknown };
    return (
      typeof chapter.id === "string" &&
      (!expectedId || chapter.id === expectedId) &&
      Array.isArray(chapter.verses) &&
      chapter.verses.every(isValidVerse)
    );
  } catch {
    return false;
  }
}

function isValidVerse(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const verse = value as {
    modernizedText?: unknown;
    text?: unknown;
    verse?: unknown;
  };
  return (
    typeof verse.text === "string" &&
    typeof verse.verse === "number" &&
    (verse.modernizedText === undefined ||
      typeof verse.modernizedText === "string")
  );
}
