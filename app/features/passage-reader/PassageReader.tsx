import {
  useCallback,
  useMemo,
  useRef,
  useState
} from "react";

import { Form, Link, useNavigation } from "@remix-run/react";

import { PassageJump } from "~/features/passage-jump/PassageJump";
import { ReaderCorpusSwitch } from "~/features/reader-switch/ReaderCorpusSwitch";
import {
  DEFAULT_READER_SCROLL_WINDOW,
  useAnchoredReaderWindow,
  useReaderHeaderOffset
} from "~/features/reader-window/useReaderWindow";
import { getCenteredWindowRange } from "~/features/reader-window/window-range";
import {
  type ReaderTheme,
  readerSettingsStyle
} from "~/features/reader-settings/reader-settings";
import {
  ReaderPassageArticle,
  ReaderSettingsControl,
  ReaderTools,
  useStoredReaderSettings
} from "~/features/reader-ui/ReaderControls";
import { sortCanonicalBooks } from "~/features/search/canons";
import type { StoredFilters } from "~/features/search/types";
import type { BrowserPassage } from "~/lib/scripture-cache.server";

import { ReaderBookHeader, type ReaderBookHeaderDetail } from "./BookHeader";
import { buildChapterIndex, chapterKey } from "./chapter-index";

const TRANSLATION_ABBREVIATION = "WEB";
const TRANSLATION_NAME = "World English Bible";
const INITIAL_PREVIOUS_CHAPTERS = DEFAULT_READER_SCROLL_WINDOW.initialBefore;
const INITIAL_NEXT_CHAPTERS = DEFAULT_READER_SCROLL_WINDOW.initialAfter;

type ReaderBookMetadata = {
  description?: string | null;
  details?: ReaderBookHeaderDetail[];
  subtitle?: string | null;
};

type PassageReaderProps = {
  bookMetadataByBook?: Map<string, ReaderBookMetadata>;
  filters: StoredFilters;
  initialPassageId: string;
  isScriptureReady: boolean;
  onChapterChange?: (chapterKey: string) => void;
  onJumpToPassage?: (passageId: string) => void;
  onOpenSearch?: () => void;
  onThemeChange?: (theme: ReaderTheme) => void;
  passages: BrowserPassage[];
};

export function PassageReader({
  bookMetadataByBook,
  filters,
  initialPassageId,
  isScriptureReady,
  onChapterChange,
  onJumpToPassage,
  onOpenSearch,
  onThemeChange,
  passages
}: PassageReaderProps) {
  const navigation = useNavigation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const readerHeaderOffset = useReaderHeaderOffset();
  const { readerSettings, setReaderSettings } = useStoredReaderSettings({
    onThemeChange
  });
  const [isReaderToolsOpen, setIsReaderToolsOpen] = useState(false);
  const [playingAudioUrl, setPlayingAudioUrl] = useState<string | null>(null);
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
  const chapterCountByBook = useMemo(() => {
    const counts = new Map<string, number>();

    for (const entry of orderedChapterEntries) {
      counts.set(entry.chapter.book, (counts.get(entry.chapter.book) ?? 0) + 1);
    }

    return counts;
  }, [orderedChapterEntries]);
  const initialLocation = chapterIndex.locationByPassageId.get(initialPassageId);
  const initialChapterKey = initialLocation
    ? chapterKey(initialLocation.book, initialLocation.chapter)
    : orderedChapterEntries[0]?.key ?? null;
  const [activeChapterKey, setActiveChapterKey] = useState(initialChapterKey);
  const [selectedPassageId, setSelectedPassageId] = useState("");
  const activeChapter = activeChapterKey
    ? chapterIndex.chaptersByKey.get(activeChapterKey)
    : null;
  const initialChapterIndex = initialChapterKey
    ? renderedChapterKeys.indexOf(initialChapterKey)
    : -1;
  const initialRenderedRange = useMemo(
    () => getInitialRenderedRange(
      initialChapterIndex,
      orderedChapterEntries
    ),
    [initialChapterIndex, orderedChapterEntries.length]
  );
  const resetReaderWindow = useCallback(() => {
    setActiveChapterKey(initialChapterKey);
    setSelectedPassageId("");
  }, [initialChapterKey]);
  const activeAudioUrl = activeChapter?.audioUrl ?? null;
  const passageJumpInitialPassageId =
    activeChapter?.passages[0]?.id ?? initialPassageId;
  const isActiveChapterPlaying = Boolean(
    activeAudioUrl && playingAudioUrl === activeAudioUrl
  );

  const toggleActiveChapterAudio = useCallback(() => {
    const audio = audioRef.current;

    if (!audio || !activeAudioUrl) {
      return;
    }

    if (isActiveChapterPlaying) {
      audio.pause();
      setPlayingAudioUrl(null);
      return;
    }

    audio.src = activeAudioUrl;
    void audio.play()
      .then(() => setPlayingAudioUrl(activeAudioUrl))
      .catch(() => setPlayingAudioUrl(null));
  }, [activeAudioUrl, isActiveChapterPlaying]);

  const findInitialPassageTarget = useCallback(
    () => findRenderedPassageElement(initialPassageId),
    [initialPassageId]
  );
  const scrollToTopWhenInitialPassageMissing = useCallback(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);
  const updateActiveChapterFromScroll = useCallback((chapterKey: string) => {
    setActiveChapterKey(chapterKey);
    onChapterChange?.(chapterKey);
  }, [onChapterChange]);
  const getRenderedChapterKey = useCallback((element: HTMLElement) => (
    element.dataset.chapterKey
  ), []);

  const { renderedRange } = useAnchoredReaderWindow({
    activeKey: activeChapterKey,
    chapterSelector: ".reader-chapter",
    edgePx: DEFAULT_READER_SCROLL_WINDOW.edgePx,
    expandCount: DEFAULT_READER_SCROLL_WINDOW.expandCount,
    findInitialTarget: findInitialPassageTarget,
    getChapterKey: getRenderedChapterKey,
    headerOffset: readerHeaderOffset,
    initialActiveKey: initialChapterKey,
    initialRange: initialRenderedRange,
    initialScrollMaxFrames: DEFAULT_READER_SCROLL_WINDOW.initialScrollMaxFrames,
    initialScrollReady: isScriptureReady && orderedChapterEntries.length > 0,
    itemCount: orderedChapterEntries.length,
    minReadingAnchorOffset: DEFAULT_READER_SCROLL_WINDOW.minReadingAnchorOffset,
    onActiveKeyChange: updateActiveChapterFromScroll,
    onMissingInitialTarget: scrollToTopWhenInitialPassageMissing,
    onReset: resetReaderWindow,
    readingAnchorRatio: DEFAULT_READER_SCROLL_WINDOW.readingAnchorRatio,
    resetKey: `${initialPassageId}|${initialChapterKey ?? ""}`,
    trackingReady: true,
    windowReady: isScriptureReady
  });
  const renderedChapterEntries = useMemo(
    () => {
      if (renderedRange.endIndex < renderedRange.startIndex) {
        return [];
      }

      return orderedChapterEntries.slice(
        Math.max(0, renderedRange.startIndex),
        renderedRange.endIndex + 1
      );
    },
    [orderedChapterEntries, renderedRange.endIndex, renderedRange.startIndex]
  );
  const isInitialChapterReadyToRender = Boolean(
    initialChapterKey
    && renderedChapterEntries.some((entry) => entry.key === initialChapterKey)
  );

  const isSearchingSimilar = navigation.state === "submitting"
    && navigation.formData?.get("intent") === "similar-passage";
  const readerStyle = readerSettingsStyle(readerSettings);

  if (!isScriptureReady || !isInitialChapterReadyToRender) {
    return (
      <section
        className={`reader-page reader-theme-${readerSettings.theme} reader-loading`}
        aria-busy="true"
        aria-labelledby="reader-loading-title"
        style={readerStyle}
      >
        <header className="reader-header reader-loading-header">
          <div className="reader-header-title">
            <h1 id="reader-loading-title">Loading Scripture</h1>
          </div>
          <div className="reader-loading-meter" aria-hidden="true">
            <span />
          </div>
        </header>

        <div className="reader-loading-passages" aria-hidden="true">
          <div className="reader-loading-chapter-heading">
            <span />
            <span />
          </div>
          <div className="reader-loading-lines">
            <span className="reader-loading-line is-wide" />
            <span className="reader-loading-line" />
            <span className="reader-loading-line is-medium" />
            <span className="reader-loading-line is-wide" />
            <span className="reader-loading-line is-short" />
          </div>
          <div className="reader-loading-lines">
            <span className="reader-loading-line is-medium" />
            <span className="reader-loading-line is-wide" />
            <span className="reader-loading-line" />
            <span className="reader-loading-line is-short" />
          </div>
        </div>
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
    <section
      className={`reader-page reader-theme-${readerSettings.theme}`}
      aria-labelledby="reader-title"
      style={readerStyle}
    >
      <header className="reader-header">
        <audio
          ref={audioRef}
          onEnded={() => setPlayingAudioUrl(null)}
          onPause={() => setPlayingAudioUrl(null)}
          preload="none"
        />
        <div className="reader-header-title">
          <h1 id="reader-title">
            {activeChapter.book} {activeChapter.chapter}
          </h1>
        </div>
        <ReaderTools
          isOpen={isReaderToolsOpen}
          onClose={() => setIsReaderToolsOpen(false)}
          onOpen={() => setIsReaderToolsOpen(true)}
        >
            <button
              aria-label={
                activeAudioUrl
                  ? `${isActiveChapterPlaying ? "Pause" : "Play"} ${activeChapter.book} ${activeChapter.chapter} audio`
                  : `Audio unavailable for ${activeChapter.book} ${activeChapter.chapter}`
              }
              className="context-button reader-icon-button"
              disabled={!activeAudioUrl}
              onClick={toggleActiveChapterAudio}
              title={
                activeAudioUrl
                  ? `${isActiveChapterPlaying ? "Pause" : "Play"} audio`
                  : "Audio unavailable"
              }
              type="button"
            >
              {isActiveChapterPlaying ? "❚❚" : "🔊"}
            </button>
            {onOpenSearch ? (
              <button
                aria-label="Search"
                className="context-button reader-icon-button"
                onClick={() => {
                  setIsReaderToolsOpen(false);
                  onOpenSearch();
                }}
                title="Search"
                type="button"
              >
                🔍
              </button>
            ) : (
              <Link
                aria-label="Search"
                className="context-button reader-icon-button"
                title="Search"
                to="/"
              >
                🔍
              </Link>
            )}
            <PassageJump
              filters={filters}
              initialPassageId={passageJumpInitialPassageId}
              isScriptureReady={isScriptureReady}
              label="Jump"
              launcherVariant="inline"
              onJumpToPassage={(passageId) => {
                setIsReaderToolsOpen(false);
                onJumpToPassage?.(passageId);
              }}
              passages={passages}
            />
            <ReaderSettingsControl
              onChange={setReaderSettings}
              settings={readerSettings}
            />
        </ReaderTools>
      </header>

      <div className="reader-passages">
        {renderedChapterEntries.map(({ chapter, key: currentChapterKey }) => {
          const globalChapterIndex = renderedChapterKeys.indexOf(currentChapterKey);
          const previousChapter = globalChapterIndex > 0
            ? orderedChapterEntries[globalChapterIndex - 1]?.chapter
            : null;
          const isBookBoundary = !previousChapter || previousChapter.book !== chapter.book;
          const bookMetadata = getScriptureBookHeaderMetadata(
            chapter.book,
            chapterCountByBook.get(chapter.book) ?? 0,
            bookMetadataByBook
          );

          return (
            <section
              className={[
                "reader-chapter",
                isBookBoundary ? "is-book-boundary" : ""
              ].filter(Boolean).join(" ")}
              data-chapter-key={currentChapterKey}
              key={currentChapterKey}
            >
              {isBookBoundary ? (
                <ReaderBookHeader
                  description={bookMetadata.description}
                  details={bookMetadata.details}
                  subtitle={bookMetadata.subtitle}
                  title={chapter.book}
                />
              ) : null}
              <h2 className="reader-chapter-heading">
                {chapter.book} {chapter.chapter}
                <span title={TRANSLATION_NAME}>
                  {TRANSLATION_ABBREVIATION} · {TRANSLATION_NAME}
                </span>
              </h2>
              <div className="reader-chapter-passages">
                {chapter.passages.map((passage) => {
                  const isSelected = passage.id === selectedPassageId;

                  return (
                    <ReaderPassageArticle
                      actions={
                        <>
                          <Form action="/?index" method="post">
                            <input
                              type="hidden"
                              name="intent"
                              value="similar-passage"
                            />
                            <input
                              type="hidden"
                              name="targetCorpus"
                              value="scripture"
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
                              {isSearchingSimilar ? (
                                <>
                                  <span className="button-spinner" aria-hidden="true" />
                                  Finding similar
                                </>
                              ) : (
                                "Similar passages"
                              )}
                            </button>
                          </Form>
                          {isSearchingSimilar ? (
                            <p className="reader-action-status" role="status">
                              Searching similar passages...
                            </p>
                          ) : null}
                        </>
                      }
                      dataAttributes={{ "data-passage-id": passage.id }}
                      isSelected={isSelected}
                      key={passage.id}
                      onToggle={() => setSelectedPassageId(isSelected ? "" : passage.id)}
                      reference={passage.reference}
                      text={passage.verses.map((verse, index) => (
                        <span className="reader-verse" key={verse.number}>
                          {verse.text}
                          {index < passage.verses.length - 1 ? " " : ""}
                        </span>
                      ))}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <ReaderCorpusSwitch current="scripture" />
    </section>
  );
}

function getScriptureBookHeaderMetadata(
  book: string,
  chapterCount: number,
  bookMetadataByBook?: Map<string, ReaderBookMetadata>
): Required<ReaderBookMetadata> {
  const metadata = bookMetadataByBook?.get(book);
  const details = metadata?.details?.length
    ? metadata.details
    : [
      { label: "Text", value: "Scripture" },
      { label: "Translation", value: `${TRANSLATION_ABBREVIATION} · ${TRANSLATION_NAME}` },
      { label: "Chapters", value: formatChapterCount(chapterCount) }
    ];

  return {
    description: metadata?.description ?? null,
    details,
    subtitle: metadata?.subtitle ?? `${TRANSLATION_ABBREVIATION} · ${TRANSLATION_NAME}`
  };
}

function formatChapterCount(count: number) {
  return count === 1 ? "1 chapter" : `${count} chapters`;
}

function getInitialRenderedRange(
  initialChapterIndex: number,
  entries: Array<{ chapter: { book: string }; key: string }>
) {
  return getCenteredWindowRange({
    after: INITIAL_NEXT_CHAPTERS,
    before: INITIAL_PREVIOUS_CHAPTERS,
    count: entries.length,
    index: initialChapterIndex
  });
}

function findRenderedPassageElement(passageId: string) {
  return [...document.querySelectorAll<HTMLElement>(".reader-passage")]
    .find((element) => element.dataset.passageId === passageId) ?? null;
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
