import type { ReaderCorpus, ReaderLocation } from "../reader-position/reader-position";
import { CORPORA, parseLocation, READER_PROGRESS, type Progress, type SavedProgress } from "./progress";

export const ACCOUNT_STORAGE_KEY = "cross-cannon:active-account:v1";
export const PROGRESS_EVENT = "cross-cannon:progress-change";
type LocalProgress = SavedProgress & { dirty: boolean; conflict?: SavedProgress };
// The browser waits for the session check before reader effects can write defaults.
let ready = typeof window === "undefined";
export function enableProgressStorage() { ready = true; }
export function progressStorageReady() { return ready; }

export function activeAccount() {
  try { return window.localStorage.getItem(ACCOUNT_STORAGE_KEY); } catch { return null; }
}

export function activateAccount(id: string | null) {
  if (id) window.localStorage.setItem(ACCOUNT_STORAGE_KEY, id);
  else window.localStorage.removeItem(ACCOUNT_STORAGE_KEY);
}

function progressKey(userId: string, corpus: ReaderCorpus) {
  return `cross-cannon:account:${userId}:progress:${corpus}:v1`;
}

export function readerStorageKey(key: string) {
  const userId = activeAccount();
  return userId && CORPORA.some((corpus) => READER_PROGRESS[corpus].storageKey === key)
    ? `${key}:account:${userId}` : key;
}

export function localProgress(userId: string, corpus: ReaderCorpus): LocalProgress | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(progressKey(userId, corpus)) ?? "null");
    const location = parseLocation(value?.location);
    return location && location.corpus === corpus && Number.isSafeInteger(value.revision) && value.revision >= 0
      ? { ...value, location } : null;
  } catch { return null; }
}

export function sameLocation(a: ReaderLocation, b: ReaderLocation) {
  return a.corpus === b.corpus && a.chapterKey === b.chapterKey
    && (a.passageKey ?? "") === (b.passageKey ?? "")
    && (a.passageRange ?? "") === (b.passageRange ?? "");
}

export function writeLocalProgress(userId: string, corpus: ReaderCorpus, value: LocalProgress) {
  window.localStorage.setItem(progressKey(userId, corpus), JSON.stringify(value));
  window.localStorage.setItem(`${READER_PROGRESS[corpus].storageKey}:account:${userId}`, JSON.stringify(value.location));
}

export function queueReaderProgress(location: ReaderLocation) {
  const userId = activeAccount();
  if (!userId) return;
  const previous = localProgress(userId, location.corpus);
  if (previous && sameLocation(previous.location, location)) return;
  writeLocalProgress(userId, location.corpus, {
    ...previous, location, revision: previous?.revision ?? 0, dirty: true,
  });
  window.dispatchEvent(new Event(PROGRESS_EVENT));
}

export function reconcileProgress(userId: string, remote: Progress) {
  for (const corpus of CORPORA) {
    const cloud = remote[corpus];
    const local = localProgress(userId, corpus);
    if (!cloud) continue;
    if (!local?.dirty || sameLocation(local.location, cloud.location)) {
      writeLocalProgress(userId, corpus, { ...cloud, dirty: false });
    } else if (local.revision !== cloud.revision) {
      writeLocalProgress(userId, corpus, { ...local, conflict: cloud });
    }
  }
}

export function importGuestProgress(userId: string) {
  for (const corpus of CORPORA) {
    const raw = window.localStorage.getItem(READER_PROGRESS[corpus].storageKey);
    if (!raw) continue;
    let location: ReaderLocation | null;
    try { location = parseLocation(JSON.parse(raw)); } catch {
      location = { version: 2, corpus, chapterKey: raw };
    }
    if (!location || location.corpus !== corpus) continue;
    const previous = localProgress(userId, corpus);
    writeLocalProgress(userId, corpus, {
      location, revision: previous?.revision ?? 0, dirty: true,
      conflict: previous ? { location: previous.location, revision: previous.revision } : undefined,
    });
  }
  window.dispatchEvent(new Event(PROGRESS_EVENT));
}
