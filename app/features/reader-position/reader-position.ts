import type { MutableRefObject } from "react";

type ReaderPositionRefs = {
  lastReportedRef?: MutableRefObject<string>;
  savedRef?: MutableRefObject<string>;
};

export function readReaderPosition(storageKey: string) {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return window.localStorage.getItem(storageKey) ?? "";
  } catch {
    return "";
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
