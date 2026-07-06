import { useEffect, useState } from "react";

import { Form } from "@remix-run/react";

import type { CanonMode } from "~/features/search/types";
import type { EarlyChristianSearchResult } from "~/lib/early-christian-search.server";

import {
  ChurchFathersScriptureFilterInputs,
  EarlyChristianAuthorInputs
} from "./SearchFields";

export function EarlyChristianSearchResults({
  authors,
  canon,
  isSearching,
  onOpenResult,
  results,
  scriptureBooks,
  showEmptyState = true
}: {
  authors: string[];
  canon: CanonMode;
  isSearching: boolean;
  onOpenResult: (result: EarlyChristianSearchResult) => void;
  results?: EarlyChristianSearchResult[];
  scriptureBooks: string[];
  showEmptyState?: boolean;
}) {
  const [selectedResult, setSelectedResult] = useState("");

  useEffect(() => {
    setSelectedResult("");
  }, [results]);

  return (
    <section className="results ec-results" aria-live="polite">
      {results?.length ? (
        results.map((result, index) => {
          const resultSelectionId = result.highlightPassage.id
            || `${result.chapterId}:${result.highlightPassage.rangeLabel}`;
          const isSelected = selectedResult === resultSelectionId;

          return (
            <article
              className={[
                "scripture-result",
                `match-level-${result.matchStrength}`,
                isSelected ? "is-selected" : ""
              ].filter(Boolean).join(" ")}
              key={`${result.chapterId}-${index}`}
            >
              <button
                aria-expanded={isSelected}
                className="scripture-result-button"
                onClick={() => setSelectedResult(isSelected ? "" : resultSelectionId)}
                type="button"
              >
                <span className="result-meta">
                  <span>{result.chapterReference}</span>
                  <span>{result.author ?? result.source.toUpperCase()}</span>
                  <span
                    aria-label={`${result.matchStrength} of 4 match strength`}
                    className="match-strength"
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
                <span className="scripture-result-text">
                  {result.highlightPassage.rangeLabel ? (
                    <>
                      <span className="result-range-label">
                        {result.highlightPassage.rangeLabel}.
                      </span>{" "}
                    </>
                  ) : null}
                  {result.highlightPassage.text}
                </span>
              </button>
              {isSelected ? (
                <div className="result-actions">
                  <button
                    className="context-button"
                    onClick={() => onOpenResult(result)}
                    type="button"
                  >
                    Jump to
                  </button>
                  <Form method="post">
                    <input type="hidden" name="intent" value="similar-passage" />
                    <input type="hidden" name="targetCorpus" value="early-christian" />
                    <input
                      type="hidden"
                      name="sourcePassageId"
                      value={result.highlightPassage.id}
                    />
                    <EarlyChristianAuthorInputs authors={authors} />
                    <button
                      className="context-button"
                      disabled={isSearching}
                      type="submit"
                    >
                      {isSearching ? (
                        <>
                          <span className="button-spinner" aria-hidden="true" />
                          Finding similar
                        </>
                      ) : (
                        "Similar passages"
                      )}
                    </button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="similar-scripture" />
                    <input type="hidden" name="targetCorpus" value="scripture" />
                    <input
                      type="hidden"
                      name="sourcePassageId"
                      value={result.highlightPassage.id}
                    />
                    <ChurchFathersScriptureFilterInputs
                      books={scriptureBooks}
                      canon={canon}
                    />
                    <button
                      className="context-button"
                      disabled={isSearching}
                      type="submit"
                    >
                      {isSearching ? (
                        <>
                          <span className="button-spinner" aria-hidden="true" />
                          Finding Bible
                        </>
                      ) : (
                        "Similar Bible passages"
                      )}
                    </button>
                  </Form>
                </div>
              ) : null}
            </article>
          );
        })
      ) : showEmptyState ? (
        <div className="empty-state">
          <p>Early Christian results will appear here.</p>
        </div>
      ) : (
        null
      )}
    </section>
  );
}
