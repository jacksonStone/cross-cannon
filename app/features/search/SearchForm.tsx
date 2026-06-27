import { useEffect, useRef, useState } from "react";

import { Form, useNavigation } from "@remix-run/react";

import { FilterModal } from "./FilterModal";
import type { SearchActionData } from "./types";
import { useSearchFilters } from "./useSearchFilters";

const SEARCH_EXAMPLES = [
  "Hope after death",
  "greed and money problems",
  "anxiety",
  "laughing when times are hard",
  "always learning",
  "the beauty of nature"
];

type SearchFormProps = {
  actionData?: SearchActionData;
  books: string[];
  isScriptureReady: boolean;
};

export function SearchForm({ actionData, books, isScriptureReady }: SearchFormProps) {
  const navigation = useNavigation();
  const submittingRef = useRef(false);
  const [exampleIndex, setExampleIndex] = useState(0);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const isSearching = navigation.state === "submitting";
  const isSearchingAllBooks =
    isSearching && (navigation.formData?.getAll("books").length ?? 0) === 0;
  const {
    activeFilterCount,
    canon,
    clearFilters,
    matchCount,
    selectedBooksForCanon,
    setMatchCount,
    toggleSelectedBook,
    updateCanon,
    visibleBooks
  } = useSearchFilters({ actionData, books });

  useEffect(() => {
    if (navigation.state === "idle") {
      submittingRef.current = false;
    }
  }, [navigation.state]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setExampleIndex((index) => (index + 1) % SEARCH_EXAMPLES.length);
    }, 2800);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <section
      className={`search-band${isSearching ? " is-searching" : ""}`}
      aria-busy={isSearching}
      aria-label="Scripture search"
    >
      <Form
        method="post"
        className="search-form"
        onSubmit={(event) => {
          if (submittingRef.current) {
            event.preventDefault();
            return;
          }

          submittingRef.current = true;
        }}
      >
        <label htmlFor="question">Search for passages about...</label>
        <input type="hidden" name="canon" value={canon} />
        <input type="hidden" name="matchCount" value={matchCount} />
        {selectedBooksForCanon.map((book) => (
          <input key={book} type="hidden" name="books" value={book} />
        ))}
        <div className="search-row">
          <div className="search-primary">
            <textarea
              id="question"
              name="question"
              rows={4}
              minLength={3}
              maxLength={500}
              required
              disabled={isSearching}
              placeholder={SEARCH_EXAMPLES[exampleIndex]}
              defaultValue={actionData?.question ?? ""}
            />
          </div>
          <div className="search-actions">
            <button
              aria-expanded={isFilterModalOpen}
              aria-controls="filter-modal"
              className={`filter-toggle${activeFilterCount > 0 ? " is-active" : ""}`}
              disabled={isSearching}
              onClick={() => setIsFilterModalOpen(true)}
              type="button"
            >
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </button>
            <button
              className="search-button"
              type="submit"
              disabled={isSearching || !isScriptureReady}
            >
              {isSearching ? (
                <>
                  <span className="button-spinner" aria-hidden="true" />
                  Searching
                </>
              ) : !isScriptureReady ? (
                "Loading text"
              ) : (
                "Search"
              )}
            </button>
            {isSearching ? (
              <p className="search-status" role="status">
                {isSearchingAllBooks
                  ? "Searching the selected canon..."
                  : "Searching selected books..."}
              </p>
            ) : !isScriptureReady ? (
              <p className="search-status" role="status">
                Loading scripture text...
              </p>
            ) : null}
          </div>
        </div>
        <FilterModal
          canon={canon}
          isOpen={isFilterModalOpen}
          isSearching={isSearching}
          matchCount={matchCount}
          selectedBooks={selectedBooksForCanon}
          visibleBooks={visibleBooks}
          onCanonChange={updateCanon}
          onClearFilters={clearFilters}
          onClose={() => setIsFilterModalOpen(false)}
          onMatchCountChange={setMatchCount}
          onToggleBook={toggleSelectedBook}
        />
      </Form>
    </section>
  );
}
