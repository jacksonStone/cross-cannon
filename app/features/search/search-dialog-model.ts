import type { SearchTargetCorpus } from "./types";

export type SearchReaderCorpus = "scripture" | "early-christian";

export type SearchDialogIntent =
  | "theme"
  | "theme-early-christian"
  | "theme-scripture"
  | "similar-passage"
  | "similar-early-christian"
  | "similar-scripture";

export function getSearchDialogIntent({
  hasFocusedPassage,
  readerCorpus,
  targetCorpus
}: {
  hasFocusedPassage: boolean;
  readerCorpus: SearchReaderCorpus;
  targetCorpus: SearchTargetCorpus;
}): SearchDialogIntent {
  if (readerCorpus === "scripture") {
    if (hasFocusedPassage) {
      return targetCorpus === "scripture"
        ? "similar-passage"
        : "similar-early-christian";
    }

    return targetCorpus === "scripture" ? "theme" : "theme-early-christian";
  }

  if (hasFocusedPassage) {
    return targetCorpus === "scripture" ? "similar-scripture" : "similar-passage";
  }

  return targetCorpus === "scripture" ? "theme-scripture" : "theme";
}

export function getSearchDialogFilterState({
  authorCount,
  bookCount,
  isDefaultMatchCount,
  targetCorpus
}: {
  authorCount: number;
  bookCount: number;
  isDefaultMatchCount: boolean;
  targetCorpus: SearchTargetCorpus;
}) {
  const showScriptureFilters = targetCorpus === "scripture";
  const showAuthorFilters = targetCorpus === "early-christian";

  return {
    activeFilterCount: (isDefaultMatchCount ? 0 : 1)
      + (showScriptureFilters ? bookCount : authorCount),
    showAuthorFilters,
    showScriptureFilters
  };
}

export function resolveSearchDialogTarget({
  actionMode,
  actionTargetCorpus,
  readerCorpus
}: {
  actionMode?: string;
  actionTargetCorpus?: SearchTargetCorpus;
  readerCorpus: SearchReaderCorpus;
}): SearchTargetCorpus {
  if (actionTargetCorpus) {
    return actionTargetCorpus;
  }

  if (actionMode === "theme-scripture" || actionMode === "similar-scripture") {
    return "scripture";
  }

  if (
    actionMode === "theme-early-christian"
    || actionMode === "similar-early-christian"
  ) {
    return "early-christian";
  }

  return readerCorpus;
}
