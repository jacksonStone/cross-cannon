import { useEffect, useMemo, useRef, useState } from "react";

import { Form, Link, useNavigation } from "@remix-run/react";

import { PassageJump } from "~/features/passage-jump/PassageJump";
import { sortCanonicalBooks } from "~/features/search/canons";
import type { StoredFilters } from "~/features/search/types";
import type { BrowserPassage } from "~/lib/scripture-cache.server";

import { buildChapterIndex, chapterKey } from "./chapter-index";

const TRANSLATION_ABBREVIATION = "WEB";
const HEADER_SCROLL_OFFSET = 118;
const CHAPTER_WINDOW_RADIUS = 3;
const ESTIMATED_CHAPTER_HEIGHT = 820;

type PassageReaderProps = {
  backPassageId?: string | null;
  filters: StoredFilters;
  initialPassageId: string;
  isScriptureReady: boolean;
  onBack?: () => void;
  onJumpToPassage?: (passageId: string) => void;
  onLocationChange?: (passageId: string) => void;
  onOpenSearch?: () => void;
  passages: BrowserPassage[];
};

export function PassageReader({
  backPassageId,
  filters,
  initialPassageId,
  isScriptureReady,
  onBack,
  onJumpToPassage,
  onLocationChange,
  onOpenSearch,
  passages
}: PassageReaderProps) {
  const navigation = useNavigation();
  const hasScrolledToInitialPassageRef = useRef(false);
  const chapterHeightByKeyRef = useRef(new Map<string, number>());
  const [, setMeasuredChapterVersion] = useState(0);
  const chapterIndex = useMemo(() => buildChapterIndex(passages), [passages]);
  const orderedChapterEntries = useMemo(
    () => {
      const chapters = [...chapterIndex.chaptersByKey.values()];
      const bookOrder = new Map(
        sortCanonicalBooks([...new Set(chapters.map((chapter) => chapter.book))])
          .map((book, index) => [book, index])
      );

      return chapters
        .sort((left, right) => {
          const leftBookOrder = bookOrder.get(left.book) ?? Number.MAX_SAFE_INTEGER;
          const rightBookOrder = bookOrder.get(right.book) ?? Number.MAX_SAFE_INTEGER;

          if (leftBookOrder !== rightBookOrder) {
            return leftBookOrder - rightBookOrder;
          }

          return left.chapter - right.chapter;
        })
        .map((chapter) => ({
          chapter,
          key: chapterKey(chapter.book, chapter.chapter)
        }));
    },
    [chapterIndex]
  );
  const renderedChapterKeys = useMemo(
    () => orderedChapterEntries.map((entry) => entry.key),
    [orderedChapterEntries]
  );
  const initialLocation = chapterIndex.locationByPassageId.get(initialPassageId);
  const initialChapterKey = initialLocation
    ? chapterKey(initialLocation.book, initialLocation.chapter)
    : orderedChapterEntries[0]?.key ?? null;
  const [activeChapterKey, setActiveChapterKey] = useState(initialChapterKey);
  const [selectedPassageId, setSelectedPassageId] = useState("");
  const activeChapter = activeChapterKey
    ? chapterIndex.chaptersByKey.get(activeChapterKey)
    : null;
  const activeChapterIndex = activeChapterKey
    ? renderedChapterKeys.indexOf(activeChapterKey)
    : -1;
  const safeActiveChapterIndex = activeChapterIndex >= 0 ? activeChapterIndex : 0;
  const windowStartIndex = Math.max(
    0,
    safeActiveChapterIndex - CHAPTER_WINDOW_RADIUS
  );
  const windowEndIndex = Math.min(
    orderedChapterEntries.length,
    safeActiveChapterIndex + CHAPTER_WINDOW_RADIUS + 1
  );
  const renderedChapterEntriesInWindow = orderedChapterEntries.slice(
    windowStartIndex,
    windowEndIndex
  );
  const renderedWindowKey = renderedChapterEntriesInWindow
    .map((entry) => entry.key)
    .join("|");
  const topSpacerHeight = sumChapterHeights(
    orderedChapterEntries,
    0,
    windowStartIndex,
    chapterHeightByKeyRef.current
  );
  const bottomSpacerHeight = sumChapterHeights(
    orderedChapterEntries,
    windowEndIndex,
    orderedChapterEntries.length,
    chapterHeightByKeyRef.current
  );
  const passageJumpInitialPassageId =
    activeChapter?.passages[0]?.id ?? initialPassageId;

  useEffect(() => {
    setActiveChapterKey(initialChapterKey);
    setSelectedPassageId("");
    hasScrolledToInitialPassageRef.current = false;
  }, [initialChapterKey, initialPassageId]);

  useEffect(() => {
    if (!activeChapterKey || hasScrolledToInitialPassageRef.current) {
      return;
    }

    window.requestAnimationFrame(() => {
      const targetPassage = [
        ...document.querySelectorAll<HTMLElement>(".reader-passage")
      ].find((element) => element.dataset.passageId === initialPassageId);

      targetPassage?.scrollIntoView({
        block: "start",
        behavior: hasScrolledToInitialPassageRef.current ? "smooth" : "auto"
      });
      hasScrolledToInitialPassageRef.current = true;
    });
  }, [activeChapterKey, initialPassageId]);

  useEffect(() => {
    if (orderedChapterEntries.length === 0) {
      return;
    }

    let frame = 0;

    const updateLocation = () => {
      frame = 0;
      const passageElements = [
        ...document.querySelectorAll<HTMLElement>(".reader-passage")
      ];
      const currentPassage = passageElements.find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > 120;
      }) ?? passageElements[0];
      const passageId = currentPassage?.dataset.passageId;

      if (passageId) {
        onLocationChange?.(passageId);
      }

      const chapterElements = [
        ...document.querySelectorAll<HTMLElement>(".reader-chapter")
      ];
      const firstChapter = chapterElements[0];
      const lastChapter = chapterElements[chapterElements.length - 1];
      const firstChapterRect = firstChapter?.getBoundingClientRect();
      const lastChapterRect = lastChapter?.getBoundingClientRect();
      const currentChapter = [...chapterElements]
        .reverse()
        .find((element) => element.getBoundingClientRect().top <= HEADER_SCROLL_OFFSET)
        ?? chapterElements.find((element) => {
          const rect = element.getBoundingClientRect();
          return rect.bottom > HEADER_SCROLL_OFFSET;
        });
      let currentChapterKey = currentChapter?.dataset.chapterKey;

      if (
        lastChapterRect
        && lastChapterRect.bottom < HEADER_SCROLL_OFFSET
        && windowEndIndex < renderedChapterKeys.length
      ) {
        currentChapterKey = renderedChapterKeys[windowEndIndex];
      } else if (
        firstChapterRect
        && firstChapterRect.top > HEADER_SCROLL_OFFSET
        && windowStartIndex > 0
      ) {
        currentChapterKey = renderedChapterKeys[windowStartIndex - 1];
      }

      if (currentChapterKey) {
        setActiveChapterKey((existingChapterKey) =>
          existingChapterKey === currentChapterKey
            ? existingChapterKey
            : currentChapterKey
        );
      }
    };

    const scheduleUpdate = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(updateLocation);
      }
    };

    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.requestAnimationFrame(updateLocation);

    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [
    onLocationChange,
    orderedChapterEntries.length,
    renderedChapterKeys,
    windowEndIndex,
    windowStartIndex
  ]);

  useEffect(() => {
    let didMeasure = false;

    document.querySelectorAll<HTMLElement>(".reader-chapter").forEach((element) => {
      const key = element.dataset.chapterKey;

      if (!key) {
        return;
      }

      const measuredHeight = element.getBoundingClientRect().height;
      const previousHeight = chapterHeightByKeyRef.current.get(key);

      if (
        measuredHeight > 0
        && (!previousHeight || Math.abs(previousHeight - measuredHeight) > 1)
      ) {
        chapterHeightByKeyRef.current.set(key, measuredHeight);
        didMeasure = true;
      }
    });

    if (didMeasure) {
      setMeasuredChapterVersion((version) => version + 1);
    }
  }, [renderedWindowKey, selectedPassageId]);

  const isSearchingSimilar = navigation.state === "submitting"
    && navigation.formData?.get("intent") === "similar-passage";

  if (!isScriptureReady) {
    return (
      <section className="reader-empty">
        <p>Loading Scripture...</p>
      </section>
    );
  }

  if (!activeChapter) {
    return (
      <section className="reader-empty">
        <p>This passage could not be found.</p>
        <Link className="context-button" to="/">
          Back to reader
        </Link>
      </section>
    );
  }

  return (
    <section className="reader-page" aria-labelledby="reader-title">
      <header className="reader-header">
        <div className="reader-header-title">
          <h1 id="reader-title">
            {activeChapter.book} {activeChapter.chapter}
          </h1>
        </div>
        <div className="reader-header-actions">
          <PassageJump
            filters={filters}
            initialPassageId={passageJumpInitialPassageId}
            isScriptureReady={isScriptureReady}
            label="Jump"
            launcherVariant="inline"
            onJumpToPassage={onJumpToPassage}
            passages={passages}
          />
          {backPassageId && onBack ? (
            <button className="context-button" onClick={onBack} type="button">
              Back
            </button>
          ) : null}
          {onOpenSearch ? (
            <button className="context-button" onClick={onOpenSearch} type="button">
              Search
            </button>
          ) : (
            <Link className="context-button" to="/">
              Search
            </Link>
          )}
        </div>
      </header>

      <div className="reader-passages">
        {topSpacerHeight > 0 ? (
          <div
            aria-hidden="true"
            className="reader-chapter-spacer"
            style={{ height: topSpacerHeight }}
          />
        ) : null}
        {renderedChapterEntriesInWindow.map(({ chapter, key: currentChapterKey }) => {
          return (
            <section
              className="reader-chapter"
              data-chapter-key={currentChapterKey}
              key={currentChapterKey}
            >
              <h2 className="reader-chapter-heading">
                {chapter.book} {chapter.chapter}
                <span title="World English Bible">{TRANSLATION_ABBREVIATION}</span>
              </h2>
              <div className="reader-chapter-passages">
                {chapter.passages.map((passage) => {
                  const isSelected = passage.id === selectedPassageId;

                  return (
                    <article
                      className={[
                        "reader-passage",
                        isSelected ? "is-selected" : ""
                      ].filter(Boolean).join(" ")}
                      data-passage-id={passage.id}
                      key={passage.id}
                    >
                      <button
                        aria-expanded={isSelected}
                        className="reader-passage-button"
                        onClick={() => setSelectedPassageId(isSelected ? "" : passage.id)}
                        type="button"
                      >
                        <span className="reader-passage-reference">
                          {passage.reference}
                        </span>
                        <span className="reader-passage-text">
                          {passage.verses.map((verse, index) => (
                            <span className="reader-verse" key={verse.number}>
                              {verse.text}
                              {index < passage.verses.length - 1 ? " " : ""}
                            </span>
                          ))}
                        </span>
                      </button>
                      {isSelected ? (
                        <div className="reader-passage-actions">
                          <Form action="/?index" method="post">
                            <input
                              type="hidden"
                              name="intent"
                              value="similar-passage"
                            />
                            <input
                              type="hidden"
                              name="sourcePassageId"
                              value={passage.id}
                            />
                            <SearchFilterInputs filters={filters} />
                            <button
                              className="context-button"
                              disabled={isSearchingSimilar}
                              type="submit"
                            >
                              {isSearchingSimilar ? "Finding similar" : "Similar passages"}
                            </button>
                          </Form>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
        {bottomSpacerHeight > 0 ? (
          <div
            aria-hidden="true"
            className="reader-chapter-spacer"
            style={{ height: bottomSpacerHeight }}
          />
        ) : null}
      </div>
    </section>
  );
}

function sumChapterHeights(
  entries: Array<{ key: string }>,
  startIndex: number,
  endIndex: number,
  measuredHeights: Map<string, number>
) {
  return entries
    .slice(startIndex, endIndex)
    .reduce(
      (sum, entry) => sum + (measuredHeights.get(entry.key) ?? ESTIMATED_CHAPTER_HEIGHT),
      0
    );
}

function SearchFilterInputs({ filters }: { filters: StoredFilters }) {
  return (
    <>
      {filters.canon ? <input type="hidden" name="canon" value={filters.canon} /> : null}
      {filters.matchCount ? (
        <input type="hidden" name="matchCount" value={filters.matchCount} />
      ) : null}
      {filters.books?.map((book) => (
        <input key={book} type="hidden" name="books" value={book} />
      ))}
    </>
  );
}
