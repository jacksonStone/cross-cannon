import type { StoredFilters } from "~/features/search/types";

export type ReaderHistoryMode = "push" | "replace";

export function buildScriptureReaderUrl(
  passageId: string,
  filters?: StoredFilters
) {
  const searchParams = new URLSearchParams();

  if (filters?.canon) {
    searchParams.set("canon", filters.canon);
  }

  if (filters?.matchCount) {
    searchParams.set("matchCount", String(filters.matchCount));
  }

  for (const book of filters?.books ?? []) {
    searchParams.append("books", book);
  }

  const query = searchParams.toString();
  return `/reader/${passageId}${query ? `?${query}` : ""}`;
}

export function buildEarlyChristianReaderUrl(
  chapterId: string,
  passageRange = ""
) {
  const searchParams = new URLSearchParams();

  if (chapterId) {
    searchParams.set("chapter", chapterId);
  }

  if (passageRange) {
    searchParams.set("passage", passageRange);
  }

  const query = searchParams.toString();
  return `/church-fathers${query ? `?${query}` : ""}`;
}

export function updateReaderUrl(url: string, mode: ReaderHistoryMode) {
  if (typeof window === "undefined") {
    return;
  }

  if (mode === "push") {
    window.history.pushState(null, "", url);
    return;
  }

  window.history.replaceState(null, "", url);
}
