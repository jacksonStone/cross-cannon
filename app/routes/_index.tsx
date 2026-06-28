import { useCallback, useEffect, useRef, useState } from "react";

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData } from "@remix-run/react";

import { PassageReader } from "~/features/passage-reader/PassageReader";
import { SearchForm } from "~/features/search/SearchForm";
import { SearchResults } from "~/features/search/SearchResults";
import { loadScriptureCache } from "~/features/search/scripture-cache.client";
import { getIndexedBooks, handleSearchRequest } from "~/features/search/search.server";
import type { SearchActionData } from "~/features/search/types";
import { getClientIp, rateLimit } from "~/lib/rate-limit.server";
import { getScriptureCacheInfo, type BrowserPassage } from "~/lib/scripture-cache.server";

const READER_POSITION_STORAGE_KEY = "cross-cannon:reader-position:v1";

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
  const { books, scriptureCacheKey, scriptureCacheUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [passages, setPassages] = useState<BrowserPassage[]>([]);
  const [isScriptureReady, setIsScriptureReady] = useState(false);
  const [focusedPassageId, setFocusedPassageId] = useState<string | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [readerPassageId, setReaderPassageId] = useState("");
  const [readerBackPassageId, setReaderBackPassageId] = useState<string | null>(null);
  const lastVisiblePassageIdRef = useRef("");

  useEffect(() => {
    let ignore = false;

    setIsScriptureReady(false);
    loadScriptureCache(scriptureCacheUrl)
      .then((loadedPassages) => {
        if (!ignore) {
          const savedPassageId = window.localStorage.getItem(READER_POSITION_STORAGE_KEY);
          const rememberedPassage = savedPassageId
            ? loadedPassages.find((passage) => passage.id === savedPassageId)
            : null;
          const initialPassageId =
            rememberedPassage?.id ?? findDefaultReaderPassageId(loadedPassages);

          setPassages(loadedPassages);
          setReaderPassageId(initialPassageId);
          lastVisiblePassageIdRef.current = initialPassageId;
          setIsScriptureReady(true);
        }
      })
      .catch(() => {
        if (!ignore) {
          setPassages([]);
          setIsScriptureReady(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [scriptureCacheUrl]);

  useEffect(() => {
    if (actionData?.mode === "similar" && actionData.similarSource) {
      setFocusedPassageId(actionData.similarSource.id);
      setIsSearchOpen(true);
      return;
    }

    if (actionData?.mode === "theme") {
      setFocusedPassageId(null);
      setIsSearchOpen(true);
    }
  }, [actionData?.mode, actionData?.similarSource?.id]);

  useEffect(() => {
    if (!isSearchOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSearchOpen(false);
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isSearchOpen]);

  const rememberReaderLocation = useCallback((passageId: string) => {
    lastVisiblePassageIdRef.current = passageId;
    window.localStorage.setItem(READER_POSITION_STORAGE_KEY, passageId);
  }, []);

  const jumpToReaderPassage = useCallback((passageId: string) => {
    const previousPassageId = lastVisiblePassageIdRef.current || readerPassageId;

    if (previousPassageId && previousPassageId !== passageId) {
      setReaderBackPassageId(previousPassageId);
    }

    setReaderPassageId(passageId);
    rememberReaderLocation(passageId);
    setIsSearchOpen(false);
  }, [readerPassageId, rememberReaderLocation]);

  const jumpBackInReader = useCallback(() => {
    if (!readerBackPassageId) {
      return;
    }

    const previousPassageId = readerPassageId;
    setReaderPassageId(readerBackPassageId);
    setReaderBackPassageId(previousPassageId || null);
    rememberReaderLocation(readerBackPassageId);
  }, [readerBackPassageId, readerPassageId, rememberReaderLocation]);

  return (
    <main className="reader-shell">
      <data value={scriptureCacheKey} data-scripture-cache-key hidden />
      <PassageReader
        backPassageId={readerBackPassageId}
        filters={{}}
        initialPassageId={readerPassageId}
        isScriptureReady={isScriptureReady}
        onBack={jumpBackInReader}
        onJumpToPassage={jumpToReaderPassage}
        onLocationChange={rememberReaderLocation}
        onOpenSearch={() => setIsSearchOpen(true)}
        passages={passages}
      />

      {isSearchOpen ? (
        <div
          className="search-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsSearchOpen(false);
            }
          }}
        >
          <section
            aria-labelledby="search-modal-title"
            aria-modal="true"
            className="search-modal"
            role="dialog"
          >
            <header className="search-modal-header">
              <div>
                <p className="eyebrow">Search</p>
                <h2 id="search-modal-title">Find passages</h2>
              </div>
              <button
                className="filter-modal-close"
                onClick={() => setIsSearchOpen(false)}
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
                isScriptureReady={isScriptureReady}
                onFocusedPassageChange={setFocusedPassageId}
                passages={passages}
                showJump={false}
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
                focusedPassageId={focusedPassageId}
                onJumpToPassage={jumpToReaderPassage}
                passages={passages}
                results={actionData?.results}
              />
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function findDefaultReaderPassageId(passages: BrowserPassage[]) {
  return passages.find((passage) => passage.reference.startsWith("Genesis "))?.id
    ?? passages[0]?.id
    ?? "";
}
