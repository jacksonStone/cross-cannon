import { useMemo, useState } from "react";

import { keywordMatches } from "~/features/search/keyword-match";
import { isBackdropClick } from "~/lib/use-dialog-dismiss";

import {
  dedupeBooks,
  formatBookOptionLabel,
  getBookAuthorLabel,
  getBookSearchText
} from "./book-index";
import { useFavoriteEarlyChristianBooks } from "./favorite-books";
import type { BookSummary, ChapterEntry } from "./types";

export function ChapterJump({
  activeChapterId,
  chapters,
  downloadedWorkIds,
  onClose,
  onJump
}: {
  activeChapterId: string;
  chapters: ChapterEntry[];
  downloadedWorkIds: ReadonlySet<string>;
  onClose: () => void;
  onJump: (chapterId: string) => void;
}) {
  const activeEntry = chapters.find((entry) => entry.chapter.id === activeChapterId)
    ?? chapters[0];
  const books = useMemo(() => dedupeBooks(chapters), [chapters]);
  const bookIds = useMemo(() => books.map((book) => book.id), [books]);
  const {
    favoriteBookIds,
    isFavoriteBook,
    toggleFavoriteBook
  } = useFavoriteEarlyChristianBooks(bookIds);
  const [selectedBookId, setSelectedBookId] = useState(activeEntry?.book.id ?? "");
  const [selectedAuthor, setSelectedAuthor] = useState("");
  const [workQuery, setWorkQuery] = useState("");
  const selectedBook = books.find((book) => book.id === selectedBookId)
    ?? activeEntry?.book;
  const bookChapters = selectedBook
    ? chapters.filter((entry) => entry.book.id === selectedBook.id)
    : [];
  const authorOptions = useMemo(() => (
    Array.from(new Set(books.map((book) => getBookAuthorLabel(book))))
      .sort((left, right) => left.localeCompare(right))
  ), [books]);
  const visibleBooks = useMemo(() => {
    const trimmedQuery = workQuery.trim();
    const authorMatches = (book: typeof books[number]) => (
      !selectedAuthor || getBookAuthorLabel(book) === selectedAuthor
    );

    if (trimmedQuery.length > 0) {
      return books
        .filter((book) => authorMatches(book) && keywordMatches(trimmedQuery, getBookSearchText(book)))
        .slice(0, 24);
    }

    const favoriteBooks = favoriteBookIds
      .map((bookId) => books.find((book) => book.id === bookId))
      .filter((book): book is BookSummary => {
        if (!book) {
          return false;
        }

        return authorMatches(book);
      });
    const selectedBooks = selectedBook && authorMatches(selectedBook) ? [selectedBook] : [];
    const promotedBookIds = new Set(
      [...favoriteBooks, ...selectedBooks].map((book) => book.id)
    );
    const unselectedMatches = books.filter((book) => (
      authorMatches(book) && !promotedBookIds.has(book.id)
    ));

    return [...favoriteBooks, ...selectedBooks, ...unselectedMatches].slice(0, 12);
  }, [books, favoriteBookIds, selectedAuthor, selectedBook, workQuery]);

  return (
    <div
      className="passage-jump-backdrop"
      onClick={(event) => {
        event.stopPropagation();

        if (isBackdropClick(event)) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby="passage-jump-title"
        aria-modal="true"
        className="passage-jump-modal ec-jump-modal"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="passage-jump-modal-header">
          <div>
            <p className="eyebrow">Jump</p>
            <h2 id="passage-jump-title">Choose a work</h2>
          </div>
          <button className="filter-modal-close" onClick={onClose} type="button">
            Close
          </button>
        </header>

        <div className="passage-jump-modal-body">
          <label className="passage-jump-book">
            <span>Find work</span>
            <input
              autoComplete="off"
              className="passage-jump-search"
              onChange={(event) => setWorkQuery(event.currentTarget.value)}
              placeholder="City of God"
              type="search"
              value={workQuery}
            />
          </label>
          <label className="passage-jump-book">
            <span>Author</span>
            <select
              className="passage-jump-search"
              onChange={(event) => setSelectedAuthor(event.currentTarget.value)}
              value={selectedAuthor}
            >
              <option value="">All authors</option>
              {authorOptions.map((author) => (
                <option key={author} value={author}>
                  {author}
                </option>
              ))}
            </select>
          </label>
          <div className="ec-work-options" aria-label="Works">
            {visibleBooks.length > 0 ? visibleBooks.map((book) => (
              <div
                className={[
                  "ec-work-option",
                  book.id === selectedBook?.id ? "is-selected" : ""
                ].filter(Boolean).join(" ")}
                key={book.id}
                title={formatBookOptionLabel(book)}
              >
                <button
                  className="ec-work-select"
                  onClick={() => setSelectedBookId(book.id)}
                  type="button"
                >
                  <span className="ec-work-title">{book.name}</span>
                  <span className="ec-work-meta">{getBookAuthorLabel(book)}</span>
                </button>
                {downloadedWorkIds.has(book.id) ? (
                  <span
                    aria-label={`${book.name} is available offline`}
                    className="ec-work-download"
                    title="Available offline"
                  >
                    ↓
                  </span>
                ) : null}
                <button
                  aria-label={`${isFavoriteBook(book.id) ? "Remove" : "Add"} ${book.name} ${isFavoriteBook(book.id) ? "from" : "to"} favorites`}
                  className={[
                    "ec-work-favorite",
                    isFavoriteBook(book.id) ? "is-favorite" : ""
                  ].filter(Boolean).join(" ")}
                  onClick={() => toggleFavoriteBook(book.id)}
                  title={isFavoriteBook(book.id) ? "Remove favorite" : "Favorite work"}
                  type="button"
                >
                  {isFavoriteBook(book.id) ? "★" : "☆"}
                </button>
              </div>
            )) : (
              <p className="passage-jump-empty">No matches</p>
            )}
          </div>

          <div className="passage-jump-group" aria-label="Chapter">
            <span>Chapter</span>
            <div className="passage-jump-options">
              {bookChapters.map((entry) => (
                <button
                  className={entry.chapter.id === activeChapterId ? "is-selected" : undefined}
                  key={entry.chapter.id}
                  onClick={() => onJump(entry.chapter.id)}
                  title={entry.chapter.title}
                  type="button"
                >
                  {entry.chapter.chapter}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
