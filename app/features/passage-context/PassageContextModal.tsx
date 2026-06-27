import { useEffect, useMemo, useState } from "react";

import type { BrowserPassage } from "~/lib/scripture-cache.server";

const TRANSLATION_ABBREVIATION = "WEB";

type PassageLocation = {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
};

type ChapterPassage = PassageLocation & {
  id: string;
  reference: string;
  verses: BrowserPassage["verses"];
};

type ChapterContext = {
  book: string;
  chapter: number;
  passages: ChapterPassage[];
};

type ChapterIndex = {
  chaptersByKey: Map<string, ChapterContext>;
  orderedKeysByBook: Map<string, string[]>;
  locationByPassageId: Map<string, PassageLocation>;
};

type PassageContextModalProps = {
  passage: BrowserPassage;
  passages: BrowserPassage[];
  onClose: () => void;
};

export function PassageContextModal({
  passage,
  passages,
  onClose
}: PassageContextModalProps) {
  const chapterIndex = useMemo(() => buildChapterIndex(passages), [passages]);
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
            <h2 id="context-modal-title">
              {activeChapter.book} {activeChapter.chapter}
            </h2>
          </div>
          <button className="filter-modal-close" onClick={onClose} type="button">
            Close
          </button>
        </header>
        <div className="context-modal-body">
          <div className="chapter-passages">
            {activeChapter.passages.map((chapterPassage) => (
              <article
                className={
                  chapterPassage.id === passage.id
                    ? "chapter-passage is-selected"
                    : "chapter-passage"
                }
                key={chapterPassage.id}
              >
                <span className="chapter-passage-reference">
                  {chapterPassage.reference}
                </span>
                <p className="chapter-text">
                  {chapterPassage.verses.map((verse, index) => (
                    <span className="chapter-verse" key={verse.number}>
                      <sup>{verse.number}</sup>
                      {verse.text}
                      {index < chapterPassage.verses.length - 1 ? " " : ""}
                    </span>
                  ))}
                </p>
              </article>
            ))}
          </div>
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
      passages: ChapterPassage[];
    }
  >();
  const locationByPassageId = new Map<string, PassageLocation>();

  for (const passage of passages) {
    const location = parsePassageLocation(passage.reference);

    if (!location || passage.verses.length === 0) {
      continue;
    }

    locationByPassageId.set(passage.id, location);

    const key = chapterKey(location.book, location.chapter);
    const chapter = chapterBuilders.get(key) ?? {
      book: location.book,
      chapter: location.chapter,
      passages: []
    };

    chapter.passages.push({
      ...location,
      id: passage.id,
      reference: passage.reference,
      verses: passage.verses
    });
    chapterBuilders.set(key, chapter);
  }

  const chaptersByKey = new Map<string, ChapterContext>();
  const orderedKeysByBook = new Map<string, string[]>();

  for (const [key, chapter] of chapterBuilders) {
    chaptersByKey.set(key, {
      book: chapter.book,
      chapter: chapter.chapter,
      passages: chapter.passages.sort(
        (left, right) => left.verseStart - right.verseStart
      )
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
