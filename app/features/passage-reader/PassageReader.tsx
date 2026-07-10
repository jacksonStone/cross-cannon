import {
  useCallback,
  useMemo,
  useRef,
  useState
} from "react";

import { Form, Link, useNavigation } from "@remix-run/react";

import { PassageJump } from "~/features/passage-jump/PassageJump";
import { useScriptureReaderNavigation } from "~/features/reader-navigation/useScriptureReaderNavigation";
import { ReaderCorpusSwitch } from "~/features/reader-switch/ReaderCorpusSwitch";
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
import type { StoredFilters } from "~/features/search/types";
import type { BrowserPassage } from "~/lib/scripture-cache-contract";

import { ReaderBookHeader, type ReaderBookHeaderDetail } from "./BookHeader";

const TRANSLATION_ABBREVIATION = "WEB";
const TRANSLATION_NAME = "World English Bible";

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
  onOpenSearch,
  onThemeChange,
  passages
}: PassageReaderProps) {
  const navigation = useNavigation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { readerSettings, setReaderSettings } = useStoredReaderSettings({
    onThemeChange
  });
  const [isReaderToolsOpen, setIsReaderToolsOpen] = useState(false);
  const [playingAudioUrl, setPlayingAudioUrl] = useState<string | null>(null);
  const {
    activeChapter,
    chapterCountByBook,
    isInitialChapterReadyToRender,
    passageJumpInitialPassageId,
    renderedChapterEntries,
    selectedPassageId,
    toggleSelectedPassage
  } = useScriptureReaderNavigation({
    filters,
    initialPassageId,
    isReady: isScriptureReady,
    onChapterChange,
    passages
  });
  const activeAudioUrl = activeChapter?.audioUrl ?? null;
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
              passages={passages}
            />
            <ReaderSettingsControl
              onChange={setReaderSettings}
              settings={readerSettings}
            />
        </ReaderTools>
      </header>

      <div className="reader-passages">
        {renderedChapterEntries.map(({
          chapter,
          isBookBoundary,
          key: currentChapterKey
        }) => {
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
                      onToggle={() => toggleSelectedPassage(passage.id)}
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
