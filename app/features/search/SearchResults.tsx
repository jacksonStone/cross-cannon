import { useMemo } from "react";

import { Form, Link, useNavigation } from "@remix-run/react";

import type { BrowserPassage } from "~/lib/scripture-cache.server";

import { DEFAULT_CANON, DEFAULT_MATCH_COUNT } from "./canons";
import type { SearchActionData, SearchResult } from "./types";

const TRANSLATION_ABBREVIATION = "WEB";

type SearchResultsProps = {
  actionData?: SearchActionData;
  focusedPassageId: string | null;
  passages: BrowserPassage[];
  results?: SearchResult[];
};

export function SearchResults({
  actionData,
  focusedPassageId,
  passages,
  results
}: SearchResultsProps) {
  const navigation = useNavigation();
  const passageMap = useMemo(
    () => new Map(passages.map((passage) => [passage.id, passage])),
    [passages]
  );
  const isSubmittingSimilar = navigation.state === "submitting"
    && navigation.formData?.get("intent") === "similar-passage";
  const submittingSimilarPassageId = isSubmittingSimilar
    ? String(navigation.formData?.get("sourcePassageId") ?? "")
    : null;

  return (
    <section className="results" aria-live="polite">
        {results?.length ? (
          results.map((result, index) => {
            const passage = passageMap.get(result.id);
            const isThisSimilarSearch = submittingSimilarPassageId === result.id;

            return (
              <article
                className={`scripture-result match-level-${result.matchStrength}`}
                key={`${result.id}-${index}`}
              >
                <div className="result-meta">
                  <span>{passage?.reference ?? result.reference}</span>
                  <span title="World English Bible">{TRANSLATION_ABBREVIATION}</span>
                  <span
                    className="match-dots"
                    aria-label={`${result.matchStrength} of 4 match strength`}
                    title={`${result.matchStrength} of 4 match strength`}
                  >
                    {[1, 2, 3, 4].map((level) => (
                      <span
                        aria-hidden="true"
                        className={level <= result.matchStrength ? "is-active" : undefined}
                        key={level}
                      />
                    ))}
                  </span>
                </div>
                {passage?.verses.length ? (
                  <p>
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
                  </p>
                ) : (
                  <p>{passage?.text ?? "Passage text is loading."}</p>
                )}
                <div className="result-actions">
                  <Link
                    className="context-button"
                    aria-disabled={!passage}
                    to={passage ? buildReaderUrl(passage.id, actionData) : "#"}
                  >
                    View in context
                  </Link>
                  <Form method="post">
                    <input type="hidden" name="intent" value="similar-passage" />
                    <input type="hidden" name="sourcePassageId" value={result.id} />
                    <SearchFilterInputs actionData={actionData} />
                    <button
                      className="context-button"
                      disabled={!passage || isSubmittingSimilar}
                      type="submit"
                    >
                      {isThisSimilarSearch ? "Finding similar" : "Similar passages"}
                    </button>
                  </Form>
                </div>
              </article>
            );
          })
        ) : (
          <div className="empty-state">
            <p>Scripture results will appear here.</p>
          </div>
        )}
    </section>
  );
}

function SearchFilterInputs({ actionData }: { actionData?: SearchActionData }) {
  const canon = actionData?.canon ?? DEFAULT_CANON;
  const matchCount = actionData?.matchCount ?? DEFAULT_MATCH_COUNT;
  const books = actionData?.books ?? [];

  return (
    <>
      <input type="hidden" name="canon" value={canon} />
      <input type="hidden" name="matchCount" value={matchCount} />
      {books.map((book) => (
        <input key={book} type="hidden" name="books" value={book} />
      ))}
    </>
  );
}

function buildReaderUrl(passageId: string, actionData?: SearchActionData) {
  const searchParams = new URLSearchParams();

  if (actionData?.canon) {
    searchParams.set("canon", actionData.canon);
  }

  if (actionData?.matchCount) {
    searchParams.set("matchCount", String(actionData.matchCount));
  }

  for (const book of actionData?.books ?? []) {
    searchParams.append("books", book);
  }

  const query = searchParams.toString();
  return `/reader/${passageId}${query ? `?${query}` : ""}`;
}
