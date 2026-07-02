import { useCallback, useEffect, useMemo, useState } from "react";

import { Link } from "@remix-run/react";

import { parsePassageLocation } from "~/features/passage-reader/chapter-index";
import { sortCanonicalBooks } from "~/features/search/canons";
import type { StoredFilters } from "~/features/search/types";
import {
  isBackdropClick,
  useEscapeDismiss
} from "~/lib/use-dialog-dismiss";
import { useModalScrollLock } from "~/lib/use-modal-scroll-lock";
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
  className?: string;
  filters?: StoredFilters;
  initialPassageId?: string;
  isScriptureReady: boolean;
  launcherVariant?: "block" | "inline";
  label?: string;
  onJumpToPassage?: (passageId: string) => void;
  passages: BrowserPassage[];
};

export function PassageJump({
  className,
  filters,
  initialPassageId,
  isScriptureReady,
  label = "Jump to passage",
  launcherVariant = "block",
  onJumpToPassage,
  passages
}: PassageJumpProps) {
  const jumpIndex = useMemo(() => buildJumpIndex(passages), [passages]);
  const initialSelection = useMemo(
    () => findInitialSelection(jumpIndex, passages, initialPassageId),
    [initialPassageId, jumpIndex, passages]
  );
  const [selectedBook, setSelectedBook] = useState("");
  const [selectedChapter, setSelectedChapter] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setSelectedBook(initialSelection.book);
    setSelectedChapter(initialSelection.chapter);
  }, [initialSelection.book, initialSelection.chapter]);

  const book = jumpIndex.books.find((option) => option.name === selectedBook)
    ?? jumpIndex.books[0];
  const chapter = book?.chapters.find((option) => option.number === selectedChapter)
    ?? book?.chapters[0];
  const isDisabled = !isScriptureReady || jumpIndex.books.length === 0;
  const close = useCallback(() => setIsOpen(false), []);

  useModalScrollLock(isOpen && !isDisabled);
  useEscapeDismiss({
    isOpen: isOpen && !isDisabled,
    onDismiss: close
  });

  return (
    <>
      <section
        className={[
          "passage-jump-launcher",
          launcherVariant === "inline" ? "is-inline" : "",
          className ?? ""
        ].filter(Boolean).join(" ")}
        aria-label="Jump to passage"
      >
        <button
          className="context-button"
          disabled={isDisabled}
          onClick={() => setIsOpen(true)}
          type="button"
        >
          {isDisabled ? "Loading" : label}
        </button>
      </section>

      {isOpen && !isDisabled ? (
        <div
          className="passage-jump-backdrop"
          onClick={(event) => {
            event.stopPropagation();

            if (isBackdropClick(event)) {
              close();
            }
          }}
        >
          <section
            aria-labelledby="passage-jump-title"
            aria-modal="true"
            className="passage-jump-modal"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="passage-jump-modal-header">
              <div>
                <p className="eyebrow">Jump</p>
                <h2 id="passage-jump-title">Choose a passage</h2>
              </div>
              <button
                className="filter-modal-close"
                onClick={close}
                type="button"
              >
                Close
              </button>
            </header>

            <div className="passage-jump-modal-body">
              <label className="passage-jump-book">
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
                    onJumpToPassage ? (
                      <button
                        className="passage-jump-verse"
                        key={verse.number}
                        onClick={() => {
                          setIsOpen(false);
                          onJumpToPassage(verse.passageId);
                        }}
                        type="button"
                      >
                        {verse.number}
                      </button>
                    ) : (
                      <Link
                        className="passage-jump-verse"
                        key={verse.number}
                        to={buildReaderUrl(verse.passageId, filters)}
                      >
                        {verse.number}
                      </Link>
                    )
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
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
