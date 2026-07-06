import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import {
  EARLY_CHRISTIAN_MANIFEST_URL,
  EARLY_CHRISTIAN_PREVIEW_ASSET_VERSION
} from "~/features/early-christian-preview/preview-cache";
import {
  BOOKS_BY_CANON,
  parseCanonMode
} from "~/features/search/canons";
import type { CanonMode } from "~/features/search/types";
import { withCalibratedMatchStrength } from "~/features/search/match-strength";
import { searchScriptureSimilarToFathers } from "~/lib/cross-corpus-search.server";
import {
  getEarlyChristianAuthors,
  parseEarlyChristianAuthorFilters,
  searchEarlyChristianWorks,
  searchSimilarEarlyChristianPassages
} from "~/lib/early-christian-search.server";
import { getClientIp, rateLimit } from "~/lib/rate-limit.server";
import { getScriptureCacheInfo } from "~/lib/scripture-cache.server";
import { searchScripture } from "~/lib/search.server";

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

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "theme");
  const matchCount = parseMatchCount(formData);
  const authorFilters = await parseEarlyChristianAuthorFilters(
    formData.getAll("authors")
  );

  if ("response" in matchCount) {
    return matchCount.response;
  }

  if ("error" in authorFilters) {
    return json<ChurchFathersActionData>(
      { error: authorFilters.error },
      { status: 400 }
    );
  }

  if (intent === "similar-passage") {
    const sourcePassageId = String(formData.get("sourcePassageId") ?? "").trim();
    const similar = await searchSimilarEarlyChristianPassages(
      sourcePassageId,
      matchCount.value,
      authorFilters.authors
    );

    if (!similar) {
      return json<ChurchFathersActionData>(
        { error: "Choose an indexed passage to search from." },
        { status: 400 }
      );
    }

    return json<ChurchFathersActionData>({
      authors: authorFilters.authors,
      matchCount: matchCount.value,
      mode: "similar",
      results: similar.results,
      similarSource: similar.source,
      targetCorpus: "early-christian"
    });
  }

  if (intent === "similar-scripture") {
    const scriptureFilters = parseChurchFathersScriptureFilters(formData);

    if ("response" in scriptureFilters) {
      return scriptureFilters.response;
    }

    const sourcePassageId = String(formData.get("sourcePassageId") ?? "").trim();
    const similar = await searchScriptureSimilarToFathers(
      sourcePassageId,
      matchCount.value,
      scriptureFilters.searchBooks
    );

    if (!similar) {
      return json<ChurchFathersActionData>(
        { error: "Choose an indexed passage to search from." },
        { status: 400 }
      );
    }

    return json<ChurchFathersActionData>({
      books: scriptureFilters.books,
      canon: scriptureFilters.canon,
      matchCount: matchCount.value,
      mode: "similar-scripture",
      scriptureResults: withCalibratedMatchStrength(similar.results),
      similarScriptureSource: similar.source,
      targetCorpus: "scripture"
    });
  }

  if (intent === "theme-scripture") {
    const scriptureFilters = parseChurchFathersScriptureFilters(formData);

    if ("response" in scriptureFilters) {
      return scriptureFilters.response;
    }

    const question = String(formData.get("question") ?? "").trim();
    const validationError = validateQuestion(question);

    if (validationError) {
      return validationError;
    }

    const results = await searchScripture(
      question,
      matchCount.value,
      scriptureFilters.searchBooks
    );

    return json<ChurchFathersActionData>({
      books: scriptureFilters.books,
      canon: scriptureFilters.canon,
      matchCount: matchCount.value,
      mode: "theme-scripture",
      question,
      scriptureResults: withCalibratedMatchStrength(results),
      targetCorpus: "scripture"
    });
  }

  const question = String(formData.get("question") ?? "").trim();
  const validationError = validateQuestion(question);

  if (validationError) {
    return validationError;
  }

  return json<ChurchFathersActionData>({
    authors: authorFilters.authors,
    matchCount: matchCount.value,
    mode: "theme",
    question,
    results: await searchEarlyChristianWorks(
      question,
      matchCount.value,
      authorFilters.authors
    ),
    targetCorpus: "early-christian"
  });
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
  const bookIndex = JSON.parse(await readFile(bookIndexPath, "utf8")) as BookIndex;
  const chapterIds = new Set<string>();

  for (const book of bookIndex.books) {
    for (const chapter of book.chapters) {
      chapterIds.add(chapter.id);
    }
  }

  return chapterIds;
}

function parseChurchFathersScriptureFilters(formData: FormData):
  | {
    books: string[];
    canon: CanonMode;
    searchBooks: string[];
  }
  | { response: ReturnType<typeof json<ChurchFathersActionData>> } {
  const canon = parseCanonMode(String(formData.get("canon") ?? ""));
  const canonBooks = BOOKS_BY_CANON[canon];
  const selectedBooks = formData
    .getAll("books")
    .map((value) => String(value).trim())
    .filter(Boolean);
  const books = Array.from(new Set(selectedBooks))
    .filter((book) => canonBooks.has(book));

  if (selectedBooks.length > 0 && books.length === 0) {
    return {
      response: json<ChurchFathersActionData>(
        { error: "Choose at least one book in the selected canon." },
        { status: 400 }
      )
    };
  }

  return {
    books,
    canon,
    searchBooks: books.length > 0 ? books : Array.from(canonBooks)
  };
}

function parseMatchCount(formData: FormData):
  | { value: number }
  | { response: ReturnType<typeof json<ChurchFathersActionData>> } {
  const matchCount = Number(formData.get("matchCount") ?? 10);

  if (!Number.isInteger(matchCount) || matchCount < 5 || matchCount > 40) {
    return {
      response: json<ChurchFathersActionData>(
        { error: "Choose between 5 and 40 matches." },
        { status: 400 }
      )
    };
  }

  return { value: matchCount };
}

function validateQuestion(question: string) {
  if (question.length < 3) {
    return json<ChurchFathersActionData>(
      { error: "Enter a longer question." },
      { status: 400 }
    );
  }

  if (question.length > 500) {
    return json<ChurchFathersActionData>(
      { error: "Keep the question under 500 characters." },
      { status: 400 }
    );
  }

  return null;
}
