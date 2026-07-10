import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import {
  EARLY_CHRISTIAN_MANIFEST_URL,
  EARLY_CHRISTIAN_PREVIEW_ASSET_VERSION
} from "~/features/early-christian-preview/preview-cache";
import { handleSearchRequest } from "~/features/search/search-request.server";
import { getEarlyChristianAuthors } from "~/lib/early-christian-search.server";
import { parseJson } from "~/lib/json";
import { getClientIp, rateLimit } from "~/lib/rate-limit.server";
import { getScriptureCacheInfo } from "~/lib/scripture-cache.server";

import type { BookIndex, ChurchFathersActionData } from "./types";

let knownPreviewChapterIdsPromise: Promise<Set<string>> | null = null;

export async function churchFathersLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const authorOptionsPromise: Promise<string[]> = getEarlyChristianAuthors()
    .catch(() => []);
  const [authorOptions, scriptureCache] = await Promise.all([
    authorOptionsPromise,
    getScriptureCacheInfo()
  ]);
  const requestedChapterId = url.searchParams.get("chapter") ?? "";
  const initialChapterId = requestedChapterId && await isKnownPreviewChapterId(requestedChapterId)
    ? requestedChapterId
    : "";

  return json({
    authorOptions,
    initialChapterId,
    initialPassageRange: initialChapterId ? url.searchParams.get("passage") ?? "" : "",
    manifestUrl: EARLY_CHRISTIAN_MANIFEST_URL,
    previewAssetVersion: EARLY_CHRISTIAN_PREVIEW_ASSET_VERSION,
    scriptureCacheKey: scriptureCache.version,
    scriptureCacheUrl: scriptureCache.url
  });
}

export async function churchFathersAction({ request }: ActionFunctionArgs) {
  const ip = getClientIp(request);
  const limit = rateLimit(ip);

  if (!limit.allowed) {
    return json<ChurchFathersActionData>(
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

  return handleSearchRequest(await request.formData(), "fathers");
}

async function isKnownPreviewChapterId(chapterId: string) {
  knownPreviewChapterIdsPromise ??= readKnownPreviewChapterIds();
  return (await knownPreviewChapterIdsPromise).has(chapterId);
}

async function readKnownPreviewChapterIds() {
  const [{ readFile }, path] = await Promise.all([
    import("node:fs/promises"),
    import("node:path")
  ]);
  const bookIndexPath = path.resolve(
    process.cwd(),
    "public/church-fathers-preview/books.json"
  );
  const bookIndex = parseJson(await readFile(bookIndexPath, "utf8")) as BookIndex;
  const chapterIds = new Set<string>();

  for (const book of bookIndex.books) {
    for (const chapter of book.chapters) {
      chapterIds.add(chapter.id);
    }
  }

  return chapterIds;
}
