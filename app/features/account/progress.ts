import type { ReaderCorpus, ReaderLocation } from "../reader-position/reader-position";

export const READER_PROGRESS = {
  scripture: { label: "Scripture", storageKey: "cross-cannon:reader-position:v1" },
  fathers: { label: "Early Christian Works", storageKey: "cross-cannon:church-fathers-position:v1" },
  classics: { label: "Christian Classics", storageKey: "cross-cannon:christian-classics-position:v1" },
} as const;

export type SavedProgress = { location: ReaderLocation; revision: number };
export type Progress = Partial<Record<ReaderCorpus, SavedProgress>>;
export const CORPORA = Object.keys(READER_PROGRESS) as ReaderCorpus[];

export function parseLocation(value: unknown): ReaderLocation | null {
  if (!value || typeof value !== "object") return null;
  const location = value as Record<string, unknown>;
  if (location.version !== 2 || !CORPORA.includes(location.corpus as ReaderCorpus)
    || typeof location.chapterKey !== "string" || !location.chapterKey.trim()
    || location.chapterKey.length > 300) return null;
  for (const field of ["passageKey", "passageRange"]) {
    if (location[field] !== undefined && (typeof location[field] !== "string"
      || location[field].length > 300)) return null;
  }
  return {
    version: 2, corpus: location.corpus as ReaderCorpus, chapterKey: location.chapterKey,
    passageKey: location.passageKey as string | undefined,
    passageRange: location.passageRange as string | undefined,
  };
}

export function progressUrl(location: ReaderLocation) {
  if (location.corpus === "scripture") {
    return location.passageKey ? `/reader/${encodeURIComponent(location.passageKey)}` : "/?reader=scripture";
  }
  const params = new URLSearchParams({ chapter: location.chapterKey });
  if (location.passageRange) params.set("passage", location.passageRange);
  return `${location.corpus === "fathers" ? "/church-fathers" : "/christian-classics/read"}?${params}`;
}
