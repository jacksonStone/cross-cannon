import { useEffect } from "react";

import { parseCanonMode } from "./canons";
import type { CanonMode } from "./types";

type FilterModalProps = {
  canon: CanonMode;
  isOpen: boolean;
  isSearching: boolean;
  matchCount: number;
  selectedBooks: string[];
  visibleBooks: string[];
  onCanonChange: (canon: CanonMode) => void;
  onClearFilters: () => void;
  onClose: () => void;
  onMatchCountChange: (matchCount: number) => void;
  onToggleBook: (book: string) => void;
};

export function FilterModal({
  canon,
  isOpen,
  isSearching,
  matchCount,
  selectedBooks,
  visibleBooks,
  onCanonChange,
  onClearFilters,
  onClose,
  onMatchCountChange,
  onToggleBook
}: FilterModalProps) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="filter-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby="filter-modal-title"
        aria-modal="true"
        className="filter-modal"
        id="filter-modal"
        role="dialog"
      >
        <div className="filter-modal-header">
          <h2 id="filter-modal-title">Filters</h2>
          <button
            className="filter-modal-close"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
        <div className="filter-modal-body">
          <fieldset className="canon-control" disabled={isSearching}>
            <legend>Canon</legend>
            <select
              aria-label="Canon"
              onChange={(event) => onCanonChange(parseCanonMode(event.currentTarget.value))}
              value={canon}
            >
              <option value="protestant">Protestant</option>
              <option value="catholic">Catholic</option>
              <option value="orthodox">Orthodox</option>
            </select>
          </fieldset>
          <fieldset className="match-control" disabled={isSearching}>
            <legend>Matches</legend>
            <input
              aria-label="Matches"
              type="number"
              min={5}
              max={40}
              step={1}
              value={matchCount}
              onChange={(event) => onMatchCountChange(Number(event.currentTarget.value))}
            />
          </fieldset>
          <fieldset className="book-picker" disabled={isSearching}>
            <legend>Books</legend>
            <p className="book-picker-hint">Leave blank to search every book in this canon.</p>
            <div className="book-options">
              {visibleBooks.map((book) => (
                <label className="book-option" key={book}>
                  <input
                    type="checkbox"
                    value={book}
                    checked={selectedBooks.includes(book)}
                    onChange={() => onToggleBook(book)}
                  />
                  {book}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="filter-modal-actions">
          <button className="secondary-button" onClick={onClearFilters} type="button">
            Clear all
          </button>
          <button onClick={onClose} type="button">
            Done
          </button>
        </div>
      </section>
    </div>
  );
}
