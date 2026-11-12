import { useCallback, useEffect, useState } from "react";

import { DEFAULT_MATCH_COUNT } from "./canons";
import {
  getSearchDialogFilterState,
  getSearchDialogIntent,
  type SearchReaderCorpus,
  resolveSearchDialogTarget,
} from "./search-dialog-model";
import type { CanonMode, SearchTargetCorpus } from "./types";
import { useSearchFilters } from "./useSearchFilters";

type SearchDialogActionData = {
  books?: string[];
  canon?: CanonMode;
  earlyChristianAuthors?: string[];
  matchCount?: number;
  mode?: string;
  targetCorpus?: SearchTargetCorpus;
};

export function useSearchDialogState({
  actionData,
  books,
  earlyChristianAuthors,
  classicAuthors = [],
  focusedPassageId,
  persistFilters = true,
  readerCorpus,
}: {
  actionData?: SearchDialogActionData;
  books: string[];
  earlyChristianAuthors: string[];
  classicAuthors?: string[];
  focusedPassageId: string | null;
  persistFilters?: boolean;
  readerCorpus: SearchReaderCorpus;
}) {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [targetCorpus, setTargetCorpus] =
    useState<SearchTargetCorpus>(readerCorpus);
  const filters = useSearchFilters({
    actionData,
    books,
    earlyChristianAuthors:
      targetCorpus === "christian-classics"
        ? classicAuthors
        : earlyChristianAuthors,
    persist: persistFilters,
  });
  const filterState = getSearchDialogFilterState({
    authorCount: filters.selectedEarlyChristianAuthors.length,
    bookCount: filters.selectedBooksForCanon.length,
    isDefaultMatchCount: filters.matchCount === DEFAULT_MATCH_COUNT,
    targetCorpus,
  });
  const intent = getSearchDialogIntent({
    hasFocusedPassage: Boolean(focusedPassageId),
    readerCorpus,
    targetCorpus,
  });
  const closeFilters = useCallback(() => setIsFilterOpen(false), []);
  const openFilters = useCallback(() => setIsFilterOpen(true), []);

  useEffect(() => {
    setTargetCorpus(
      resolveSearchDialogTarget({
        actionMode: actionData?.mode,
        actionTargetCorpus: actionData?.targetCorpus,
        readerCorpus,
      })
    );
  }, [actionData?.mode, actionData?.targetCorpus, readerCorpus]);

  return {
    ...filters,
    ...filterState,
    closeFilters,
    intent,
    isFilterOpen,
    openFilters,
    setTargetCorpus: (next: SearchTargetCorpus) => {
      if (
        next !== targetCorpus &&
        (next === "christian-classics" || targetCorpus === "christian-classics")
      )
        filters.clearAuthorFilters();
      setTargetCorpus(next);
    },
    targetCorpus,
  };
}

export type SearchDialogState = ReturnType<typeof useSearchDialogState>;
