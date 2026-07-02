import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useActionData,
  useLoaderData,
  useNavigation
} from "@remix-run/react";

import { PassageReader } from "~/features/passage-reader/PassageReader";
import { rememberReaderCorpus } from "~/features/reader-switch/ReaderCorpusSwitch";
import { SearchForm } from "~/features/search/SearchForm";
import { SearchResults } from "~/features/search/SearchResults";
import { getIndexedBooks, handleSearchRequest } from "~/features/search/search.server";
import {
  initialSearchModalFlowState,
  searchModalFlowReducer
} from "~/features/search/search-modal-flow";
import type { SearchActionData } from "~/features/search/types";
import { useScriptureLibrary } from "~/features/scripture/useScriptureLibrary";
import type { EarlyChristianSearchResult } from "~/lib/early-christian-search.server";
import { getClientIp, rateLimit } from "~/lib/rate-limit.server";
import {
  getScriptureCacheInfo,
  type BrowserPassage
} from "~/lib/scripture-cache.server";
import {
  isBackdropClick,
  useEscapeDismiss
} from "~/lib/use-dialog-dismiss";
import { useModalScrollLock } from "~/lib/use-modal-scroll-lock";

const READER_POSITION_STORAGE_KEY = "cross-cannon:reader-position:v1";
const READER_SETTINGS_STORAGE_KEY = "cross-cannon:reader-settings:v1";
const READER_THEMES = ["paper", "sepia", "dark", "contrast"] as const;

type ReaderTheme = typeof READER_THEMES[number];

export async function loader({}: LoaderFunctionArgs) {
  const [books, scriptureCache] = await Promise.all([
    getIndexedBooks(),
    getScriptureCacheInfo()
  ]);

  return json({
    books,
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
  const { books, scriptureCacheKey, scriptureCacheUrl } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchFlow, dispatchSearchFlow] = useReducer(
    searchModalFlowReducer,
    initialSearchModalFlowState
  );
  const [readerPassageId, setReaderPassageId] = useState("");
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>("paper");
  const savedReaderPassageId = useMemo(() => {
    if (typeof window === "undefined") {
      return null;
    }

    return window.localStorage.getItem(READER_POSITION_STORAGE_KEY);
  }, []);
  const lastVisiblePassageIdRef = useRef("");
  const scriptureLibrary = useScriptureLibrary({
    scriptureCacheUrl
  });
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

  useModalScrollLock(isSearchOpen);

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
    if (!("scrollRestoration" in window.history)) {
      return;
    }

    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
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

    const rememberedPassage =
      savedReaderPassageId
        ? scriptureLibrary.passageLookup.get(savedReaderPassageId)
        : null;
    const initialPassageId =
      rememberedPassage?.id ?? findDefaultReaderPassageId(scriptureLibrary.passages);

    if (!initialPassageId) {
      return;
    }

    setReaderPassageId(initialPassageId);
    lastVisiblePassageIdRef.current = initialPassageId;
  }, [
    readerPassageId,
    savedReaderPassageId,
    scriptureLibrary.isReady,
    scriptureLibrary.passageLookup,
    scriptureLibrary.passages
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
    }
  }, [actionData?.mode, actionData?.similarSource?.id]);

  useEscapeDismiss({
    isOpen: isSearchOpen,
    onDismiss: closeSearch
  });

  const rememberReaderLocation = useCallback((passageId: string) => {
    if (lastVisiblePassageIdRef.current === passageId) {
      return;
    }

    lastVisiblePassageIdRef.current = passageId;
    window.localStorage.setItem(READER_POSITION_STORAGE_KEY, passageId);
  }, []);

  const jumpToReaderPassage = useCallback((passageId: string) => {
    setReaderPassageId(passageId);
    rememberReaderLocation(passageId);
    dispatchSearchFlow({ type: "close" });
  }, [rememberReaderLocation]);

  const updateReaderTheme = useCallback((theme: string) => {
    if (isReaderTheme(theme)) {
      setReaderTheme(theme);
    }
  }, []);

  return (
    <main className={`reader-shell reader-theme-${readerTheme}`}>
      <data value={scriptureCacheKey} data-scripture-cache-key hidden />
      <PassageReader
        filters={{}}
        initialPassageId={readerPassageId}
        isScriptureReady={scriptureLibrary.isReady && Boolean(readerPassageId)}
        onJumpToPassage={jumpToReaderPassage}
        onLocationChange={rememberReaderLocation}
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
                focusedPassageId={focusedPassageId}
                isScriptureReady={scriptureLibrary.isReady}
                jumpInitialPassageId={readerPassageId}
                onFocusedPassageChange={setFocusedPassageId}
                onJumpToPassage={jumpToReaderPassage}
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
                onJumpToPassage={jumpToReaderPassage}
                passageLookup={scriptureLibrary.passageLookup}
                results={actionData?.results}
                showEmptyState={actionData?.mode !== "similar-early-christian"}
              />

              <EarlyChristianCrossResults
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
  results
}: {
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
      <h2 className="results-heading">Similar early Christian passages</h2>
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
                  className="match-dots"
                  title={`${result.matchStrength} of 4 match strength`}
                >
                  {[1, 2, 3, 4].map((level) => (
                    <span
                      aria-hidden="true"
                      className={level <= result.matchStrength ? "is-active" : undefined}
                      key={level}
                    />
                  ))}
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
                  href={buildChurchFathersUrl(result)}
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

function buildChurchFathersUrl(result: EarlyChristianSearchResult) {
  const searchParams = new URLSearchParams();
  searchParams.set("chapter", result.chapterId);

  if (result.highlightPassage.rangeLabel) {
    searchParams.set("passage", result.highlightPassage.rangeLabel);
  }

  return `/church-fathers?${searchParams.toString()}`;
}

function findDefaultReaderPassageId(passages: BrowserPassage[]) {
  return passages.find((passage) => passage.reference === "Genesis 1:1-5")?.id
    ?? passages.find((passage) => passage.reference.startsWith("Genesis 1:"))?.id
    ?? passages[0]?.id
    ?? "";
}

function readSavedReaderTheme(): ReaderTheme {
  if (typeof window === "undefined") {
    return "paper";
  }

  try {
    const savedSettings = window.localStorage.getItem(READER_SETTINGS_STORAGE_KEY);

    if (!savedSettings) {
      return "paper";
    }

    const parsedSettings = JSON.parse(savedSettings) as { theme?: unknown };
    return isReaderTheme(parsedSettings.theme) ? parsedSettings.theme : "paper";
  } catch {
    return "paper";
  }
}

function isReaderTheme(value: unknown): value is ReaderTheme {
  return typeof value === "string" && READER_THEMES.includes(value as ReaderTheme);
}
