import { useCallback, useEffect, useMemo, useState } from "react";

const FAVORITE_BOOKS_STORAGE_KEY = "cross-cannon:church-fathers-favorite-books:v1";

export function useFavoriteEarlyChristianBooks(knownBookIds: string[]) {
  const knownBookIdSet = useMemo(() => new Set(knownBookIds), [knownBookIds]);
  const [favoriteBookIds, setFavoriteBookIds] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const parsed: unknown = JSON.parse(
        window.localStorage.getItem(FAVORITE_BOOKS_STORAGE_KEY) ?? "[]"
      );

      if (!Array.isArray(parsed)) {
        return;
      }

      setFavoriteBookIds(
        parsed
          .filter((bookId): bookId is string => (
            typeof bookId === "string" && knownBookIdSet.has(bookId)
          ))
      );
    } catch {
      window.localStorage.removeItem(FAVORITE_BOOKS_STORAGE_KEY);
    }
  }, [knownBookIdSet]);

  const rememberFavoriteBookIds = useCallback((bookIds: string[]) => {
    setFavoriteBookIds(bookIds);

    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(FAVORITE_BOOKS_STORAGE_KEY, JSON.stringify(bookIds));
  }, []);

  const toggleFavoriteBook = useCallback((bookId: string) => {
    if (!knownBookIdSet.has(bookId)) {
      return;
    }

    rememberFavoriteBookIds(
      favoriteBookIds.includes(bookId)
        ? favoriteBookIds.filter((favoriteBookId) => favoriteBookId !== bookId)
        : [...favoriteBookIds, bookId]
    );
  }, [favoriteBookIds, knownBookIdSet, rememberFavoriteBookIds]);

  const isFavoriteBook = useCallback((bookId: string) => (
    favoriteBookIds.includes(bookId)
  ), [favoriteBookIds]);

  return {
    favoriteBookIds,
    isFavoriteBook,
    toggleFavoriteBook
  };
}
