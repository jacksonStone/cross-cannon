import { useEffect, useState } from "react";

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData } from "@remix-run/react";

import { SearchForm } from "~/features/search/SearchForm";
import { SearchResults } from "~/features/search/SearchResults";
import { loadScriptureCache } from "~/features/search/scripture-cache.client";
import { getIndexedBooks, handleSearchRequest } from "~/features/search/search.server";
import type { SearchActionData } from "~/features/search/types";
import { getClientIp, rateLimit } from "~/lib/rate-limit.server";
import { getScriptureCacheInfo, type BrowserPassage } from "~/lib/scripture-cache.server";

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

  useEffect(() => {
    let ignore = false;

    setIsScriptureReady(false);
    loadScriptureCache(scriptureCacheUrl)
      .then((loadedPassages) => {
        if (!ignore) {
          setPassages(loadedPassages);
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

  return (
    <main className="page-shell">
      <data value={scriptureCacheKey} data-scripture-cache-key hidden />
      <header className="site-header">
        <div>
          <p className="eyebrow">Cross Canon</p>
          <h1>Search Scripture by theme.</h1>
        </div>
      </header>

      <SearchForm
        actionData={actionData}
        books={books}
        isScriptureReady={isScriptureReady}
        passages={passages}
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
        passages={passages}
        results={actionData?.results}
      />

      <footer className="source-note">
        Indexed text: Protestant, Catholic, and Orthodox canons of the World English Bible (WEB).
        Protestant search is the default.{" "}
        <a href="https://worldenglish.bible/" rel="noreferrer" target="_blank">
          Read the WEB
        </a>
        .
      </footer>
    </main>
  );
}
