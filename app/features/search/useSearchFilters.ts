import { useEffect, useMemo, useState } from "react";

import {
  BOOKS_BY_CANON,
  DEFAULT_CANON,
  DEFAULT_MATCH_COUNT,
  FILTER_STORAGE_KEY,
  parseCanonMode
} from "./canons";
import type { CanonMode, SearchActionData, StoredFilters } from "./types";

type UseSearchFiltersOptions = {
  actionData?: SearchActionData;
  books: string[];
};

export function useSearchFilters({ actionData, books }: UseSearchFiltersOptions) {
  const [canon, setCanon] = useState<CanonMode>(actionData?.canon ?? DEFAULT_CANON);
  const [matchCount, setMatchCount] = useState(actionData?.matchCount ?? DEFAULT_MATCH_COUNT);
  const [selectedBooks, setSelectedBooks] = useState<string[]>(() => actionData?.books ?? []);
  const [hasLoadedStoredFilters, setHasLoadedStoredFilters] = useState(false);
  const visibleBooks = useMemo(
    () => books.filter((book) => BOOKS_BY_CANON[canon].has(book)),
    [books, canon]
  );
  const selectedBooksForCanon = useMemo(
    () => selectedBooks.filter((book) => BOOKS_BY_CANON[canon].has(book)),
    [canon, selectedBooks]
  );
  const activeFilterCount = (matchCount === DEFAULT_MATCH_COUNT ? 0 : 1)
    + selectedBooksForCanon.length;

  useEffect(() => {
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

      const parsedFilters = JSON.parse(rawFilters) as StoredFilters;
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

      if (Array.isArray(parsedFilters.books)) {
        setSelectedBooks(
          parsedFilters.books
            .map((book) => String(book))
            .filter((book) => indexedBooks.has(book) && BOOKS_BY_CANON[storedCanon].has(book))
        );
      }
    } catch {
      window.localStorage.removeItem(FILTER_STORAGE_KEY);
    } finally {
      setHasLoadedStoredFilters(true);
    }
  }, [actionData, books, hasLoadedStoredFilters]);

  useEffect(() => {
    if (!hasLoadedStoredFilters) {
      return;
    }

    const filters = {
      canon,
      matchCount,
      books: selectedBooksForCanon
    } satisfies StoredFilters;

    window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
  }, [canon, hasLoadedStoredFilters, matchCount, selectedBooksForCanon]);

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

  function clearFilters() {
    setMatchCount(DEFAULT_MATCH_COUNT);
    setSelectedBooks([]);
  }

  return {
    activeFilterCount,
    canon,
    clearFilters,
    matchCount,
    selectedBooksForCanon,
    setMatchCount,
    toggleSelectedBook,
    updateCanon,
    visibleBooks
  };
}
