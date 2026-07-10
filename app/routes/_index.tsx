import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from "react";

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useActionData,
  useLoaderData,
  useNavigation
} from "@remix-run/react";

import { PassageReader } from "~/features/passage-reader/PassageReader";
import { useOfflineStatus } from "~/features/offline/OfflineProvider";
import { buildEarlyChristianReaderUrl } from "~/features/reader-navigation/reader-links";
import { rememberReaderCorpus } from "~/features/reader-switch/ReaderCorpusSwitch";
import { SearchForm } from "~/features/search/SearchForm";
import { SearchResults } from "~/features/search/SearchResults";
import {
  getIndexedBooks,
  handleSearchRequest
} from "~/features/search/search-request.server";
import {
  initialSearchModalFlowState,
  searchModalFlowReducer
} from "~/features/search/search-modal-flow";
import type { SearchActionData } from "~/features/search/types";
import { useScriptureLibrary } from "~/features/scripture/useScriptureLibrary";
import {
  getEarlyChristianAuthors,
  type EarlyChristianSearchResult
} from "~/lib/early-christian-search.server";
import { getClientIp, rateLimit } from "~/lib/rate-limit.server";
import {
  getScriptureCacheInfo
} from "~/lib/scripture-cache.server";
import {
  isBackdropClick,
  useEscapeDismiss
} from "~/lib/use-dialog-dismiss";
import { useModalScrollLock } from "~/lib/use-modal-scroll-lock";

import {
  buildChapterIndex,
  findDefaultReaderPassageId,
  findFirstPassageIdForChapter,
  getPassageChapterKey
} from "~/features/passage-reader/chapter-index";
import {
  createReaderLocation,
  readReaderLocation,
  readReaderPosition,
  readerLocationKey,
  rememberReaderLocation
} from "~/features/reader-position/reader-position";
import {
  type ReaderTheme,
  isReaderTheme,
  readSavedReaderTheme
} from "~/features/reader-settings/reader-settings";

const READER_POSITION_STORAGE_KEY = "cross-cannon:reader-position:v1";

export async function loader({}: LoaderFunctionArgs) {
  const earlyChristianAuthorsPromise: Promise<string[]> = getEarlyChristianAuthors()
    .catch(() => []);
  const [books, earlyChristianAuthors, scriptureCache] = await Promise.all([
    getIndexedBooks(),
    earlyChristianAuthorsPromise,
    getScriptureCacheInfo()
  ]);

  return json({
    books,
    earlyChristianAuthors,
    scriptureCacheKey: scriptureCache.version,
    scriptureCacheUrl: scriptureCache.url
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const ip = getClientIp(request);
  const limit = rateLimit(ip);

  if (!limit.allowed) {
    return json<SearchActionData>(
      {
        error: "Rate limit reached. Try again in a moment.",
        retryAfterSeconds: limit.retryAfterSeconds
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(limit.retryAfterSeconds)
        }
      }
    );
  }

  return handleSearchRequest(await request.formData());
}

export default function Index() {
  const { books, earlyChristianAuthors, scriptureCacheKey, scriptureCacheUrl } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { isOffline } = useOfflineStatus();
  const [searchFlow, dispatchSearchFlow] = useReducer(
    searchModalFlowReducer,
    initialSearchModalFlowState
  );
  const savedReaderLocation = readReaderLocation(READER_POSITION_STORAGE_KEY, "scripture");
  const savedReaderPositionRef = useRef(readerLocationKey(savedReaderLocation));
  const [readerPassageId, setReaderPassageId] = useState("");
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>("paper");
  const lastVisibleChapterKeyRef = useRef(savedReaderPositionRef.current);
  const networkActionAttemptedRef = useRef(false);
  const scriptureLibrary = useScriptureLibrary({
    scriptureCacheUrl
  });
  const scriptureIndex = useMemo(
    () => buildChapterIndex(scriptureLibrary.passages),
    [scriptureLibrary.passages]
  );
  const focusedPassageId = searchFlow.focusedId;
  const isSearchOpen = searchFlow.isOpen;
  const closeSearch = useCallback(() => dispatchSearchFlow({ type: "close" }), []);
  const openSearch = useCallback(() => dispatchSearchFlow({ type: "open" }), []);
  const setFocusedPassageId = useCallback((focusedId: string | null) => {
    dispatchSearchFlow({
      focusedId,
      type: "set-focused"
    });
  }, []);
  const handleNetworkDependentSubmit = useCallback((event: FormEvent<HTMLElement>) => {
    if (isOffline) {
      event.preventDefault();
      closeSearch();
      return;
    }

    networkActionAttemptedRef.current = true;
  }, [closeSearch, isOffline]);

  useModalScrollLock(isSearchOpen);

  useEffect(() => {
    if (!isOffline || !networkActionAttemptedRef.current) {
      return;
    }

    networkActionAttemptedRef.current = false;
    closeSearch();
  }, [closeSearch, isOffline]);

  useEffect(() => {
    setReaderTheme(readSavedReaderTheme());
  }, []);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);

    if (searchParams.get("reader") === "scripture") {
      rememberReaderCorpus("scripture");
      searchParams.delete("reader");
      const nextSearch = searchParams.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`
      );
      return;
    }

    rememberReaderCorpus("scripture");
  }, []);

  useEffect(() => {
    if (!scriptureLibrary.isReady) {
      return;
    }

    if (
      readerPassageId
      && scriptureLibrary.passageLookup.has(readerPassageId)
    ) {
      return;
    }

    const initialPassageId =
      findFirstPassageIdForChapter(
        scriptureIndex,
        savedReaderLocation?.chapterKey ?? readReaderPosition(READER_POSITION_STORAGE_KEY)
      ) ?? findDefaultReaderPassageId(scriptureIndex);

    if (!initialPassageId) {
      return;
    }

    const initialChapterKey = getPassageChapterKey(
      scriptureIndex,
      initialPassageId
    );

    if (initialChapterKey) {
      rememberReaderLocation(READER_POSITION_STORAGE_KEY, createReaderLocation({
        chapterKey: initialChapterKey,
        corpus: "scripture"
      }), {
        lastReportedRef: lastVisibleChapterKeyRef,
        savedRef: savedReaderPositionRef
      });
    }

    setReaderPassageId(initialPassageId);
  }, [
    readerPassageId,
    scriptureLibrary.isReady,
    scriptureLibrary.passageLookup,
    scriptureLibrary.passages,
    scriptureIndex
  ]);

  useEffect(() => {
    if (
      navigation.state === "submitting"
      && (
        navigation.formData?.get("intent") === "similar-passage"
        || navigation.formData?.get("intent") === "similar-early-christian"
      )
    ) {
      const sourcePassageId = String(navigation.formData.get("sourcePassageId") ?? "");

      if (sourcePassageId) {
        dispatchSearchFlow({
          focusedId: sourcePassageId,
          type: "submitting-similar"
        });
      }
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

    if (actionData?.mode === "similar-early-christian" && actionData.similarSource) {
      dispatchSearchFlow({
        focusedId: actionData.similarSource.id,
        type: "similar-results"
      });
      return;
    }

    if (actionData?.mode === "theme") {
      dispatchSearchFlow({ type: "theme-results" });
      return;
    }

    if (actionData?.mode === "theme-early-christian") {
      dispatchSearchFlow({ type: "theme-results" });
    }
  }, [actionData?.mode, actionData?.similarSource?.id]);

  useEscapeDismiss({
    isOpen: isSearchOpen,
    onDismiss: closeSearch
  });

  const rememberReaderChapter = useCallback((chapterKeyValue: string) => {
    rememberReaderLocation(READER_POSITION_STORAGE_KEY, createReaderLocation({
      chapterKey: chapterKeyValue,
      corpus: "scripture"
    }), {
      lastReportedRef: lastVisibleChapterKeyRef,
      savedRef: savedReaderPositionRef
    });
  }, []);

  const updateReaderTheme = useCallback((theme: string) => {
    if (isReaderTheme(theme)) {
      setReaderTheme(theme);
    }
  }, []);

  return (
    <main
      className={`reader-shell reader-theme-${readerTheme}`}
      onSubmitCapture={handleNetworkDependentSubmit}
    >
      <data value={scriptureCacheKey} data-scripture-cache-key hidden />
      <PassageReader
        filters={{}}
        initialPassageId={readerPassageId}
        isScriptureReady={scriptureLibrary.isReady && Boolean(readerPassageId)}
        onChapterChange={rememberReaderChapter}
        onOpenSearch={openSearch}
        onThemeChange={updateReaderTheme}
        passages={scriptureLibrary.passages}
      />

      {isSearchOpen ? (
        <div
          className={`search-modal-backdrop reader-theme-${readerTheme}`}
          onClick={(event) => {
            event.stopPropagation();

            if (isBackdropClick(event)) {
              closeSearch();
            }
          }}
        >
          <section
            aria-labelledby="search-modal-title"
            aria-modal="true"
            className="search-modal"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="search-modal-header">
              <div>
                <p className="eyebrow">Search</p>
                <h2 id="search-modal-title">Find passages</h2>
              </div>
              <button
                className="filter-modal-close"
                onClick={closeSearch}
                type="button"
              >
                Close
              </button>
            </header>

            <div className="search-modal-body">
              <SearchForm
                actionData={actionData}
                books={books}
                earlyChristianAuthors={earlyChristianAuthors}
                focusedPassageId={focusedPassageId}
                isScriptureReady={scriptureLibrary.isReady}
                jumpInitialPassageId={readerPassageId}
                onFocusedPassageChange={setFocusedPassageId}
                passageLookup={scriptureLibrary.passageLookup}
                passages={scriptureLibrary.passages}
              />

              {actionData?.error ? (
                <p className="notice" role="alert">
                  {actionData.error}
                  {actionData.retryAfterSeconds
                    ? ` ${actionData.retryAfterSeconds} seconds remaining.`
                    : ""}
                </p>
              ) : null}

              <SearchResults
                actionData={actionData}
                contextActionLabel="Jump to"
                crossCorpusAction={{
                  intent: "similar-early-christian",
                  label: "Similar in Fathers",
                  pendingLabel: "Finding Fathers"
                }}
                focusedPassageId={focusedPassageId}
                passageLookup={scriptureLibrary.passageLookup}
                results={actionData?.results}
                showEmptyState={
                  actionData?.mode !== "similar-early-christian"
                  && actionData?.mode !== "theme-early-christian"
                }
              />

              <EarlyChristianCrossResults
                heading={actionData?.mode === "theme-early-christian"
                  ? "Early Christian results"
                  : "Similar early Christian passages"}
                results={actionData?.earlyChristianResults}
              />
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function EarlyChristianCrossResults({
  heading,
  results
}: {
  heading: string;
  results?: EarlyChristianSearchResult[];
}) {
  const [selectedResult, setSelectedResult] = useState("");

  useEffect(() => {
    setSelectedResult("");
  }, [results]);

  if (!results?.length) {
    return null;
  }

  return (
    <section className="results ec-results" aria-live="polite">
      <h2 className="results-heading">{heading}</h2>
      {results.map((result, index) => {
        const isSelected = selectedResult === result.highlightPassage.id;

        return (
          <article
            className={[
              "scripture-result",
              `match-level-${result.matchStrength}`,
              isSelected ? "is-selected" : ""
            ].filter(Boolean).join(" ")}
            key={`${result.highlightPassage.id}-${index}`}
          >
            <button
              aria-expanded={isSelected}
              className="scripture-result-button"
              onClick={() => setSelectedResult(isSelected ? "" : result.highlightPassage.id)}
              type="button"
            >
              <span className="result-meta">
                <span>{result.chapterReference}</span>
                <span>{result.author ?? result.source.toUpperCase()}</span>
                <span
                  aria-label={`${result.matchStrength} of 4 match strength`}
                  className="match-strength"
                  title={`${result.matchStrength} of 4 match strength`}
                >
                  <span className="match-strength-label" aria-hidden="true">
                    Match strength
                  </span>
                  <span className="match-dots" aria-hidden="true">
                    {[1, 2, 3, 4].map((level) => (
                      <span
                        className={level <= result.matchStrength ? "is-active" : undefined}
                        key={level}
                      />
                    ))}
                  </span>
                </span>
              </span>
              <span className="scripture-result-text">
                {result.highlightPassage.rangeLabel ? (
                  <>
                    <span className="result-range-label">
                      {result.highlightPassage.rangeLabel}.
                    </span>{" "}
                  </>
                ) : null}
                {result.highlightPassage.text}
              </span>
            </button>
            {isSelected ? (
              <div className="result-actions">
                <a
                  className="context-button"
                  href={buildEarlyChristianReaderUrl(
                    result.chapterId,
                    result.highlightPassage.rangeLabel ?? ""
                  )}
                >
                  Jump to
                </a>
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
