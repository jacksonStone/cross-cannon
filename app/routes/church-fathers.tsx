import {
  type FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from "react";

import type { MetaFunction } from "@remix-run/node";
import { Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";

import {
  type EarlyChristianReaderTextMode as ReaderTextMode,
  findLoadedPassage
} from "~/features/early-christian-reader/reader-passages";
import {
  ReaderCorpusSwitch,
  rememberReaderCorpus
} from "~/features/reader-switch/ReaderCorpusSwitch";
import {
  EARLY_CHRISTIAN_MANIFEST_URL,
  EARLY_CHRISTIAN_PREVIEW_ASSET_VERSION,
  EARLY_CHRISTIAN_READER_POSITION_STORAGE_KEY
} from "~/features/early-christian-preview/preview-cache";
import { useOfflineStatus } from "~/features/offline/OfflineProvider";
import { useEarlyChristianWorkDownloads } from "~/features/offline/early-christian-work-downloads";
import {
  SEARCH_EXAMPLES
} from "~/features/early-christian-reader/book-index";
import { ChapterList } from "~/features/early-christian-reader/ChapterList";
import { ChapterJump } from "~/features/early-christian-reader/ChapterJump";
import {
  churchFathersAction,
  churchFathersLoader
} from "~/features/early-christian-reader/route.server";
import { EarlyChristianReaderHeader } from "~/features/early-christian-reader/ReaderHeader";
import { SearchDialog } from "~/features/early-christian-reader/SearchDialog";
import { useEarlyChristianAudioPlayback } from "~/features/early-christian-reader/useEarlyChristianAudioPlayback";
import {
  useEarlyChristianBookIndex,
  useEarlyChristianChapterAssets,
  useRenderedChapterAssetLoader
} from "~/features/early-christian-reader/useEarlyChristianReaderAssets";
import {
  useEarlyChristianReaderNavigation
} from "~/features/early-christian-reader/useEarlyChristianReaderNavigation";
import { BOOKS_BY_CANON } from "~/features/search/canons";
import {
  readerSettingsStyle
} from "~/features/reader-settings/reader-settings";
import { fitSingleLineText } from "~/features/reader-ui/fit-single-line-text";
import { useStoredReaderSettings } from "~/features/reader-ui/ReaderControls";
import {
  initialSearchModalFlowState,
  searchModalFlowReducer
} from "~/features/search/search-modal-flow";
import { useSearchDialogState } from "~/features/search/useSearchDialogState";
import { useScriptureLibrary } from "~/features/scripture/useScriptureLibrary";
import {
  type EarlyChristianSearchResult,
} from "~/lib/early-christian-search.server";
import {
  useEscapeDismiss
} from "~/lib/use-dialog-dismiss";
import { useModalScrollLock } from "~/lib/use-modal-scroll-lock";

const MANIFEST_URL = EARLY_CHRISTIAN_MANIFEST_URL;
const PREVIEW_ASSET_VERSION = EARLY_CHRISTIAN_PREVIEW_ASSET_VERSION;
const READER_POSITION_STORAGE_KEY = EARLY_CHRISTIAN_READER_POSITION_STORAGE_KEY;
const SCRIPTURE_BOOKS = Array.from(BOOKS_BY_CANON.orthodox);
const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export const meta: MetaFunction = () => [
  { title: "Early Christian Reader | Cross Canon" },
  {
    name: "description",
    content: "Read and search early Christian works in chapter context."
  }
];

export const loader = churchFathersLoader;
export const action = churchFathersAction;

export default function ChurchFathersReaderRoute() {
  const {
    authorOptions,
    initialChapterId,
    initialPassageRange,
    manifestUrl,
    previewAssetVersion,
    scriptureCacheKey,
    scriptureCacheUrl
  } = useLoaderData<typeof loader>();
  const [readerLinkChapterId, setReaderLinkChapterId] = useState(initialChapterId);
  const [readerLinkPassageRange, setReaderLinkPassageRange] = useState(initialPassageRange);
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { bookIndex, loadError } = useEarlyChristianBookIndex({
    manifestUrl,
    previewAssetVersion
  });
  const { isOffline } = useOfflineStatus();
  const {
    availableOfflineWorkId,
    cancelDownload,
    downloadState,
    downloadWork,
    downloadedWorkIds,
    hasValidatedRecords,
    removeWork
  } = useEarlyChristianWorkDownloads({
    bookIndex,
    isOffline,
    previewAssetVersion
  });
  const readerBookIndex = useMemo(() => {
    if (!bookIndex || !isOffline || !hasValidatedRecords) {
      return bookIndex;
    }

    return {
      ...bookIndex,
      books: bookIndex.books.filter((book) => downloadedWorkIds.has(book.id))
    };
  }, [bookIndex, downloadedWorkIds, hasValidatedRecords, isOffline]);
  const {
    chapterLoadErrors,
    loadedChapters,
    setChapterLoadErrors,
    setLoadedChapters
  } = useEarlyChristianChapterAssets(previewAssetVersion);
  const [searchFlow, dispatchSearchFlow] = useReducer(
    searchModalFlowReducer,
    initialSearchModalFlowState
  );
  const { readerSettings, setReaderSettings } = useStoredReaderSettings();
  const readerTheme = readerSettings.theme;
  const readerStyles = readerSettingsStyle(readerSettings);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [isJumpOpen, setIsJumpOpen] = useState(false);
  const [readerTextMode, setReaderTextMode] = useState<ReaderTextMode>("modernized");
  const [exampleIndex, setExampleIndex] = useState(0);
  const headerTitleRef = useRef<HTMLDivElement | null>(null);
  const isToolsOpenRef = useRef(isToolsOpen);
  const networkActionAttemptedRef = useRef(false);
  const readerTitleRef = useRef<HTMLHeadingElement | null>(null);

  const scriptureLibrary = useScriptureLibrary({
    scriptureCacheUrl
  });
  const {
    activeChapterIndex,
    activeEntry,
    chapters,
    isReady,
    openChapter,
    renderedEntries,
    resolvedActiveChapterId,
    selectPassage,
    selectedPassage,
    selectedPassageChapterId
  } = useEarlyChristianReaderNavigation({
    bookIndex: readerBookIndex,
    initialChapterId: readerLinkChapterId,
    initialPassageRange: readerLinkPassageRange,
    loadedChapters,
    positionStorageKey: READER_POSITION_STORAGE_KEY
  });
  const focusedPassageKey = searchFlow.focusedId;
  const isSearchOpen = searchFlow.isOpen;
  const openSearch = useCallback(() => dispatchSearchFlow({ type: "open" }), []);
  const setFocusedPassageKey = useCallback((focusedId: string | null) => {
    dispatchSearchFlow({
      focusedId,
      type: "set-focused"
    });
  }, []);
  const focusedPassage = focusedPassageKey
    ? findLoadedPassage(loadedChapters, focusedPassageKey, readerTextMode)
    : null;
  const activeChapterHasModernizedText = Boolean(
    resolvedActiveChapterId
    && loadedChapters.get(resolvedActiveChapterId)?.verses.some((verse) => (
      Boolean(verse.modernizedText?.trim())
    ))
  );
  const isSearching = navigation.state === "submitting";
  const isFindingSimilarFathers = isSearching
    && navigation.formData?.get("intent") === "similar-passage";
  const activeHeaderTitle = activeEntry
    ? `${activeEntry.book.name} ${activeEntry.chapter.chapter}`
    : "";
  const filterActionData = useMemo(() => ({
    books: actionData?.books,
    canon: actionData?.canon,
    earlyChristianAuthors: actionData?.authors,
    matchCount: actionData?.matchCount,
    mode: actionData?.mode,
    targetCorpus: actionData?.targetCorpus
  }), [
    actionData?.authors,
    actionData?.books,
    actionData?.canon,
    actionData?.matchCount,
    actionData?.mode,
    actionData?.targetCorpus
  ]);
  const searchDialog = useSearchDialogState({
    actionData: filterActionData,
    books: SCRIPTURE_BOOKS,
    earlyChristianAuthors: authorOptions,
    focusedPassageId: focusedPassageKey,
    persistFilters: false,
    readerCorpus: "early-christian"
  });
  const selectedAuthorFilters = searchDialog.selectedEarlyChristianAuthors;
  const closeSearchFilters = searchDialog.closeFilters;
  const closeSearch = useCallback(() => {
    closeSearchFilters();
    dispatchSearchFlow({ type: "close" });
  }, [closeSearchFilters]);
  const handleNetworkDependentSubmit = useCallback((event: FormEvent<HTMLElement>) => {
    if (isOffline) {
      event.preventDefault();
      closeSearch();
      setIsJumpOpen(false);
      return;
    }

    networkActionAttemptedRef.current = true;
  }, [closeSearch, isOffline]);
  useModalScrollLock(isSearchOpen || isJumpOpen || searchDialog.isFilterOpen);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const requestedChapterId = searchParams.get("chapter") ?? "";

    setReaderLinkChapterId(requestedChapterId);
    setReaderLinkPassageRange(
      requestedChapterId ? searchParams.get("passage") ?? "" : ""
    );
  }, [initialChapterId, initialPassageRange]);

  useEffect(() => {
    if (!isOffline || !networkActionAttemptedRef.current) {
      return;
    }

    networkActionAttemptedRef.current = false;
    closeSearch();
    setIsJumpOpen(false);
  }, [closeSearch, isOffline]);
  useRenderedChapterAssetLoader({
    activeChapterIndex,
    bookIndex: readerBookIndex,
    chapterLoadErrors,
    loadedChapters,
    previewAssetVersion,
    renderedEntries,
    setChapterLoadErrors,
    setLoadedChapters
  });
  const {
    activeAudio,
    activeAudioUrl,
    audioRef,
    handleAudioEnded,
    handleAudioPause,
    handleAudioTimeUpdate,
    isActiveChapterPlaying,
    toggleActiveChapterAudio
  } = useEarlyChristianAudioPlayback({
    activeChapterIndex,
    activeEntry,
    chapters,
    onOpenChapter: openChapter,
    resolvedActiveChapterId
  });

  useEffect(() => {
    rememberReaderCorpus("fathers");
  }, []);

  useBrowserLayoutEffect(() => {
    isToolsOpenRef.current = isToolsOpen;
  }, [isToolsOpen]);

  useBrowserLayoutEffect(() => {
    const container = headerTitleRef.current;
    const title = readerTitleRef.current;

    if (!container || !title || isToolsOpen) {
      return;
    }

    let frameId = 0;
    let didCancel = false;
    const fitTitle = () => {
      if (didCancel || isToolsOpenRef.current) {
        return;
      }

      title.style.fontSize = "";

      const availableWidth = container.clientWidth;

      if (availableWidth <= 0) {
        return;
      }

      const baseFontSize = Number.parseFloat(window.getComputedStyle(title).fontSize);

      fitSingleLineText({
        availableWidth,
        baseFontSize,
        measureWidth: () => title.scrollWidth,
        setFontSize: (fontSize) => {
          title.style.fontSize = `${fontSize}px`;
        }
      });
    };
    const scheduleFit = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(fitTitle);
    };
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleFit);

    scheduleFit();
    resizeObserver?.observe(container);
    window.addEventListener("resize", scheduleFit);
    void document.fonts?.ready.then(scheduleFit).catch(() => undefined);

    return () => {
      didCancel = true;
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleFit);
    };
  }, [activeHeaderTitle, isToolsOpen]);

  useEscapeDismiss({
    isOpen: isSearchOpen,
    onDismiss: closeSearch
  });

  useEffect(() => {
    const interval = window.setInterval(() => {
      setExampleIndex((index) => (index + 1) % SEARCH_EXAMPLES.length);
    }, 2800);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (
      navigation.state === "submitting"
      && navigation.formData?.get("intent") === "similar-passage"
    ) {
      dispatchSearchFlow({
        focusedId: String(navigation.formData.get("sourcePassageId") ?? ""),
        type: "submitting-similar"
      });
    }
  }, [navigation.formData, navigation.state]);

  useEffect(() => {
    if (actionData?.mode === "similar" && actionData.similarSource) {
      dispatchSearchFlow({
        focusedId: actionData.similarSource.id,
        type: "similar-results"
      });
      return;
    }

    if (actionData?.mode === "similar-scripture" && actionData.similarScriptureSource) {
      dispatchSearchFlow({
        focusedId: actionData.similarScriptureSource.id,
        type: "similar-results"
      });
      return;
    }

    if (actionData?.mode === "theme") {
      dispatchSearchFlow({ type: "theme-results" });
    }
  }, [
    actionData?.mode,
    actionData?.similarScriptureSource?.id,
    actionData?.similarSource?.id
  ]);

  const openResult = useCallback((result: EarlyChristianSearchResult) => {
    const passageRange = rangeFromResult(result);

    if (openChapter(result.chapterId, passageRange)) {
      closeSearch();
    }
  }, [closeSearch, openChapter]);

  if (loadError) {
    return (
      <main className={`reader-shell reader-theme-${readerTheme}`}>
        <section className="reader-empty" role="alert">
          <p>Early Christian reader unavailable: {loadError}</p>
        </section>
        <ReaderCorpusSwitch current="fathers" />
      </main>
    );
  }

  if (isOffline && hasValidatedRecords && readerBookIndex && readerBookIndex.books.length === 0) {
    return (
      <main className={`reader-shell reader-theme-${readerTheme}`}>
        <section className="reader-empty" role="status">
          <p>No Early Christian works are available offline.</p>
          <ReaderCorpusSwitch current="fathers" />
        </section>
      </main>
    );
  }

  if (
    isOffline
    && readerLinkChapterId
    && hasValidatedRecords
    && !chapters.some((entry) => entry.chapter.id === readerLinkChapterId)
  ) {
    return (
      <main className={`reader-shell reader-theme-${readerTheme}`}>
        <section className="reader-empty" role="status">
          <p>This work isn’t available offline.</p>
          <Link className="context-button" reloadDocument to="/church-fathers">
            Open downloaded works
          </Link>
          <ReaderCorpusSwitch current="fathers" />
        </section>
      </main>
    );
  }

  if (!bookIndex || !activeEntry) {
    return (
      <main className={`reader-shell reader-theme-${readerTheme}`}>
        <section
          aria-busy="true"
          aria-labelledby="reader-loading-title"
          className={`reader-page reader-theme-${readerTheme} reader-loading`}
          style={readerStyles}
        >
          <header className="reader-header reader-loading-header">
            <div className="reader-header-title">
              <h1 id="reader-loading-title">Loading Early Christian Reader</h1>
            </div>
            <div className="reader-loading-meter" aria-hidden="true">
              <span />
            </div>
          </header>
        </section>
        <ReaderCorpusSwitch current="fathers" />
      </main>
    );
  }

  return (
    <main
      className={`reader-shell reader-theme-${readerTheme}`}
      onSubmitCapture={handleNetworkDependentSubmit}
    >
      <data value={scriptureCacheKey} data-scripture-cache-key hidden />
      <section
        aria-labelledby="reader-title"
        className={`reader-page reader-theme-${readerTheme}`}
        style={readerStyles}
      >
        <EarlyChristianReaderHeader
          activeAudio={activeAudio}
          activeAudioUrl={activeAudioUrl}
          activeHeaderTitle={activeHeaderTitle}
          activeWork={activeEntry.book}
          availableOfflineWorkId={availableOfflineWorkId}
          audioRef={audioRef}
          headerTitleRef={headerTitleRef}
          isActiveChapterPlaying={isActiveChapterPlaying}
          isToolsOpen={isToolsOpen}
          onAudioEnded={handleAudioEnded}
          onAudioPause={handleAudioPause}
          onAudioTimeUpdate={handleAudioTimeUpdate}
          onCloseTools={() => {
            setIsToolsOpen(false);
            setIsJumpOpen(false);
          }}
          onCancelDownload={cancelDownload}
          onDownloadWork={() => downloadWork(activeEntry.book)}
          onOpenJump={() => {
            setIsToolsOpen(false);
            setIsJumpOpen(true);
          }}
          onOpenSearch={() => {
            setIsToolsOpen(false);
            openSearch();
          }}
          onOpenTools={() => setIsToolsOpen(true)}
          onRemoveDownload={() => {
            if (!window.confirm(`Remove ${activeEntry.book.name} from offline reading?`)) {
              return;
            }

            void removeWork(activeEntry.book.id).then(() => {
              window.location.assign("/?reader=scripture");
            });
          }}
          readerSettings={readerSettings}
          readerTitleRef={readerTitleRef}
          setReaderSettings={setReaderSettings}
          toggleActiveChapterAudio={toggleActiveChapterAudio}
          downloadState={downloadState}
          isWorkDownloaded={downloadedWorkIds.has(activeEntry.book.id)}
        />

        <ChapterList
          chapterLoadErrors={chapterLoadErrors}
          chapters={chapters}
          isFindingSimilarFathers={isFindingSimilarFathers}
          isSearching={isSearching}
          loadedChapters={loadedChapters}
          readerTextMode={readerTextMode}
          renderedEntries={renderedEntries}
          selectedAuthorFilters={selectedAuthorFilters}
          selectedPassage={selectedPassage}
          selectedPassageChapterId={selectedPassageChapterId}
          setChapterLoadErrors={setChapterLoadErrors}
          onSelectPassage={selectPassage}
        />
        {activeChapterHasModernizedText ? (
          <div className="reader-text-toggle" aria-label="Text version">
            {(["modernized", "original"] as const).map((mode) => (
              <button
                aria-pressed={readerTextMode === mode}
                className={readerTextMode === mode ? "is-active" : ""}
                key={mode}
                onClick={() => setReaderTextMode(mode)}
                title={mode === "modernized" ? "Show modernized text" : "Show original translation"}
                type="button"
              >
                {mode === "modernized" ? "Mod" : "Orig"}
              </button>
            ))}
          </div>
        ) : null}
        <ReaderCorpusSwitch current="fathers" />
      </section>

      {isSearchOpen ? (
        <SearchDialog
          actionData={actionData}
          authorOptions={authorOptions}
          closeSearch={closeSearch}
          dialogState={searchDialog}
          examplePlaceholder={SEARCH_EXAMPLES[exampleIndex]}
          focusedPassage={focusedPassage}
          focusedPassageKey={focusedPassageKey}
          isReady={isReady}
          isSearching={isSearching}
          onOpenResult={openResult}
          onSetFocusedPassageKey={setFocusedPassageKey}
          passageLookup={scriptureLibrary.passageLookup}
          readerTheme={readerTheme}
        />
      ) : null}

      {isJumpOpen ? (
        <ChapterJump
          activeChapterId={activeEntry.chapter.id}
          chapters={chapters}
          downloadedWorkIds={downloadedWorkIds}
          onClose={() => setIsJumpOpen(false)}
          onJump={(chapterId) => {
            setIsJumpOpen(false);
            openChapter(chapterId);
          }}
        />
      ) : null}
    </main>
  );
}

function rangeFromResult(result: EarlyChristianSearchResult) {
  const start = result.highlightPassage.verseStart;
  const end = result.highlightPassage.verseEnd;

  if (!start) {
    return "";
  }

  return end && end !== start ? `${start}-${end}` : String(start);
}
