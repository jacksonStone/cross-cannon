import { useEffect, useMemo, useState } from "react";

import { isRecord, isUnknownArray, parseJson } from "~/lib/json";

import {
  BOOKS_BY_CANON,
  DEFAULT_CANON,
  DEFAULT_MATCH_COUNT,
  FILTER_STORAGE_KEY,
  parseCanonMode
} from "./canons";
import type { CanonMode, StoredFilters } from "./types";

type SearchFilterActionData = {
  books?: string[];
  canon?: CanonMode;
  earlyChristianAuthors?: string[];
  matchCount?: number;
};

type UseSearchFiltersOptions = {
  actionData?: SearchFilterActionData;
  books: string[];
  earlyChristianAuthors?: string[];
  persist?: boolean;
};

const MAX_EARLY_CHRISTIAN_AUTHOR_FILTERS = 3;

export function useSearchFilters({
  actionData,
  books,
  earlyChristianAuthors = [],
  persist = true
}: UseSearchFiltersOptions) {
  const [canon, setCanon] = useState<CanonMode>(actionData?.canon ?? DEFAULT_CANON);
  const [matchCount, setMatchCount] = useState(actionData?.matchCount ?? DEFAULT_MATCH_COUNT);
  const [selectedBooks, setSelectedBooks] = useState<string[]>(() => actionData?.books ?? []);
  const [selectedEarlyChristianAuthors, setSelectedEarlyChristianAuthors] = useState<string[]>(
    () => actionData?.earlyChristianAuthors ?? []
  );
  const [hasLoadedStoredFilters, setHasLoadedStoredFilters] = useState(!persist);
  const visibleBooks = useMemo(
    () => books.filter((book) => BOOKS_BY_CANON[canon].has(book)),
    [books, canon]
  );
  const selectedBooksForCanon = useMemo(
    () => selectedBooks.filter((book) => BOOKS_BY_CANON[canon].has(book)),
    [canon, selectedBooks]
  );
  const selectedKnownEarlyChristianAuthors = useMemo(() => {
    const knownAuthors = new Set(earlyChristianAuthors);
    return selectedEarlyChristianAuthors.filter((author) => knownAuthors.has(author));
  }, [earlyChristianAuthors, selectedEarlyChristianAuthors]);
  const activeFilterCount = (matchCount === DEFAULT_MATCH_COUNT ? 0 : 1)
    + selectedBooksForCanon.length
    + selectedKnownEarlyChristianAuthors.length;

  useEffect(() => {
    if (!persist) {
      return;
    }

    if (hasLoadedStoredFilters) {
      return;
    }

    if (actionData) {
      setHasLoadedStoredFilters(true);
      return;
    }

    try {
      const rawFilters = window.localStorage.getItem(FILTER_STORAGE_KEY);

      if (!rawFilters) {
        setHasLoadedStoredFilters(true);
        return;
      }

      const parsedFilters = parseJson(rawFilters);

      if (!isRecord(parsedFilters)) {
        setHasLoadedStoredFilters(true);
        return;
      }

      const storedCanon = parseCanonMode(String(parsedFilters.canon ?? ""));
      const storedMatchCount = parsedFilters.matchCount;
      const indexedBooks = new Set(books);

      setCanon(storedCanon);

      if (
        typeof storedMatchCount === "number"
        && Number.isInteger(storedMatchCount)
        && storedMatchCount >= 5
        && storedMatchCount <= 40
      ) {
        setMatchCount(storedMatchCount);
      }

      if (isUnknownArray(parsedFilters.books)) {
        setSelectedBooks(
          parsedFilters.books
            .map((book) => String(book))
            .filter((book) => indexedBooks.has(book) && BOOKS_BY_CANON[storedCanon].has(book))
        );
      }

      if (isUnknownArray(parsedFilters.earlyChristianAuthors)) {
        const knownAuthors = new Set(earlyChristianAuthors);
        setSelectedEarlyChristianAuthors(
          parsedFilters.earlyChristianAuthors
            .map((author) => String(author))
            .filter((author) => knownAuthors.has(author))
            .slice(0, MAX_EARLY_CHRISTIAN_AUTHOR_FILTERS)
        );
      }
    } catch {
      window.localStorage.removeItem(FILTER_STORAGE_KEY);
    } finally {
      setHasLoadedStoredFilters(true);
    }
  }, [actionData, books, earlyChristianAuthors, hasLoadedStoredFilters, persist]);

  useEffect(() => {
    if (!actionData) {
      return;
    }

    if (actionData.canon) {
      setCanon(actionData.canon);
    }

    if (typeof actionData.matchCount === "number") {
      setMatchCount(actionData.matchCount);
    }

    if (actionData.books) {
      setSelectedBooks(actionData.books);
    }

    if (actionData.earlyChristianAuthors) {
      setSelectedEarlyChristianAuthors(actionData.earlyChristianAuthors);
    }
  }, [
    actionData?.books,
    actionData?.canon,
    actionData?.earlyChristianAuthors,
    actionData?.matchCount
  ]);

  useEffect(() => {
    if (!persist || !hasLoadedStoredFilters) {
      return;
    }

    const filters = {
      canon,
      matchCount,
      books: selectedBooksForCanon,
      earlyChristianAuthors: selectedKnownEarlyChristianAuthors
    } satisfies StoredFilters;

    window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
  }, [
    canon,
    hasLoadedStoredFilters,
    matchCount,
    persist,
    selectedBooksForCanon,
    selectedKnownEarlyChristianAuthors
  ]);

  function updateCanon(nextCanon: CanonMode) {
    setCanon(nextCanon);
    setSelectedBooks((currentBooks) =>
      currentBooks.filter((book) => BOOKS_BY_CANON[nextCanon].has(book))
    );
  }

  function toggleSelectedBook(book: string) {
    setSelectedBooks((currentBooks) =>
      currentBooks.includes(book)
        ? currentBooks.filter((selectedBook) => selectedBook !== book)
        : [...currentBooks, book]
    );
  }

  function toggleEarlyChristianAuthor(author: string) {
    if (!earlyChristianAuthors.includes(author)) {
      return;
    }

    setSelectedEarlyChristianAuthors((currentAuthors) => {
      if (currentAuthors.includes(author)) {
        return currentAuthors.filter((selectedAuthor) => selectedAuthor !== author);
      }

      if (currentAuthors.length >= MAX_EARLY_CHRISTIAN_AUTHOR_FILTERS) {
        return currentAuthors;
      }

      return [...currentAuthors, author];
    });
  }

  function clearFilters() {
    setMatchCount(DEFAULT_MATCH_COUNT);
    setSelectedBooks([]);
    setSelectedEarlyChristianAuthors([]);
  }

  return {
    activeFilterCount,
    canon,
    clearFilters,
    matchCount,
    selectedEarlyChristianAuthors: selectedKnownEarlyChristianAuthors,
    selectedBooksForCanon,
    setMatchCount,
    toggleEarlyChristianAuthor,
    toggleSelectedBook,
    updateCanon,
    visibleBooks
  };
}
