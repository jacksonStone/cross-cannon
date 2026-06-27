import { useEffect, useState } from "react";

import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

import { PassageReader } from "~/features/passage-reader/PassageReader";
import { loadScriptureCache } from "~/features/search/scripture-cache.client";
import type { StoredFilters } from "~/features/search/types";
import { getScriptureCacheInfo, type BrowserPassage } from "~/lib/scripture-cache.server";

export const meta: MetaFunction = () => [
  { title: "Reader | Cross Canon" },
  {
    name: "description",
    content: "Read Scripture in chapter context."
  }
];

export async function loader({ params, request }: LoaderFunctionArgs) {
  const scriptureCache = await getScriptureCacheInfo();
  const url = new URL(request.url);

  return json({
    filters: readFilters(url.searchParams),
    passageId: params.passageId ?? "",
    scriptureCacheKey: scriptureCache.version,
    scriptureCacheUrl: scriptureCache.url
  });
}

export default function ReaderRoute() {
  const { filters, passageId, scriptureCacheKey, scriptureCacheUrl } =
    useLoaderData<typeof loader>();
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
    <main className="reader-shell">
      <data value={scriptureCacheKey} data-scripture-cache-key hidden />
      <PassageReader
        filters={filters}
        initialPassageId={passageId}
        isScriptureReady={isScriptureReady}
        passages={passages}
      />
    </main>
  );
}

function readFilters(searchParams: URLSearchParams): StoredFilters {
  const matchCount = Number(searchParams.get("matchCount"));

  return {
    canon: searchParams.get("canon") ?? undefined,
    matchCount: Number.isFinite(matchCount) && matchCount > 0 ? matchCount : undefined,
    books: searchParams.getAll("books")
  };
}
