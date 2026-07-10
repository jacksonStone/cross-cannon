import { json, type TypedResponse } from "@remix-run/node";

import {
  getEarlyChristianAuthors,
  getEarlyChristianEmbeddingSource,
  searchEarlyChristianWorks,
  searchSimilarEarlyChristianFromScripture,
  searchSimilarEarlyChristianPassages,
  type EarlyChristianSearchResult,
  type EarlyChristianSimilarSource
} from "~/lib/early-christian-search.server";
import {
  ensureDatabase,
  getDb,
  type ScriptureResult
} from "~/lib/db.server";
import {
  searchScripture,
  searchScriptureByEmbedding,
  searchSimilarScripture
} from "~/lib/search.server";

import {
  BOOKS_BY_CANON,
  DEFAULT_MATCH_COUNT,
  parseCanonMode,
  sortCanonicalBooks
} from "./canons";
import { withCalibratedMatchStrength } from "./match-strength";
import type {
  CanonMode,
  ChurchFathersActionData,
  SearchActionData,
  SearchTargetCorpus
} from "./types";

const MAX_EARLY_CHRISTIAN_AUTHOR_FILTERS = 3;

type ScriptureSimilarSource = {
  id: string;
  reference: string;
};

type ScriptureSimilarSearch = {
  results: ScriptureResult[];
  source: ScriptureSimilarSource;
};

type EarlyChristianSimilarSearch = {
  results: EarlyChristianSearchResult[];
  source: EarlyChristianSimilarSource;
};

export type SearchRequestAdapter = {
  getEarlyChristianAuthors: () => Promise<string[]>;
  getIndexedScriptureBooks: () => Promise<string[]>;
  searchEarlyChristianSimilarFromEarlyChristian: (
    sourcePassageId: string,
    limit: number,
    authors: string[]
  ) => Promise<EarlyChristianSimilarSearch | null>;
  searchEarlyChristianSimilarFromScripture: (
    sourcePassageId: string,
    limit: number,
    authors: string[]
  ) => Promise<{
    results: EarlyChristianSearchResult[];
    source: ScriptureSimilarSource;
  } | null>;
  searchEarlyChristianTheme: (
    question: string,
    limit: number,
    authors: string[]
  ) => Promise<EarlyChristianSearchResult[]>;
  searchScriptureSimilarFromEarlyChristian: (
    sourcePassageId: string,
    limit: number,
    books: string[]
  ) => Promise<{
    results: ScriptureResult[];
    source: EarlyChristianSimilarSource;
  } | null>;
  searchScriptureSimilarFromScripture: (
    sourcePassageId: string,
    limit: number,
    books: string[]
  ) => Promise<ScriptureSimilarSearch | null>;
  searchScriptureTheme: (
    question: string,
    limit: number,
    books: string[]
  ) => Promise<ScriptureResult[]>;
};

export type SearchRequestHandler = {
  (
    formData: FormData,
    readerCorpus: "fathers"
  ): Promise<TypedResponse<ChurchFathersActionData>>;
  (
    formData: FormData,
    readerCorpus?: "scripture"
  ): Promise<TypedResponse<SearchActionData>>;
};

type PreparedSearchRequest = {
  authors: string[];
  books: string[];
  canon: CanonMode;
  matchCount: number;
  mode: "similar" | "theme";
  question: string;
  readerCorpus: "fathers" | "scripture";
  searchBooks: string[];
  sourcePassageId: string;
  targetCorpus: SearchTargetCorpus;
};

type SearchRequestExecution = {
  earlyChristianResults?: EarlyChristianSearchResult[];
  scriptureResults?: ScriptureResult[];
  source?: EarlyChristianSimilarSource | ScriptureSimilarSource;
};

type PreparedSearchRequestResult<T> =
  | { request: PreparedSearchRequest }
  | { response: TypedResponse<T> };

export function createSearchRequestHandler(
  adapter: SearchRequestAdapter
): SearchRequestHandler {
  const handleSearchRequest = async (
    formData: FormData,
    readerCorpus: "fathers" | "scripture" = "scripture"
  ) => {
    const prepared = readerCorpus === "fathers"
      ? await prepareEarlyChristianReaderSearchRequest(formData, adapter)
      : await prepareScriptureReaderSearchRequest(formData, adapter);

    if ("response" in prepared) {
      return prepared.response;
    }

    const execution = await executeSearchRequest(prepared.request, adapter);

    if (!execution) {
      return missingSimilaritySourceResponse(prepared.request);
    }

    return readerCorpus === "fathers"
      ? earlyChristianReaderSearchResponse(prepared.request, execution)
      : scriptureReaderSearchResponse(prepared.request, execution);
  };

  return handleSearchRequest as SearchRequestHandler;
}

async function prepareScriptureReaderSearchRequest(
  formData: FormData,
  adapter: SearchRequestAdapter
): Promise<PreparedSearchRequestResult<SearchActionData>> {
  const matchCountResult = parseSearchMatchCount(formData.get("matchCount"));
  const authorFilters = await parseEarlyChristianAuthorFilters(
    formData.getAll("earlyChristianAuthors"),
    adapter
  );

  if ("error" in authorFilters) {
    return { response: json<SearchActionData>({ error: authorFilters.error }, { status: 400 }) };
  }

  if ("error" in matchCountResult) {
    return {
      response: json<SearchActionData>(
        { error: matchCountResult.error },
        { status: matchCountResult.status }
      )
    };
  }

  const canon = parseCanonMode(String(formData.get("canon") ?? ""));
  const selectedBooks = readSelectedBooks(formData);
  const indexedBooks = new Set(await adapter.getIndexedScriptureBooks());
  const canonBooks = BOOKS_BY_CANON[canon];
  const books = Array.from(new Set(selectedBooks)).filter(
    (book) => indexedBooks.has(book) && canonBooks.has(book)
  );

  if (selectedBooks.length > 0 && books.length === 0) {
    return {
      response: json<SearchActionData>(
        { error: "Choose at least one indexed book in the selected canon." },
        { status: 400 }
      )
    };
  }

  const intent = parseScriptureReaderSearchIntent(formData.get("intent"));
  const content = prepareSearchContent(formData, intent.mode, true);

  if ("error" in content) {
    return { response: json<SearchActionData>({ error: content.error }, { status: 400 }) };
  }

  return { request: {
    authors: authorFilters.authors,
    books,
    canon,
    matchCount: matchCountResult.matchCount,
    mode: intent.mode,
    question: content.question,
    readerCorpus: "scripture",
    searchBooks: books.length > 0
      ? books
      : Array.from(canonBooks).filter((book) => indexedBooks.has(book)),
    sourcePassageId: content.sourcePassageId,
    targetCorpus: intent.targetCorpus
  } };
}

async function prepareEarlyChristianReaderSearchRequest(
  formData: FormData,
  adapter: SearchRequestAdapter
): Promise<PreparedSearchRequestResult<ChurchFathersActionData>> {
  const matchCountResult = parseSearchMatchCount(formData.get("matchCount"));
  const authorFilters = await parseEarlyChristianAuthorFilters(
    formData.getAll("authors"),
    adapter
  );

  if ("error" in matchCountResult) {
    return {
      response: json<ChurchFathersActionData>(
        { error: matchCountResult.error },
        { status: matchCountResult.status }
      )
    };
  }

  if ("error" in authorFilters) {
    return {
      response: json<ChurchFathersActionData>(
        { error: authorFilters.error },
        { status: 400 }
      )
    };
  }

  const intent = parseEarlyChristianReaderSearchIntent(formData.get("intent"));
  const scriptureFilters = intent.targetCorpus === "scripture"
    ? parseEarlyChristianReaderScriptureFilters(formData)
    : {
      books: [],
      canon: parseCanonMode(String(formData.get("canon") ?? "")),
      searchBooks: []
    };

  if ("error" in scriptureFilters) {
    return {
      response: json<ChurchFathersActionData>(
        { error: scriptureFilters.error },
        { status: 400 }
      )
    };
  }

  const content = prepareSearchContent(formData, intent.mode, false);

  if ("error" in content) {
    return {
      response: json<ChurchFathersActionData>(
        { error: content.error },
        { status: 400 }
      )
    };
  }

  return { request: {
    authors: authorFilters.authors,
    books: scriptureFilters.books,
    canon: scriptureFilters.canon,
    matchCount: matchCountResult.matchCount,
    mode: intent.mode,
    question: content.question,
    readerCorpus: "fathers",
    searchBooks: scriptureFilters.searchBooks,
    sourcePassageId: content.sourcePassageId,
    targetCorpus: intent.targetCorpus
  } };
}

function parseScriptureReaderSearchIntent(value: FormDataEntryValue | null): {
  mode: "similar" | "theme";
  targetCorpus: SearchTargetCorpus;
} {
  switch (String(value ?? "theme")) {
    case "similar-passage":
      return { mode: "similar", targetCorpus: "scripture" };
    case "similar-early-christian":
      return { mode: "similar", targetCorpus: "early-christian" };
    case "theme-early-christian":
      return { mode: "theme", targetCorpus: "early-christian" };
    default:
      return { mode: "theme", targetCorpus: "scripture" };
  }
}

function parseEarlyChristianReaderSearchIntent(value: FormDataEntryValue | null): {
  mode: "similar" | "theme";
  targetCorpus: SearchTargetCorpus;
} {
  switch (String(value ?? "theme")) {
    case "similar-passage":
      return { mode: "similar", targetCorpus: "early-christian" };
    case "similar-scripture":
      return { mode: "similar", targetCorpus: "scripture" };
    case "theme-scripture":
      return { mode: "theme", targetCorpus: "scripture" };
    default:
      return { mode: "theme", targetCorpus: "early-christian" };
  }
}

function prepareSearchContent(
  formData: FormData,
  mode: "similar" | "theme",
  validateScriptureSource: boolean
) {
  if (mode === "similar") {
    const sourcePassageId = String(formData.get("sourcePassageId") ?? "").trim();

    if (validateScriptureSource && !isSearchSourcePassageId(sourcePassageId)) {
      return { error: "Choose a passage to search from." } as const;
    }

    return { question: "", sourcePassageId };
  }

  const question = String(formData.get("question") ?? "").trim();
  const validation = validateSearchQuestion(question);

  return "error" in validation
    ? validation
    : { question, sourcePassageId: "" };
}

async function executeSearchRequest(
  request: PreparedSearchRequest,
  adapter: SearchRequestAdapter
): Promise<SearchRequestExecution | null> {
  if (request.mode === "theme") {
    return request.targetCorpus === "scripture"
      ? {
        scriptureResults: await adapter.searchScriptureTheme(
          request.question,
          request.matchCount,
          request.searchBooks
        )
      }
      : {
        earlyChristianResults: await adapter.searchEarlyChristianTheme(
          request.question,
          request.matchCount,
          request.authors
        )
      };
  }

  if (request.targetCorpus === "scripture") {
    const similar = request.readerCorpus === "scripture"
      ? await adapter.searchScriptureSimilarFromScripture(
        request.sourcePassageId,
        request.matchCount,
        request.searchBooks
      )
      : await adapter.searchScriptureSimilarFromEarlyChristian(
        request.sourcePassageId,
        request.matchCount,
        request.searchBooks
      );

    return similar
      ? { scriptureResults: similar.results, source: similar.source }
      : null;
  }

  const similar = request.readerCorpus === "scripture"
    ? await adapter.searchEarlyChristianSimilarFromScripture(
      request.sourcePassageId,
      request.matchCount,
      request.authors
    )
    : await adapter.searchEarlyChristianSimilarFromEarlyChristian(
      request.sourcePassageId,
      request.matchCount,
      request.authors
    );

  return similar
    ? { earlyChristianResults: similar.results, source: similar.source }
    : null;
}

function missingSimilaritySourceResponse(request: PreparedSearchRequest) {
  if (request.readerCorpus === "fathers") {
    return json<ChurchFathersActionData>(
      { error: "Choose an indexed passage to search from." },
      { status: 400 }
    );
  }

  return json<SearchActionData>(
    {
      error: request.targetCorpus === "scripture"
        ? "That passage is not available for similarity search."
        : "That passage is not available for early Christian similarity search."
    },
    { status: 400 }
  );
}

function scriptureReaderSearchResponse(
  request: PreparedSearchRequest,
  execution: SearchRequestExecution
) {
  if (request.mode === "theme" && request.targetCorpus === "early-christian") {
    return json<SearchActionData>({
      earlyChristianAuthors: request.authors,
      earlyChristianResults: execution.earlyChristianResults,
      matchCount: request.matchCount,
      mode: "theme-early-christian",
      question: request.question,
      targetCorpus: "early-christian"
    });
  }

  if (request.mode === "similar" && request.targetCorpus === "early-christian") {
    return json<SearchActionData>({
      books: request.books,
      canon: request.canon,
      earlyChristianAuthors: request.authors,
      earlyChristianResults: execution.earlyChristianResults,
      matchCount: request.matchCount,
      mode: "similar-early-christian",
      similarSource: execution.source,
      targetCorpus: "early-christian"
    });
  }

  return json<SearchActionData>({
    books: request.books,
    canon: request.canon,
    earlyChristianAuthors: request.authors,
    matchCount: request.matchCount,
    mode: request.mode,
    question: request.mode === "theme" ? request.question : undefined,
    results: withCalibratedMatchStrength(execution.scriptureResults ?? []),
    similarSource: request.mode === "similar" ? execution.source : undefined,
    targetCorpus: "scripture"
  });
}

function earlyChristianReaderSearchResponse(
  request: PreparedSearchRequest,
  execution: SearchRequestExecution
) {
  if (request.targetCorpus === "scripture") {
    return json<ChurchFathersActionData>({
      books: request.books,
      canon: request.canon,
      matchCount: request.matchCount,
      mode: request.mode === "similar" ? "similar-scripture" : "theme-scripture",
      question: request.mode === "theme" ? request.question : undefined,
      scriptureResults: withCalibratedMatchStrength(execution.scriptureResults ?? []),
      similarScriptureSource: request.mode === "similar"
        ? execution.source as EarlyChristianSimilarSource
        : undefined,
      targetCorpus: "scripture"
    });
  }

  return json<ChurchFathersActionData>({
    authors: request.authors,
    matchCount: request.matchCount,
    mode: request.mode,
    question: request.mode === "theme" ? request.question : undefined,
    results: execution.earlyChristianResults,
    similarSource: request.mode === "similar"
      ? execution.source as EarlyChristianSimilarSource
      : undefined,
    targetCorpus: "early-christian"
  });
}

function readSelectedBooks(formData: FormData) {
  return formData
    .getAll("books")
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function parseEarlyChristianReaderScriptureFilters(formData: FormData) {
  const canon = parseCanonMode(String(formData.get("canon") ?? ""));
  const canonBooks = BOOKS_BY_CANON[canon];
  const selectedBooks = readSelectedBooks(formData);
  const books = Array.from(new Set(selectedBooks))
    .filter((book) => canonBooks.has(book));

  if (selectedBooks.length > 0 && books.length === 0) {
    return {
      error: "Choose at least one book in the selected canon."
    };
  }

  return {
    books,
    canon,
    searchBooks: books.length > 0 ? books : Array.from(canonBooks)
  };
}

async function parseEarlyChristianAuthorFilters(
  values: FormDataEntryValue[],
  adapter: SearchRequestAdapter
) {
  const requestedAuthors = Array.from(new Set(
    values
      .map((value) => String(value).trim())
      .filter(Boolean)
  ));

  if (requestedAuthors.length > MAX_EARLY_CHRISTIAN_AUTHOR_FILTERS) {
    return {
      error: `Choose up to ${MAX_EARLY_CHRISTIAN_AUTHOR_FILTERS} early Christian authors.`
    };
  }

  if (requestedAuthors.length === 0) {
    return { authors: [] };
  }

  const knownAuthors = new Set(await adapter.getEarlyChristianAuthors());
  const authors = requestedAuthors.filter((author) => knownAuthors.has(author));

  if (authors.length === 0) {
    return {
      error: "Choose at least one indexed early Christian author."
    };
  }

  return { authors };
}

export type SearchRequestValidationError = {
  error: string;
  status: 400;
};

export function parseSearchMatchCount(
  value: FormDataEntryValue | null,
  fallback = DEFAULT_MATCH_COUNT
): { matchCount: number } | SearchRequestValidationError {
  const matchCount = Number(value ?? fallback);

  if (!Number.isInteger(matchCount) || matchCount < 5 || matchCount > 40) {
    return {
      error: "Choose between 5 and 40 matches.",
      status: 400
    };
  }

  return { matchCount };
}

export function validateSearchQuestion(question: string):
  | { question: string }
  | SearchRequestValidationError {
  if (question.length < 3) {
    return {
      error: "Enter a longer question.",
      status: 400
    };
  }

  if (question.length > 500) {
    return {
      error: "Keep the question under 500 characters.",
      status: 400
    };
  }

  return { question };
}

export function isSearchSourcePassageId(value: string) {
  return /^[a-f0-9]{24}$/.test(value);
}

let indexedBooksPromise: Promise<string[]> | null = null;

export async function getIndexedBooks() {
  indexedBooksPromise ??= readIndexedBooks().catch((error: unknown) => {
    indexedBooksPromise = null;
    throw error;
  });
  return indexedBooksPromise;
}

async function readIndexedBooks() {
  await ensureDatabase();

  const booksResponse = await getDb().execute(`
    SELECT book
    FROM passages
    GROUP BY book
    ORDER BY MIN(rowid)
  `);

  return sortCanonicalBooks(booksResponse.rows.map((row) => String(row.book)));
}

async function readSearchableScriptureBooks() {
  const booksResponse = await getDb().execute(
    "SELECT book FROM passages GROUP BY book"
  );

  return booksResponse.rows.map((row) => String(row.book));
}

const productionSearchRequestAdapter: SearchRequestAdapter = {
  getEarlyChristianAuthors,
  getIndexedScriptureBooks: readSearchableScriptureBooks,
  searchEarlyChristianSimilarFromEarlyChristian: searchSimilarEarlyChristianPassages,
  searchEarlyChristianSimilarFromScripture: searchSimilarEarlyChristianFromScripture,
  searchEarlyChristianTheme: searchEarlyChristianWorks,
  searchScriptureSimilarFromEarlyChristian: async (sourceKey, limit, books) => {
    const source = await getEarlyChristianEmbeddingSource(sourceKey);

    if (!source) {
      return null;
    }

    return {
      results: await searchScriptureByEmbedding(source.embedding, limit, books),
      source: {
        id: source.id,
        reference: source.reference,
        text: source.text
      }
    };
  },
  searchScriptureSimilarFromScripture: searchSimilarScripture,
  searchScriptureTheme: searchScripture
};

export const handleSearchRequest = createSearchRequestHandler(
  productionSearchRequestAdapter
);
