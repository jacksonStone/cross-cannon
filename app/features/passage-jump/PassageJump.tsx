import { useEffect, useMemo, useState } from "react";

import { Link } from "@remix-run/react";

import { parsePassageLocation } from "~/features/passage-reader/chapter-index";
import { sortCanonicalBooks } from "~/features/search/canons";
import type { StoredFilters } from "~/features/search/types";
import type { BrowserPassage } from "~/lib/scripture-cache.server";

type VerseTarget = {
  number: number;
  passageId: string;
};

type ChapterOption = {
  number: number;
  verses: VerseTarget[];
};

type BookOption = {
  name: string;
  chapters: ChapterOption[];
};

type PassageJumpProps = {
  filters?: StoredFilters;
  initialPassageId?: string;
  isScriptureReady: boolean;
  passages: BrowserPassage[];
};

export function PassageJump({
  filters,
  initialPassageId,
  isScriptureReady,
  passages
}: PassageJumpProps) {
  const jumpIndex = useMemo(() => buildJumpIndex(passages), [passages]);
  const initialSelection = useMemo(
    () => findInitialSelection(jumpIndex, passages, initialPassageId),
    [initialPassageId, jumpIndex, passages]
  );
  const [selectedBook, setSelectedBook] = useState("");
  const [selectedChapter, setSelectedChapter] = useState(0);

  useEffect(() => {
    setSelectedBook(initialSelection.book);
    setSelectedChapter(initialSelection.chapter);
  }, [initialSelection.book, initialSelection.chapter]);

  const book = jumpIndex.books.find((option) => option.name === selectedBook)
    ?? jumpIndex.books[0];
  const chapter = book?.chapters.find((option) => option.number === selectedChapter)
    ?? book?.chapters[0];

  if (!isScriptureReady || jumpIndex.books.length === 0) {
    return (
      <section className="passage-jump" aria-label="Jump to passage">
        <p className="passage-jump-title">Jump</p>
        <p className="passage-jump-loading">Loading books...</p>
      </section>
    );
  }

  return (
    <section className="passage-jump" aria-label="Jump to passage">
      <div className="passage-jump-header">
        <p className="passage-jump-title">Jump</p>
        <label>
          <span>Book</span>
          <select
            value={book.name}
            onChange={(event) => {
              const nextBook = jumpIndex.books.find(
                (option) => option.name === event.target.value
              );

              if (!nextBook) {
                return;
              }

              setSelectedBook(nextBook.name);
              setSelectedChapter(nextBook.chapters[0]?.number ?? 1);
            }}
          >
            {jumpIndex.books.map((option) => (
              <option key={option.name} value={option.name}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="passage-jump-group" aria-label="Chapter">
        <span>Chapter</span>
        <div className="passage-jump-options">
          {book.chapters.map((option) => (
            <button
              className={
                option.number === chapter.number ? "is-selected" : undefined
              }
              key={option.number}
              onClick={() => setSelectedChapter(option.number)}
              type="button"
            >
              {option.number}
            </button>
          ))}
        </div>
      </div>

      <div className="passage-jump-group" aria-label="Verse">
        <span>Verse</span>
        <div className="passage-jump-options">
          {chapter.verses.map((verse) => (
            <Link
              className="passage-jump-verse"
              key={verse.number}
              to={buildReaderUrl(verse.passageId, filters)}
            >
              {verse.number}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function buildJumpIndex(passages: BrowserPassage[]) {
  const bookMap = new Map<
    string,
    {
      chapters: Map<number, Map<number, string>>;
      name: string;
    }
  >();

  for (const passage of passages) {
    const location = parsePassageLocation(passage.reference);

    if (!location) {
      continue;
    }

    const book = bookMap.get(location.book) ?? {
      chapters: new Map<number, Map<number, string>>(),
      name: location.book
    };
    const chapter = book.chapters.get(location.chapter) ?? new Map<number, string>();

    for (const verse of passage.verses) {
      if (!chapter.has(verse.number)) {
        chapter.set(verse.number, passage.id);
      }
    }

    book.chapters.set(location.chapter, chapter);
    bookMap.set(location.book, book);
  }

  return {
    books: sortCanonicalBooks([...bookMap.keys()]).map((bookName) => {
      const book = bookMap.get(bookName);

      return {
        name: bookName,
        chapters: [...(book?.chapters.entries() ?? [])]
          .sort(([left], [right]) => left - right)
          .map(([chapterNumber, verses]) => ({
            number: chapterNumber,
            verses: [...verses.entries()]
              .sort(([left], [right]) => left - right)
              .map(([number, passageId]) => ({ number, passageId }))
          }))
      };
    })
  };
}

function findInitialSelection(
  jumpIndex: ReturnType<typeof buildJumpIndex>,
  passages: BrowserPassage[],
  initialPassageId?: string
) {
  const initialPassage = initialPassageId
    ? passages.find((passage) => passage.id === initialPassageId)
    : null;
  const initialLocation = initialPassage
    ? parsePassageLocation(initialPassage.reference)
    : null;
  const firstBook = jumpIndex.books[0];
  const firstChapter = firstBook?.chapters[0];

  return {
    book: initialLocation?.book ?? firstBook?.name ?? "",
    chapter: initialLocation?.chapter ?? firstChapter?.number ?? 0
  };
}

function buildReaderUrl(passageId: string, filters?: StoredFilters) {
  const searchParams = new URLSearchParams();

  if (filters?.canon) {
    searchParams.set("canon", filters.canon);
  }

  if (filters?.matchCount) {
    searchParams.set("matchCount", String(filters.matchCount));
  }

  for (const book of filters?.books ?? []) {
    searchParams.append("books", book);
  }

  const query = searchParams.toString();
  return `/reader/${passageId}${query ? `?${query}` : ""}`;
}
