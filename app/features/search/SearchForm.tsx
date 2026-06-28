import { useEffect, useMemo, useRef, useState } from "react";

import { Form, useNavigation } from "@remix-run/react";

import { PassageJump } from "~/features/passage-jump/PassageJump";
import type { BrowserPassage } from "~/lib/scripture-cache.server";

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
  focusedPassageId: string | null;
  isScriptureReady: boolean;
  onFocusedPassageChange: (passageId: string | null) => void;
  passages: BrowserPassage[];
  showJump?: boolean;
};

export function SearchForm({
  actionData,
  books,
  focusedPassageId,
  isScriptureReady,
  onFocusedPassageChange,
  passages,
  showJump = true
}: SearchFormProps) {
  const navigation = useNavigation();
  const submittingRef = useRef(false);
  const [exampleIndex, setExampleIndex] = useState(0);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const isSearching = navigation.state === "submitting";
  const isSubmittingSimilar =
    isSearching && navigation.formData?.get("intent") === "similar-passage";
  const isSearchingAllBooks =
    isSearching && (navigation.formData?.getAll("books").length ?? 0) === 0;
  const passageMap = useMemo(
    () => new Map(passages.map((passage) => [passage.id, passage])),
    [passages]
  );
  const focusedPassage = focusedPassageId ? passageMap.get(focusedPassageId) : null;
  const focusedReference = focusedPassage?.reference
    ?? (focusedPassageId === actionData?.similarSource?.id
      ? actionData.similarSource.reference
      : null);
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
        {!focusedPassageId ? (
          <label htmlFor="question">Search for passages about...</label>
        ) : null}
        {focusedPassageId ? (
          <>
            <input type="hidden" name="intent" value="similar-passage" />
            <input type="hidden" name="sourcePassageId" value={focusedPassageId} />
          </>
        ) : null}
        <input type="hidden" name="canon" value={canon} />
        <input type="hidden" name="matchCount" value={matchCount} />
        {selectedBooksForCanon.map((book) => (
          <input key={book} type="hidden" name="books" value={book} />
        ))}
        <div className="search-row">
          <div className="search-primary">
            {focusedPassageId ? (
              <div className="focused-passage">
                <button
                  aria-label="Clear similar passage"
                  className="focused-passage-clear"
                  disabled={isSearching}
                  onClick={() => onFocusedPassageChange(null)}
                  type="button"
                >
                  &times;
                </button>
                <h2>{focusedReference ?? "Selected passage"}</h2>
                <p>{focusedPassage?.text ?? "Passage text is loading."}</p>
              </div>
            ) : (
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
            )}
            {showJump ? (
              <PassageJump
                className="search-form-jump"
                isScriptureReady={isScriptureReady}
                passages={passages}
              />
            ) : null}
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
                  {isSubmittingSimilar ? "Finding" : "Searching"}
                </>
              ) : !isScriptureReady ? (
                "Loading text"
              ) : focusedPassageId ? (
                "Find similar"
              ) : (
                "Search"
              )}
            </button>
            {isSearching ? (
              <p className="search-status" role="status">
                {isSubmittingSimilar
                  ? "Finding similar passages..."
                  : isSearchingAllBooks
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
