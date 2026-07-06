import type { CSSProperties, Dispatch, SetStateAction } from "react";

import { Form } from "@remix-run/react";

import {
  type EarlyChristianReaderTextMode as ReaderTextMode,
  groupChapterPassages,
  isSelectedReaderPassage,
  renderReaderPassageText
} from "~/features/early-christian-reader/reader-passages";
import { ReaderBookHeader } from "~/features/passage-reader/BookHeader";
import { ReaderPassageArticle } from "~/features/reader-ui/ReaderControls";

import {
  getBookAuthorLabel,
  getEarlyChristianBookDescription,
  getEarlyChristianBookHeaderDetails
} from "./book-index";
import { EarlyChristianAuthorInputs } from "./SearchFields";
import type { ChapterAsset, ChapterEntry } from "./types";

export function ChapterList({
  chapterLoadErrors,
  chapters,
  isFindingSimilarFathers,
  isSearching,
  loadedChapters,
  readerTextMode,
  renderedEntries,
  selectedAuthorFilters,
  selectedPassage,
  selectedPassageChapterId,
  setChapterLoadErrors,
  setSelectedPassage,
  setSelectedPassageChapterId,
  updateUrl
}: {
  chapterLoadErrors: Map<string, string>;
  chapters: ChapterEntry[];
  isFindingSimilarFathers: boolean;
  isSearching: boolean;
  loadedChapters: Map<string, ChapterAsset>;
  readerTextMode: ReaderTextMode;
  renderedEntries: ChapterEntry[];
  selectedAuthorFilters: string[];
  selectedPassage: string;
  selectedPassageChapterId: string;
  setChapterLoadErrors: Dispatch<SetStateAction<Map<string, string>>>;
  setSelectedPassage: (range: string) => void;
  setSelectedPassageChapterId: (chapterId: string) => void;
  updateUrl: (chapterId: string, passageRange?: string) => void;
}) {
  return (
    <div className="reader-passages">
      {renderedEntries.map((entry) => {
        const chapter = loadedChapters.get(entry.chapter.id);
        const chapterLoadError = chapterLoadErrors.get(entry.chapter.id);
        const previousEntry = entry.index > 0 ? chapters[entry.index - 1] : null;
        const isBookBoundary = !previousEntry || previousEntry.book.id !== entry.book.id;

        return (
          <section
            className={[
              "reader-chapter",
              "ec-reader-chapter",
              isBookBoundary ? "is-book-boundary" : ""
            ].filter(Boolean).join(" ")}
            data-chapter-id={entry.chapter.id}
            key={entry.chapter.id}
          >
            {isBookBoundary ? (
              <ReaderBookHeader
                description={getEarlyChristianBookDescription(entry.book)}
                details={getEarlyChristianBookHeaderDetails(entry.book)}
                subtitle={getBookAuthorLabel(entry.book)}
                title={entry.book.name}
              />
            ) : null}
            <h2
              className="reader-chapter-heading"
              style={chapterHeadingScaleStyle(`${entry.book.name} ${entry.chapter.chapter}`)}
            >
              {entry.book.name} {entry.chapter.chapter}
              <span>{entry.book.author ?? entry.book.metadata.source.id.toUpperCase()}</span>
            </h2>
            {chapter ? (
              <>
                <p className="ec-chapter-title">{chapter.title}</p>
                <div className="reader-chapter-passages">
                  {groupChapterPassages(chapter, readerTextMode).map((passage) => {
                    const isSelected = isSelectedReaderPassage({
                      chapterId: chapter.id,
                      passage,
                      selectedChapterId: selectedPassageChapterId,
                      selectedRange: selectedPassage
                    });

                    return (
                      <ReaderPassageArticle
                        actions={
                          <>
                            <Form method="post">
                              <input type="hidden" name="intent" value="similar-passage" />
                              <input type="hidden" name="targetCorpus" value="early-christian" />
                              <input type="hidden" name="sourcePassageId" value={passage.key} />
                              <EarlyChristianAuthorInputs authors={selectedAuthorFilters} />
                              <button
                                className="context-button"
                                disabled={isSearching}
                                type="submit"
                              >
                                {isFindingSimilarFathers ? (
                                  <>
                                    <span className="button-spinner" aria-hidden="true" />
                                    Finding similar
                                  </>
                                ) : (
                                  "Similar passages"
                                )}
                              </button>
                            </Form>
                            {isSearching ? (
                              <p className="reader-action-status" role="status">
                                Searching similar passages...
                              </p>
                            ) : null}
                          </>
                        }
                        dataAttributes={{
                          "data-passage-end": passage.verseEnd,
                          "data-passage-key": passage.key,
                          "data-passage-range": passage.rangeLabel,
                          "data-passage-start": passage.verseStart
                        }}
                        isSelected={isSelected}
                        key={passage.key}
                        onToggle={() => {
                          const nextRange = isSelected ? "" : passage.rangeLabel;
                          setSelectedPassage(nextRange);
                          setSelectedPassageChapterId(nextRange ? chapter.id : "");
                          updateUrl(chapter.id, nextRange);
                        }}
                        reference={passage.rangeLabel}
                        text={(
                          <span className="reader-verse">
                            {renderReaderPassageText(passage)}
                          </span>
                        )}
                      />
                    );
                  })}
                </div>
              </>
            ) : chapterLoadError ? (
              <div className="reader-chapter-error" role="status">
                <p>{chapterLoadError}</p>
                <button
                  className="context-button"
                  onClick={() => {
                    setChapterLoadErrors((current) => {
                      const next = new Map(current);
                      next.delete(entry.chapter.id);
                      return next;
                    });
                  }}
                  type="button"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="reader-loading-lines" aria-hidden="true">
                <span className="reader-loading-line is-wide" />
                <span className="reader-loading-line" />
                <span className="reader-loading-line is-medium" />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function chapterHeadingScaleStyle(title: string) {
  return {
    "--ec-chapter-heading-scale": getTextScale(title.length, {
      floor: 0.74,
      startAt: 34,
      step: 0.0048
    })
  } as CSSProperties;
}

function getTextScale(
  length: number,
  options: { floor: number; startAt: number; step: number }
) {
  return Math.max(
    options.floor,
    1 - Math.max(0, length - options.startAt) * options.step
  );
}
