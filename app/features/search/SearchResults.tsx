import type { BrowserPassage } from "~/lib/scripture-cache.server";

import type { SearchResult } from "./types";

const TRANSLATION_ABBREVIATION = "WEB";

type SearchResultsProps = {
  passages: BrowserPassage[];
  results?: SearchResult[];
};

export function SearchResults({ passages, results }: SearchResultsProps) {
  const passageMap = new Map(passages.map((passage) => [passage.id, passage]));

  return (
    <section className="results" aria-live="polite">
      {results?.length ? (
        results.map((result, index) => {
          const passage = passageMap.get(result.id);

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
