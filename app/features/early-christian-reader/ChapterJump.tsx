import { useMemo, useState } from "react";

import { keywordMatches } from "~/features/search/keyword-match";
import { isBackdropClick } from "~/lib/use-dialog-dismiss";

import {
  dedupeBooks,
  formatBookOptionLabel,
  getBookAuthorLabel,
  getBookSearchText
} from "./book-index";
import type { ChapterEntry } from "./types";

export function ChapterJump({
  activeChapterId,
  chapters,
  onClose,
  onJump
}: {
  activeChapterId: string;
  chapters: ChapterEntry[];
  onClose: () => void;
  onJump: (chapterId: string) => void;
}) {
  const activeEntry = chapters.find((entry) => entry.chapter.id === activeChapterId)
    ?? chapters[0];
  const books = useMemo(() => dedupeBooks(chapters), [chapters]);
  const [selectedBookId, setSelectedBookId] = useState(activeEntry?.book.id ?? "");
  const [workQuery, setWorkQuery] = useState("");
  const selectedBook = books.find((book) => book.id === selectedBookId)
    ?? activeEntry?.book;
  const bookChapters = selectedBook
    ? chapters.filter((entry) => entry.book.id === selectedBook.id)
    : [];
  const visibleBooks = useMemo(() => {
    const trimmedQuery = workQuery.trim();

    if (trimmedQuery.length > 0) {
      return books
        .filter((book) => keywordMatches(trimmedQuery, getBookSearchText(book)))
        .slice(0, 24);
    }

    const selectedBooks = selectedBook ? [selectedBook] : [];
    const selectedBookIds = new Set(selectedBooks.map((book) => book.id));
    const unselectedMatches = books.filter((book) => !selectedBookIds.has(book.id));

    return [...selectedBooks, ...unselectedMatches].slice(0, 12);
  }, [books, selectedBook, workQuery]);

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
          <div className="ec-work-options" aria-label="Works">
            {visibleBooks.length > 0 ? visibleBooks.map((book) => (
              <button
                className={[
                  "ec-work-option",
                  book.id === selectedBook?.id ? "is-selected" : ""
                ].filter(Boolean).join(" ")}
                key={book.id}
                onClick={() => setSelectedBookId(book.id)}
                title={formatBookOptionLabel(book)}
                type="button"
              >
                <span className="ec-work-title">{book.name}</span>
                <span className="ec-work-meta">{getBookAuthorLabel(book)}</span>
              </button>
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
