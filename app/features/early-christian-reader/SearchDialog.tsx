import { Form } from "@remix-run/react";

import { FilterModal } from "~/features/search/FilterModal";
import { SearchResults } from "~/features/search/SearchResults";
import { SearchTargetControl } from "~/features/search/SearchTargetControl";
import type { PassageLookup } from "~/features/scripture/useScriptureLibrary";
import { isBackdropClick } from "~/lib/use-dialog-dismiss";
import type { EarlyChristianSearchResult } from "~/lib/early-christian-search.server";
import type {
  CanonMode,
  SearchActionData,
  SearchTargetCorpus
} from "~/features/search/types";

import { EarlyChristianSearchResults } from "./EarlyChristianSearchResults";
import { EarlyChristianAuthorInputs } from "./SearchFields";
import type { ChurchFathersActionData } from "./types";

type FocusedPassageSummary = {
  reference: string;
  text: string;
} | null;

export function SearchDialog({
  actionData,
  activeFilterCount,
  authorOptions,
  canon,
  closeSearch,
  examplePlaceholder,
  focusedPassage,
  focusedPassageKey,
  isAuthorFilterOpen,
  isReady,
  isSearching,
  matchCount,
  onCanonChange,
  onClearFilters,
  onCloseAuthorFilters,
  onMatchCountChange,
  onOpenAuthorFilters,
  onOpenResult,
  onSetFocusedPassageKey,
  onTargetCorpusChange,
  onToggleBook,
  onToggleEarlyChristianAuthor,
  passageLookup,
  readerTheme,
  searchIntent,
  selectedAuthorFilters,
  selectedBooksForCanon,
  showAuthorFilters,
  showScriptureFilters,
  themeCorpus,
  visibleScriptureBooks
}: {
  actionData?: ChurchFathersActionData;
  activeFilterCount: number;
  authorOptions: string[];
  canon: CanonMode;
  closeSearch: () => void;
  examplePlaceholder: string;
  focusedPassage: FocusedPassageSummary;
  focusedPassageKey: string | null;
  isAuthorFilterOpen: boolean;
  isReady: boolean;
  isSearching: boolean;
  matchCount: number;
  onCanonChange: (canon: CanonMode) => void;
  onClearFilters: () => void;
  onCloseAuthorFilters: () => void;
  onMatchCountChange: (matchCount: number) => void;
  onOpenAuthorFilters: () => void;
  onOpenResult: (result: EarlyChristianSearchResult) => void;
  onSetFocusedPassageKey: (focusedId: string | null) => void;
  onTargetCorpusChange: (targetCorpus: SearchTargetCorpus) => void;
  onToggleBook: (book: string) => void;
  onToggleEarlyChristianAuthor: (author: string) => void;
  passageLookup: PassageLookup;
  readerTheme: string;
  searchIntent: string;
  selectedAuthorFilters: string[];
  selectedBooksForCanon: string[];
  showAuthorFilters: boolean;
  showScriptureFilters: boolean;
  themeCorpus: SearchTargetCorpus;
  visibleScriptureBooks: string[];
}) {
  return (
    <div
      className={`search-modal-backdrop reader-theme-${readerTheme}`}
      onClick={(event) => {
        event.stopPropagation();

        if (isBackdropClick(event)) {
          closeSearch();
        }
      }}
    >
      <section
        aria-labelledby="search-modal-title"
        aria-modal="true"
        className="search-modal"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="search-modal-header">
          <div>
            <p className="eyebrow">Search</p>
            <h2 id="search-modal-title">Find chapters</h2>
          </div>
          <button
            className="filter-modal-close"
            onClick={closeSearch}
            type="button"
          >
            Close
          </button>
        </header>

        <div className="search-modal-body">
          <section
            aria-busy={isSearching}
            aria-label="Early Christian search"
            className={`search-band${isSearching ? " is-searching" : ""}`}
          >
            <Form method="post" className="search-form">
              <input type="hidden" name="intent" value={searchIntent} />
              {focusedPassageKey ? (
                <input type="hidden" name="sourcePassageId" value={focusedPassageKey} />
              ) : null}
              {showScriptureFilters ? (
                <input type="hidden" name="canon" value={canon} />
              ) : null}
              <input type="hidden" name="matchCount" value={matchCount} />
              {showScriptureFilters ? selectedBooksForCanon.map((book) => (
                <input key={book} type="hidden" name="books" value={book} />
              )) : null}
              {showAuthorFilters ? (
                <EarlyChristianAuthorInputs authors={selectedAuthorFilters} />
              ) : null}
              <SearchTargetControl
                disabled={isSearching}
                value={themeCorpus}
                onChange={onTargetCorpusChange}
              />
              {!focusedPassageKey ? (
                <label htmlFor="question">
                  Search {themeCorpus === "scripture" ? "Bible" : "early Christian works"} for...
                </label>
              ) : null}
              <div className="search-row">
                <div className="search-primary">
                  {focusedPassageKey ? (
                    <div className="focused-passage">
                      <button
                        aria-label="Clear similar passage"
                        className="focused-passage-clear"
                        disabled={isSearching}
                        onClick={() => onSetFocusedPassageKey(null)}
                        type="button"
                      >
                        &times;
                      </button>
                      <h2>
                        {actionData?.similarSource?.reference
                          ?? actionData?.similarScriptureSource?.reference
                          ?? focusedPassage?.reference
                          ?? "Selected passage"}
                      </h2>
                      <p>
                        {actionData?.similarSource?.text
                          ?? actionData?.similarScriptureSource?.text
                          ?? focusedPassage?.text
                          ?? "Passage text is loading."}
                      </p>
                    </div>
                  ) : (
                    <textarea
                      defaultValue={actionData?.question ?? ""}
                      disabled={isSearching}
                      id="question"
                      maxLength={500}
                      minLength={3}
                      name="question"
                      placeholder={examplePlaceholder}
                      required
                      rows={4}
                    />
                  )}
                </div>
                <div className="search-actions">
                  <button
                    aria-controls="filter-modal"
                    aria-expanded={isAuthorFilterOpen}
                    className={`filter-toggle${activeFilterCount > 0 ? " is-active" : ""}`}
                    disabled={isSearching}
                    onClick={onOpenAuthorFilters}
                    type="button"
                  >
                    Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
                  </button>
                  <button
                    className="search-button"
                    disabled={isSearching || !isReady}
                    type="submit"
                  >
                    {searchButtonLabel(searchIntent, focusedPassageKey, isSearching)}
                  </button>
                  {isSearching ? (
                    <p className="search-status" role="status">
                      {searchStatusText(searchIntent)}
                    </p>
                  ) : null}
                </div>
              </div>
              <FilterModal
                canon={canon}
                earlyChristianAuthors={authorOptions}
                isOpen={isAuthorFilterOpen}
                isSearching={isSearching}
                matchCount={matchCount}
                selectedEarlyChristianAuthors={selectedAuthorFilters}
                selectedBooks={selectedBooksForCanon}
                showEarlyChristianAuthorFilters={showAuthorFilters}
                showScriptureFilters={showScriptureFilters}
                visibleBooks={visibleScriptureBooks}
                onCanonChange={onCanonChange}
                onClearFilters={onClearFilters}
                onClose={onCloseAuthorFilters}
                onMatchCountChange={onMatchCountChange}
                onToggleBook={onToggleBook}
                onToggleEarlyChristianAuthor={onToggleEarlyChristianAuthor}
              />
            </Form>
          </section>

          {actionData?.error ? (
            <p className="notice" role="alert">
              {actionData.error}
              {actionData.retryAfterSeconds
                ? ` ${actionData.retryAfterSeconds} seconds remaining.`
                : ""}
            </p>
          ) : null}

          <EarlyChristianSearchResults
            authors={selectedAuthorFilters}
            canon={canon}
            isSearching={isSearching}
            onOpenResult={onOpenResult}
            results={actionData?.results}
            scriptureBooks={selectedBooksForCanon}
            showEmptyState={!actionData?.scriptureResults}
          />

          {actionData?.scriptureResults ? (
            <SearchResults
              actionData={churchFathersScriptureActionData(actionData)}
              contextActionLabel="Jump to"
              focusedPassageId={null}
              passageLookup={passageLookup}
              results={actionData.scriptureResults}
              showEmptyState={false}
              showSimilarAction={false}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}

function searchButtonLabel(
  searchIntent: string,
  focusedPassageKey: string | null,
  isSearching: boolean
) {
  if (isSearching) {
    return (
      <>
        <span className="button-spinner" aria-hidden="true" />
        {searchIntent === "theme-scripture"
          ? "Searching Bible"
          : searchIntent === "theme"
          ? "Searching Fathers"
          : searchIntent === "similar-scripture"
          ? "Finding Bible"
          : "Finding similar"}
      </>
    );
  }

  if (searchIntent === "theme-scripture") {
    return "Search Bible";
  }

  if (searchIntent === "theme") {
    return "Search Fathers";
  }

  if (searchIntent === "similar-scripture") {
    return "Find Bible";
  }

  return focusedPassageKey ? "Find similar" : "Search Fathers";
}

function searchStatusText(searchIntent: string) {
  if (searchIntent === "theme-scripture") {
    return "Searching Bible passages...";
  }

  if (searchIntent === "similar-scripture") {
    return "Finding Bible passages...";
  }

  return "Searching early Christian works...";
}

function churchFathersScriptureActionData(
  actionData: ChurchFathersActionData | undefined
): SearchActionData | undefined {
  if (!actionData?.scriptureResults) {
    return undefined;
  }

  return {
    books: actionData.books,
    canon: actionData.canon,
    matchCount: actionData.matchCount,
    mode: actionData.mode === "theme-scripture" ? "theme" : "similar",
    question: actionData.question,
    results: actionData.scriptureResults,
    similarSource: actionData.similarScriptureSource
      ? {
        id: actionData.similarScriptureSource.id,
        reference: actionData.similarScriptureSource.reference
      }
      : undefined,
    targetCorpus: "scripture"
  };
}
