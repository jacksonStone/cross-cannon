import type { MutableRefObject } from "react";

type ReaderPositionRefs = {
  lastReportedRef?: MutableRefObject<string>;
  savedRef?: MutableRefObject<string>;
};

export type ReaderCorpus = "fathers" | "scripture";

export type ReaderLocation = {
  chapterKey: string;
  corpus: ReaderCorpus;
  passageKey?: string;
  passageRange?: string;
  version: 2;
};

export function readReaderPosition(storageKey: string) {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey) ?? "";
    const parsedLocation = parseReaderLocation(storedValue);

    return parsedLocation?.chapterKey ?? storedValue;
  } catch {
    return "";
  }
}

export function readReaderLocation(
  storageKey: string,
  corpus: ReaderCorpus
): ReaderLocation | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return parseReaderLocation(window.localStorage.getItem(storageKey), corpus);
  } catch {
    return null;
  }
}

export function rememberReaderPosition(
  storageKey: string,
  position: string,
  refs: ReaderPositionRefs = {}
) {
  if (!position) {
    return false;
  }

  const hasLastReportedRef = Boolean(refs.lastReportedRef);
  const hasSavedRef = Boolean(refs.savedRef);
  const isAlreadyReported = !hasLastReportedRef || refs.lastReportedRef?.current === position;
  const isAlreadySaved = !hasSavedRef || refs.savedRef?.current === position;

  if ((hasLastReportedRef || hasSavedRef) && isAlreadyReported && isAlreadySaved) {
    return false;
  }

  if (typeof window === "undefined") {
    return false;
  }

  try {
    window.localStorage.setItem(storageKey, position);
  } catch {
    return false;
  }

  if (refs.savedRef) {
    refs.savedRef.current = position;
  }

  if (refs.lastReportedRef) {
    refs.lastReportedRef.current = position;
  }

  return true;
}

export function rememberReaderLocation(
  storageKey: string,
  location: ReaderLocation,
  refs: ReaderPositionRefs = {}
) {
  if (!location.chapterKey) {
    return false;
  }

  const locationKey = readerLocationKey(location);
  const hasLastReportedRef = Boolean(refs.lastReportedRef);
  const hasSavedRef = Boolean(refs.savedRef);
  const isAlreadyReported = !hasLastReportedRef || refs.lastReportedRef?.current === locationKey;
  const isAlreadySaved = !hasSavedRef || refs.savedRef?.current === locationKey;

  if ((hasLastReportedRef || hasSavedRef) && isAlreadyReported && isAlreadySaved) {
    return false;
  }

  if (typeof window === "undefined") {
    return false;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(location));
  } catch {
    return false;
  }

  if (refs.savedRef) {
    refs.savedRef.current = locationKey;
  }

  if (refs.lastReportedRef) {
    refs.lastReportedRef.current = locationKey;
  }

  return true;
}

export function readerLocationKey(location: ReaderLocation | null) {
  if (!location) {
    return "";
  }

  return [
    location.corpus,
    location.chapterKey,
    location.passageKey ?? "",
    location.passageRange ?? ""
  ].join("\t");
}

export function createReaderLocation({
  chapterKey,
  corpus,
  passageKey,
  passageRange
}: Omit<ReaderLocation, "version">): ReaderLocation {
  return {
    chapterKey,
    corpus,
    passageKey,
    passageRange,
    version: 2
  };
}

function parseReaderLocation(
  storedValue: string | null,
  expectedCorpus?: ReaderCorpus
): ReaderLocation | null {
  if (!storedValue) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(storedValue) as Partial<ReaderLocation>;

    if (
      parsedValue
      && parsedValue.version === 2
      && isReaderCorpus(parsedValue.corpus)
      && typeof parsedValue.chapterKey === "string"
      && parsedValue.chapterKey
      && (!expectedCorpus || parsedValue.corpus === expectedCorpus)
    ) {
      return {
        chapterKey: parsedValue.chapterKey,
        corpus: parsedValue.corpus,
        passageKey: typeof parsedValue.passageKey === "string"
          ? parsedValue.passageKey
          : undefined,
        passageRange: typeof parsedValue.passageRange === "string"
          ? parsedValue.passageRange
          : undefined,
        version: 2
      };
    }
  } catch {
    // Legacy storage used the raw chapter key string.
  }

  return expectedCorpus && storedValue
    ? createReaderLocation({
      chapterKey: storedValue,
      corpus: expectedCorpus
    })
    : null;
}

function isReaderCorpus(value: unknown): value is ReaderCorpus {
  return value === "fathers" || value === "scripture";
}
