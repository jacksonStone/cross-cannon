import { useEffect, useState } from "react";

import { Form, Link, useNavigation } from "@remix-run/react";

import { buildScriptureReaderUrl } from "~/features/reader-navigation/reader-links";
import type { PassageLookup } from "~/features/scripture/useScriptureLibrary";

import { DEFAULT_CANON, DEFAULT_MATCH_COUNT } from "./canons";
import type { SearchActionData, SearchResult } from "./types";

const TRANSLATION_ABBREVIATION = "WEB";
const TRANSLATION_NAME = "World English Bible";

type SearchResultsProps = {
  actionData?: SearchActionData;
  contextActionLabel?: string;
  crossCorpusAction?: {
    intent: string;
    label: string;
    pendingLabel: string;
  };
  focusedPassageId: string | null;
  passageLookup: PassageLookup;
  results?: SearchResult[];
  showEmptyState?: boolean;
  showSimilarAction?: boolean;
};

export function SearchResults({
  actionData,
  contextActionLabel = "View in context",
  crossCorpusAction,
  focusedPassageId,
  passageLookup,
  results,
  showEmptyState = true,
  showSimilarAction = true
}: SearchResultsProps) {
  const navigation = useNavigation();
  const [selectedResultId, setSelectedResultId] = useState("");
  const isSubmitting = navigation.state === "submitting";
  const isSubmittingSimilar = navigation.state === "submitting"
    && navigation.formData?.get("intent") === "similar-passage";
  const isSubmittingCrossCorpus = Boolean(
    crossCorpusAction
    && navigation.state === "submitting"
    && navigation.formData?.get("intent") === crossCorpusAction.intent
  );
  const submittingSimilarPassageId = isSubmittingSimilar
    ? String(navigation.formData?.get("sourcePassageId") ?? "")
    : null;
  const submittingCrossCorpusPassageId = isSubmittingCrossCorpus
    ? String(navigation.formData?.get("sourcePassageId") ?? "")
    : null;

  useEffect(() => {
    setSelectedResultId("");
  }, [actionData?.mode, actionData?.question, actionData?.similarSource?.id, results]);

  return (
    <section className="results" aria-live="polite">
        {actionData?.mode === "similar"
          && actionData.similarSource
          && focusedPassageId === actionData.similarSource.id ? (
          <h2 className="results-heading">Similar passages</h2>
        ) : null}
        {results?.length ? (
          results.map((result, index) => {
            const passage = passageLookup.get(result.id);
            const isThisSimilarSearch = submittingSimilarPassageId === result.id;
            const isSelected = selectedResultId === result.id;

            return (
              <article
                className={[
                  "scripture-result",
                  `match-level-${result.matchStrength}`,
                  isSelected ? "is-selected" : ""
                ].filter(Boolean).join(" ")}
                key={`${result.id}-${index}`}
              >
                <button
                  aria-expanded={isSelected}
                  className="scripture-result-button"
                  onClick={() => setSelectedResultId(isSelected ? "" : result.id)}
                  type="button"
                >
                  <span className="result-meta">
                    <span>{passage?.reference ?? result.reference}</span>
                    <span title={TRANSLATION_NAME}>
                      {TRANSLATION_ABBREVIATION} · {TRANSLATION_NAME}
                    </span>
                    <span
                      className="match-strength"
                      aria-label={`${result.matchStrength} of 4 match strength`}
                      title={`${result.matchStrength} of 4 match strength`}
                    >
                      <span className="match-strength-label" aria-hidden="true">
                        Match strength
                      </span>
                      <span className="match-dots" aria-hidden="true">
                        {[1, 2, 3, 4].map((level) => (
                          <span
                            className={level <= result.matchStrength ? "is-active" : undefined}
                            key={level}
                          />
                        ))}
                      </span>
                    </span>
                  </span>
                  {passage?.verses.length ? (
                    <span className="scripture-result-text">
                      {passage.verses.map((verse, verseIndex) => (
                      <span
                          className={
                            result.highlightVerse === verse.number
                              ? "verse-highlight"
                              : undefined
                          }
                          key={verse.number}
                        >
                          {verse.text}
                          {verseIndex < passage.verses.length - 1 ? " " : ""}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="scripture-result-text">
                      {passage?.text ?? "Passage text is loading."}
                    </span>
                  )}
                </button>
                {isSelected ? (
                  <div className="result-actions">
                    <Link
                      className="context-button"
                      aria-disabled={!passage}
                      to={passage
                        ? buildScriptureReaderUrl(passage.id, actionData)
                        : "#"}
                    >
                      {contextActionLabel}
                    </Link>
                    {showSimilarAction ? (
                      <Form method="post">
                        <input type="hidden" name="intent" value="similar-passage" />
                        <input type="hidden" name="targetCorpus" value="scripture" />
                        <input type="hidden" name="sourcePassageId" value={result.id} />
                        <SearchFilterInputs
                          actionData={actionData}
                          includeEarlyChristianFilters={false}
                          includeScriptureFilters
                        />
                        <button
                          className="context-button"
                          disabled={!passage || isSubmitting}
                          type="submit"
                        >
                          {isThisSimilarSearch ? (
                            <>
                              <span className="button-spinner" aria-hidden="true" />
                              Finding similar
                            </>
                          ) : (
                            "Similar passages"
                          )}
                        </button>
                      </Form>
                    ) : null}
                    {crossCorpusAction ? (
                      <Form method="post">
                        <input type="hidden" name="intent" value={crossCorpusAction.intent} />
                        <input
                          type="hidden"
                          name="targetCorpus"
                          value={
                            crossCorpusAction.intent === "similar-early-christian"
                              ? "early-christian"
                              : "scripture"
                          }
                        />
                        <input type="hidden" name="sourcePassageId" value={result.id} />
                        <SearchFilterInputs
                          actionData={actionData}
                          includeEarlyChristianFilters={crossCorpusAction.intent === "similar-early-christian"}
                          includeScriptureFilters={crossCorpusAction.intent !== "similar-early-christian"}
                        />
                        <button
                          className="context-button"
                          disabled={!passage || isSubmitting}
                          type="submit"
                        >
                          {submittingCrossCorpusPassageId === result.id ? (
                            <>
                              <span className="button-spinner" aria-hidden="true" />
                              {crossCorpusAction.pendingLabel}
                            </>
                          ) : (
                            crossCorpusAction.label
                          )}
                        </button>
                      </Form>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })
        ) : showEmptyState ? (
          <div className="empty-state">
            <p>Scripture results will appear here.</p>
          </div>
        ) : (
          null
        )}
    </section>
  );
}

function SearchFilterInputs({
  actionData,
  includeEarlyChristianFilters = false,
  includeScriptureFilters = true
}: {
  actionData?: SearchActionData;
  includeEarlyChristianFilters?: boolean;
  includeScriptureFilters?: boolean;
}) {
  const canon = actionData?.canon ?? DEFAULT_CANON;
  const matchCount = actionData?.matchCount ?? DEFAULT_MATCH_COUNT;
  const books = actionData?.books ?? [];

  return (
    <>
      {includeScriptureFilters ? (
        <input type="hidden" name="canon" value={canon} />
      ) : null}
      <input type="hidden" name="matchCount" value={matchCount} />
      {includeScriptureFilters ? books.map((book) => (
        <input key={book} type="hidden" name="books" value={book} />
      )) : null}
      {includeEarlyChristianFilters ? (actionData?.earlyChristianAuthors ?? []).map((author) => (
        <input
          key={author}
          type="hidden"
          name="earlyChristianAuthors"
          value={author}
        />
      )) : null}
    </>
  );
}
