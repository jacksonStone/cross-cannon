import { useCallback, useEffect, useMemo, useState } from "react";

import { Link } from "@remix-run/react";

import {
  buildChapterIndex,
  filterJumpBooksByCanon,
  findInitialJumpSelection
} from "~/features/passage-reader/chapter-index";
import type { StoredFilters } from "~/features/search/types";
import {
  isBackdropClick,
  useEscapeDismiss
} from "~/lib/use-dialog-dismiss";
import { useModalScrollLock } from "~/lib/use-modal-scroll-lock";
import type { BrowserPassage } from "~/lib/scripture-cache-contract";

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
  const scriptureIndex = useMemo(() => buildChapterIndex(passages), [passages]);
  const jumpBooks = useMemo(
    () => filterJumpBooksByCanon(scriptureIndex.jumpBooks, filters?.canon),
    [filters?.canon, scriptureIndex.jumpBooks]
  );
  const initialSelection = useMemo(
    () => findInitialJumpSelection(scriptureIndex, initialPassageId),
    [initialPassageId, scriptureIndex]
  );
  const [selectedBook, setSelectedBook] = useState("");
  const [selectedChapter, setSelectedChapter] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setSelectedBook(initialSelection.book);
    setSelectedChapter(initialSelection.chapter);
  }, [initialSelection.book, initialSelection.chapter]);

  const book = jumpBooks.find((option) => option.name === selectedBook)
    ?? jumpBooks[0];
  const chapter = book?.chapters.find((option) => option.number === selectedChapter)
    ?? book?.chapters[0];
  const isDisabled = !isScriptureReady || jumpBooks.length === 0;
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (!isOpen || jumpBooks.length === 0) {
      return;
    }

    const nextBook = jumpBooks.find((option) => option.name === selectedBook)
      ?? jumpBooks[0];

    if (nextBook.name !== selectedBook) {
      setSelectedBook(nextBook.name);
      setSelectedChapter(nextBook.chapters[0]?.number ?? 1);
    }
  }, [isOpen, jumpBooks, selectedBook]);

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
                    const nextBook = jumpBooks.find(
                      (option) => option.name === event.target.value
                    );

                    if (!nextBook) {
                      return;
                    }

                    setSelectedBook(nextBook.name);
                    setSelectedChapter(nextBook.chapters[0]?.number ?? 1);
                  }}
                >
                  {jumpBooks.map((option) => (
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
