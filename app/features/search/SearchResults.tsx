import { useEffect, useMemo, useState } from "react";

import type { BrowserPassage } from "~/lib/scripture-cache.server";

import type { SearchResult } from "./types";

const TRANSLATION_ABBREVIATION = "WEB";

type PassageLocation = {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
};

type ChapterContext = {
  book: string;
  chapter: number;
  verses: Array<{
    number: number;
    text: string;
  }>;
};

type ChapterIndex = {
  chaptersByKey: Map<string, ChapterContext>;
  orderedKeysByBook: Map<string, string[]>;
  locationByPassageId: Map<string, PassageLocation>;
};

type SearchResultsProps = {
  passages: BrowserPassage[];
  results?: SearchResult[];
};

export function SearchResults({ passages, results }: SearchResultsProps) {
  const [contextPassageId, setContextPassageId] = useState<string | null>(null);
  const passageMap = useMemo(
    () => new Map(passages.map((passage) => [passage.id, passage])),
    [passages]
  );
  const chapterIndex = useMemo(() => buildChapterIndex(passages), [passages]);
  const contextPassage = contextPassageId ? passageMap.get(contextPassageId) : null;

  return (
    <>
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
                <button
                  className="context-button"
                  disabled={!passage}
                  onClick={() => passage && setContextPassageId(passage.id)}
                  type="button"
                >
                  View in context
                </button>
              </article>
            );
          })
        ) : (
          <div className="empty-state">
            <p>Scripture results will appear here.</p>
          </div>
        )}
      </section>
      {contextPassage ? (
        <PassageContextModal
          chapterIndex={chapterIndex}
          passage={contextPassage}
          onClose={() => setContextPassageId(null)}
        />
      ) : null}
    </>
  );
}

function PassageContextModal({
  chapterIndex,
  passage,
  onClose
}: {
  chapterIndex: ChapterIndex;
  passage: BrowserPassage;
  onClose: () => void;
}) {
  const passageLocation = chapterIndex.locationByPassageId.get(passage.id);
  const initialChapterKey = passageLocation
    ? chapterKey(passageLocation.book, passageLocation.chapter)
    : null;
  const [activeChapterKey, setActiveChapterKey] = useState(initialChapterKey);

  useEffect(() => {
    setActiveChapterKey(initialChapterKey);
  }, [initialChapterKey]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const activeChapter = activeChapterKey
    ? chapterIndex.chaptersByKey.get(activeChapterKey)
    : null;
  const orderedChapterKeys = activeChapter
    ? chapterIndex.orderedKeysByBook.get(activeChapter.book) ?? []
    : [];
  const activeChapterIndex = activeChapterKey
    ? orderedChapterKeys.indexOf(activeChapterKey)
    : -1;
  const previousChapterKey = activeChapterIndex > 0
    ? orderedChapterKeys[activeChapterIndex - 1]
    : null;
  const nextChapterKey =
    activeChapterIndex >= 0 && activeChapterIndex < orderedChapterKeys.length - 1
      ? orderedChapterKeys[activeChapterIndex + 1]
      : null;
  const selectedVerses = new Set<number>();

  if (
    activeChapter &&
    passageLocation &&
    activeChapter.book === passageLocation.book &&
    activeChapter.chapter === passageLocation.chapter
  ) {
    for (
      let verse = passageLocation.verseStart;
      verse <= passageLocation.verseEnd;
      verse += 1
    ) {
      selectedVerses.add(verse);
    }
  }

  if (!activeChapter) {
    return null;
  }

  return (
    <div
      className="context-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby="context-modal-title"
        aria-modal="true"
        className="context-modal"
        role="dialog"
      >
        <header className="context-modal-header">
          <div>
            <p className="eyebrow">Context</p>
            <h2 id="context-modal-title">{activeChapter.book} {activeChapter.chapter}</h2>
          </div>
          <button className="filter-modal-close" onClick={onClose} type="button">
            Close
          </button>
        </header>
        <div className="context-modal-body">
          <p className="chapter-text">
            {activeChapter.verses.map((verse, index) => (
              <span
                className={
                  selectedVerses.has(verse.number)
                    ? "chapter-verse is-selected"
                    : "chapter-verse"
                }
                key={verse.number}
              >
                <sup>{verse.number}</sup>
                {verse.text}
                {index < activeChapter.verses.length - 1 ? " " : ""}
              </span>
            ))}
          </p>
        </div>
        <footer className="context-modal-actions">
          <button
            className="secondary-button"
            disabled={!previousChapterKey}
            onClick={() => previousChapterKey && setActiveChapterKey(previousChapterKey)}
            type="button"
          >
            Previous chapter
          </button>
          <span title="World English Bible">{TRANSLATION_ABBREVIATION}</span>
          <button
            disabled={!nextChapterKey}
            onClick={() => nextChapterKey && setActiveChapterKey(nextChapterKey)}
            type="button"
          >
            Next chapter
          </button>
        </footer>
      </section>
    </div>
  );
}

function buildChapterIndex(passages: BrowserPassage[]): ChapterIndex {
  const chapterBuilders = new Map<
    string,
    {
      book: string;
      chapter: number;
      verses: Map<number, string>;
    }
  >();
  const locationByPassageId = new Map<string, PassageLocation>();

  for (const passage of passages) {
    const location = parsePassageLocation(passage.reference);

    if (!location) {
      continue;
    }

    locationByPassageId.set(passage.id, location);

    const key = chapterKey(location.book, location.chapter);
    const chapter = chapterBuilders.get(key) ?? {
      book: location.book,
      chapter: location.chapter,
      verses: new Map<number, string>()
    };

    for (const verse of passage.verses) {
      chapter.verses.set(verse.number, verse.text);
    }

    chapterBuilders.set(key, chapter);
  }

  const chaptersByKey = new Map<string, ChapterContext>();
  const orderedKeysByBook = new Map<string, string[]>();

  for (const [key, chapter] of chapterBuilders) {
    chaptersByKey.set(key, {
      book: chapter.book,
      chapter: chapter.chapter,
      verses: Array.from(chapter.verses.entries())
        .sort(([left], [right]) => left - right)
        .map(([number, text]) => ({ number, text }))
    });

    const bookKeys = orderedKeysByBook.get(chapter.book) ?? [];
    bookKeys.push(key);
    orderedKeysByBook.set(chapter.book, bookKeys);
  }

  for (const [book, keys] of orderedKeysByBook) {
    orderedKeysByBook.set(
      book,
      keys.sort((left, right) => {
        const leftChapter = chaptersByKey.get(left)?.chapter ?? 0;
        const rightChapter = chaptersByKey.get(right)?.chapter ?? 0;
        return leftChapter - rightChapter;
      })
    );
  }

  return {
    chaptersByKey,
    orderedKeysByBook,
    locationByPassageId
  };
}

function parsePassageLocation(reference: string): PassageLocation | null {
  const match = reference.match(/^(.+)\s+(\d+):(\d+)(?:-(\d+))?$/);

  if (!match) {
    return null;
  }

  return {
    book: match[1],
    chapter: Number(match[2]),
    verseStart: Number(match[3]),
    verseEnd: Number(match[4] ?? match[3])
  };
}

function chapterKey(book: string, chapter: number) {
  return `${book}\t${chapter}`;
}
