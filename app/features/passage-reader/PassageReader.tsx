import { useEffect, useMemo, useState } from "react";

import { Form, Link, useNavigation } from "@remix-run/react";

import { PassageJump } from "~/features/passage-jump/PassageJump";
import type { StoredFilters } from "~/features/search/types";
import type { BrowserPassage } from "~/lib/scripture-cache.server";

import { buildChapterIndex, chapterKey } from "./chapter-index";

const TRANSLATION_ABBREVIATION = "WEB";

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
  const chapterIndex = useMemo(() => buildChapterIndex(passages), [passages]);
  const initialLocation = chapterIndex.locationByPassageId.get(initialPassageId);
  const initialChapterKey = initialLocation
    ? chapterKey(initialLocation.book, initialLocation.chapter)
    : null;
  const [activeChapterKey, setActiveChapterKey] = useState(initialChapterKey);
  const [selectedPassageId, setSelectedPassageId] = useState("");
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

  useEffect(() => {
    setActiveChapterKey(initialChapterKey);
    setSelectedPassageId("");
  }, [initialChapterKey, initialPassageId]);

  useEffect(() => {
    if (!activeChapterKey) {
      return;
    }

    window.requestAnimationFrame(() => {
      document.querySelector(".reader-passage.is-highlighted")?.scrollIntoView({
        block: "start"
      });
    });
  }, [activeChapterKey, initialPassageId]);

  useEffect(() => {
    if (!activeChapter || !onLocationChange) {
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
        onLocationChange(passageId);
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
  }, [activeChapter, activeChapterKey, onLocationChange]);

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
        <div>
          <p className="eyebrow">Reader</p>
          <h1 id="reader-title">
            {activeChapter.book} {activeChapter.chapter}
          </h1>
        </div>
        <div className="reader-header-actions">
          <PassageJump
            filters={filters}
            initialPassageId={initialPassageId}
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

      <nav className="reader-nav reader-nav-top" aria-label="Previous chapter">
        <button
          className="secondary-button"
          disabled={!previousChapterKey}
          onClick={() => previousChapterKey && setActiveChapterKey(previousChapterKey)}
          type="button"
        >
          Previous chapter
        </button>
        <span title="World English Bible">{TRANSLATION_ABBREVIATION}</span>
      </nav>

      <div className="reader-passages">
        {activeChapter.passages.map((passage) => {
          const isInitialPassage = passage.id === initialPassageId;
          const isSelected = passage.id === selectedPassageId;

          return (
            <article
              className={[
                "reader-passage",
                isInitialPassage ? "is-highlighted" : "",
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
                <span className="reader-passage-reference">{passage.reference}</span>
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
                    <input type="hidden" name="intent" value="similar-passage" />
                    <input type="hidden" name="sourcePassageId" value={passage.id} />
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

      <nav className="reader-nav reader-nav-bottom" aria-label="Next chapter">
        <span title="World English Bible">{TRANSLATION_ABBREVIATION}</span>
        <button
          disabled={!nextChapterKey}
          onClick={() => nextChapterKey && setActiveChapterKey(nextChapterKey)}
          type="button"
        >
          Next chapter
        </button>
      </nav>
    </section>
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
