import { useEffect, useRef, useState } from "react";

import { Form, useNavigation } from "@remix-run/react";

import { PassageJump } from "~/features/passage-jump/PassageJump";
import type { PassageLookup } from "~/features/scripture/useScriptureLibrary";
import type { BrowserPassage } from "~/lib/scripture-cache-contract";

import { FilterModal } from "./FilterModal";
import { SearchTargetControl } from "./SearchTargetControl";
import type { SearchActionData } from "./types";
import { useSearchDialogState } from "./useSearchDialogState";

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
  earlyChristianAuthors?: string[];
  focusedPassageId: string | null;
  isScriptureReady: boolean;
  jumpInitialPassageId?: string;
  onFocusedPassageChange: (passageId: string | null) => void;
  passageLookup: PassageLookup;
  passages: BrowserPassage[];
  showJump?: boolean;
};

export function SearchForm({
  actionData,
  books,
  earlyChristianAuthors = [],
  focusedPassageId,
  isScriptureReady,
  jumpInitialPassageId,
  onFocusedPassageChange,
  passageLookup,
  passages,
  showJump = true
}: SearchFormProps) {
  const navigation = useNavigation();
  const submittingRef = useRef(false);
  const [exampleIndex, setExampleIndex] = useState(0);
  const isSearching = navigation.state === "submitting";
  const isSubmittingSimilar =
    isSearching && navigation.formData?.get("intent") === "similar-passage";
  const isSubmittingEarlyChristian =
    isSearching && (
      navigation.formData?.get("intent") === "similar-early-christian"
      || navigation.formData?.get("intent") === "theme-early-christian"
    );
  const isSearchingAllBooks =
    isSearching && (navigation.formData?.getAll("books").length ?? 0) === 0;
  const focusedPassage = focusedPassageId ? passageLookup.get(focusedPassageId) : null;
  const focusedReference = focusedPassage?.reference
    ?? (focusedPassageId === actionData?.similarSource?.id
      ? actionData.similarSource.reference
      : null);
  const searchDialog = useSearchDialogState({
    actionData,
    books,
    earlyChristianAuthors,
    focusedPassageId,
    readerCorpus: "scripture"
  });
  const {
    activeFilterCount,
    canon,
    clearFilters,
    closeFilters,
    intent: searchIntent,
    isFilterOpen: isFilterModalOpen,
    matchCount,
    openFilters,
    selectedEarlyChristianAuthors,
    selectedBooksForCanon,
    setMatchCount,
    setTargetCorpus,
    showAuthorFilters: showEarlyChristianAuthorFilters,
    showScriptureFilters,
    targetCorpus: themeCorpus,
    toggleEarlyChristianAuthor,
    toggleSelectedBook,
    updateCanon,
    visibleBooks
  } = searchDialog;

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
        <input type="hidden" name="intent" value={searchIntent} />
        {focusedPassageId ? (
          <>
            <input type="hidden" name="sourcePassageId" value={focusedPassageId} />
          </>
        ) : null}
        {showScriptureFilters ? (
          <input type="hidden" name="canon" value={canon} />
        ) : null}
        <input type="hidden" name="matchCount" value={matchCount} />
        {showScriptureFilters ? selectedBooksForCanon.map((book) => (
          <input key={book} type="hidden" name="books" value={book} />
        )) : null}
        {showEarlyChristianAuthorFilters ? selectedEarlyChristianAuthors.map((author) => (
            <input
              key={author}
              type="hidden"
              name="earlyChristianAuthors"
              value={author}
            />
          )) : null}
        {showJump ? (
          <PassageJump
            className="search-form-jump"
            filters={{
              books: selectedBooksForCanon,
              canon,
              earlyChristianAuthors: selectedEarlyChristianAuthors,
              matchCount
            }}
            initialPassageId={jumpInitialPassageId}
            isScriptureReady={isScriptureReady}
            label="Jump to specific passage"
            launcherVariant="inline"
            passages={passages}
          />
        ) : null}
        <SearchTargetControl
          disabled={isSearching}
          value={themeCorpus}
          onChange={setTargetCorpus}
        />
        {!focusedPassageId ? (
          <label htmlFor="question">
            Search {themeCorpus === "scripture" ? "Bible" : "early Christian works"} for...
          </label>
        ) : null}
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
          </div>
          <div className="search-actions">
            <button
              aria-expanded={isFilterModalOpen}
              aria-controls="filter-modal"
              className={`filter-toggle${activeFilterCount > 0 ? " is-active" : ""}`}
              disabled={isSearching}
              onClick={openFilters}
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
                  {isSubmittingEarlyChristian
                    ? focusedPassageId ? "Finding Fathers" : "Searching Fathers"
                    : isSubmittingSimilar ? "Finding" : "Searching"}
                </>
              ) : !isScriptureReady ? (
                "Loading text"
              ) : focusedPassageId ? (
                themeCorpus === "early-christian" ? "Find Fathers" : "Find Bible"
              ) : themeCorpus === "early-christian" ? (
                "Search Fathers"
              ) : (
                "Search Bible"
              )}
            </button>
            {isSearching ? (
              <p className="search-status" role="status">
                {isSubmittingSimilar
                  ? "Finding similar passages..."
                  : isSubmittingEarlyChristian
                  ? "Finding early Christian passages..."
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
          earlyChristianAuthors={earlyChristianAuthors}
          isOpen={isFilterModalOpen}
          isSearching={isSearching}
          matchCount={matchCount}
          selectedEarlyChristianAuthors={selectedEarlyChristianAuthors}
          selectedBooks={selectedBooksForCanon}
          showEarlyChristianAuthorFilters={showEarlyChristianAuthorFilters}
          showScriptureFilters={showScriptureFilters}
          visibleBooks={visibleBooks}
          onCanonChange={updateCanon}
          onClearFilters={clearFilters}
          onClose={closeFilters}
          onToggleEarlyChristianAuthor={toggleEarlyChristianAuthor}
          onMatchCountChange={setMatchCount}
          onToggleBook={toggleSelectedBook}
        />
      </Form>
    </section>
  );
}
