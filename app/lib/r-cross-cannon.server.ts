import type { WorkCorpus } from "~/features/work-reader/collections";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { SearchRequestAdapter } from "~/features/search/search-request.server";
import { sortCanonicalBooks } from "~/features/search/canons";
import { withCalibratedMatchStrength } from "~/features/search/match-strength";
import type { ScriptureResult } from "./db.server";
import type { EarlyChristianSearchResult, EarlyChristianSimilarSource } from "./early-christian-search.server";
import { isRecord, isUnknownArray } from "./json";

type CatalogBook = { id: string; title: string; corpus: "scripture" | WorkCorpus; author: string | null };
type SimilarSource = { id: string; reference: string; text?: string };
type WireEarlyChristianResult = Omit<EarlyChristianSearchResult, "matchStrength">;
type RustRequest = {
  query?: string;
  sourceId?: string;
  corpus: "scripture" | WorkCorpus;
  books?: string[];
  authors?: string[];
  limit: number;
};

export class RustApiError extends Error {
  constructor(message: string, readonly status = 503, readonly retryAfterSeconds?: number) { super(message); }
}

function apiBase() {
  const origin = new URL(process.env.R_CROSS_CANNON_ORIGIN ?? "http://127.0.0.1:3006");
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || !['http:', 'https:'].includes(origin.protocol)) {
    throw new RustApiError("R Cross Cannon must use a loopback origin.");
  }
  return `${origin.origin}/r/api`;
}

export function createRustSearchAdapter(fetcher: typeof fetch = fetch, base: () => string = apiBase): SearchRequestAdapter {
  let catalogPromise: Promise<CatalogBook[]> | undefined;
  async function call(endpoint: string, body?: RustRequest): Promise<unknown> {
    try {
      const response = await fetcher(`${base()}${endpoint}`, {
        method: body ? "POST" : "GET",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify({ ...body, mode: "semantic", canon: "orthodox", web: true }) : undefined,
        signal: AbortSignal.timeout(body ? 25_000 : 3_000),
        redirect: "error"
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.error === "string" ? payload.error : "R Cross Cannon could not complete the search.";
        throw new RustApiError(message, response.status, response.status === 429 ? 60 : undefined);
      }
      return payload;
    } catch (error) {
      if (error instanceof RustApiError) throw error;
      throw new RustApiError("Search is temporarily unavailable. Your downloaded texts are still available.");
    }
  }
  async function catalog() {
    catalogPromise ??= (async () => {
      try {
        const payload = await call("/books");
        if (!isRecord(payload) || !isUnknownArray(payload.books) || !payload.books.every(isCatalogBook)) throw new RustApiError("R Cross Cannon returned an invalid book catalog.");
        return payload.books;
      } catch {
        // Preserve reading during a service outage. These are the same immutable
        // text artifacts the reader already uses; no SQLite work or regeneration.
        catalogPromise = undefined;
        return localCatalog();
      }
    })();
    return catalogPromise;
  }
  async function search<T>(request: RustRequest, validate: (value: unknown) => value is T): Promise<{ results: T[]; source?: SimilarSource } | null> {
    let payload;
    try { payload = await call("/search", request); }
    catch (error) {
      if (request.sourceId && error instanceof RustApiError && error.status === 400 && /source passage|stored embedding|no rows/i.test(error.message)) return null;
      throw error;
    }
    if (!isRecord(payload) || !isUnknownArray(payload.results) || !payload.results.every(validate)
      || (request.sourceId && !isSource(payload.source))) throw new RustApiError("R Cross Cannon returned invalid search results.", 502);
    return { results: payload.results, source: isSource(payload.source) ? payload.source : undefined };
  }
  const scripture = (request: Omit<RustRequest, "corpus">) => search({ ...request, corpus: "scripture" }, isScriptureResult);
  const fathers = async (request: Omit<RustRequest, "corpus">, corpus: WorkCorpus = "early-christian") => {
    const response = await search({ ...request, corpus }, isEarlyChristianResult);
    return response ? { ...response, results: withCalibratedMatchStrength(response.results) } : null;
  };
  const earlySource = (source: SimilarSource | undefined): EarlyChristianSimilarSource => {
    if (!source || typeof source.text !== "string") throw new RustApiError("R Cross Cannon returned an invalid source passage.", 502);
    return { id: source.id, reference: source.reference, text: source.text };
  };
  return {
    getIndexedScriptureBooks: async () => sortCanonicalBooks((await catalog()).filter(b => b.corpus === "scripture").map(b => b.id)),
    getEarlyChristianAuthors: async (corpus = "early-christian") => [...new Set((await catalog()).filter(b => b.corpus === corpus).flatMap(b => b.author ? [b.author] : []))].sort(),
    searchScriptureTheme: async (query, limit, books) => (await scripture({ query, limit, books }))!.results,
    searchEarlyChristianTheme: async (query, limit, authors, corpus) => (await fathers({ query, limit, authors }, corpus))!.results,
    searchScriptureSimilarFromScripture: async (sourceId, limit, books) => {
      const response = await scripture({ sourceId, limit, books });
      return response ? { results: response.results, source: response.source! } : null;
    },
    searchEarlyChristianSimilarFromScripture: async (sourceId, limit, authors, corpus) => {
      const response = await fathers({ sourceId, limit, authors }, corpus);
      return response ? { results: response.results, source: response.source! } : null;
    },
    searchScriptureSimilarFromEarlyChristian: async (sourceId, limit, books) => {
      const response = await scripture({ sourceId, limit, books });
      return response ? { results: response.results, source: earlySource(response.source) } : null;
    },
    searchEarlyChristianSimilarFromEarlyChristian: async (sourceId, limit, authors, corpus) => {
      const response = await fathers({ sourceId, limit, authors }, corpus);
      return response ? { results: response.results, source: earlySource(response.source) } : null;
    }
  };
}

function isCatalogBook(value: unknown): value is CatalogBook {
  return isRecord(value) && typeof value.id === "string" && typeof value.title === "string" && (value.corpus === "scripture" || value.corpus === "early-christian" || value.corpus === "christian-classics") && (value.author === null || typeof value.author === "string");
}
function isSource(value: unknown): value is SimilarSource {
  return isRecord(value) && typeof value.id === "string" && typeof value.reference === "string";
}
function isScriptureResult(value: unknown): value is ScriptureResult {
  return isRecord(value) && value.type === "paragraph" && typeof value.score === "number" && Number.isFinite(value.score)
    && (value.highlightVerse === undefined || Number.isInteger(value.highlightVerse)) && isSource(value);
}
function isEarlyChristianResult(value: unknown): value is WireEarlyChristianResult {
  if (!isRecord(value) || !isRecord(value.highlightPassage)) return false;
  const p = value.highlightPassage;
  return typeof value.chapterId === "string" && typeof value.chapterReference === "string" && typeof value.title === "string" && typeof value.source === "string"
    && (value.author === null || typeof value.author === "string") && (value.date === null || typeof value.date === "string")
    && typeof value.score === "number" && Number.isFinite(value.score) && typeof p.text === "string" && typeof p.rangeLabel === "string"
    && (p.verseStart === null || Number.isInteger(p.verseStart)) && (p.verseEnd === null || Number.isInteger(p.verseEnd)) && isSource(p);
}
async function localCatalog(): Promise<CatalogBook[]> {
  const root = process.cwd();
  const manifest = JSON.parse(await readFile(path.join(root, "scripture-cache/manifest.json"), "utf8"));
  if (typeof manifest.version !== "string" || !/^[a-f0-9]+$/.test(manifest.version)) throw new RustApiError("The local Scripture catalog is unavailable.");
  const [scripture, fathers, classics] = await Promise.all([
    readFile(path.join(root, `scripture-cache/${manifest.version}.json`), "utf8").then(JSON.parse),
    readFile(path.join(root, "public/church-fathers-preview/books.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "public/christian-classics-text/books.json"), "utf8").then(JSON.parse).catch(() => ({books:[]}))
  ]);
  const books = [...new Set<string>(scripture.passages.map((p: { reference: string }) => p.reference.slice(0, p.reference.lastIndexOf(" "))))];
  return [...books.map(id => ({ id, title: id, corpus: "scripture" as const, author: null })),
    ...fathers.books.map((b: { id: string; book: string; author?: string }) => ({ id: b.id, title: b.book, corpus: "early-christian" as const, author: b.author ?? null })),
    ...classics.books.map((b: {id:string; book:string; author?:string}) => ({id:b.id,title:b.book,corpus:"christian-classics" as const,author:b.author??null}))];
}

export const rustSearchAdapter = createRustSearchAdapter();
export const getIndexedBooks = rustSearchAdapter.getIndexedScriptureBooks;
export const getEarlyChristianAuthors = rustSearchAdapter.getEarlyChristianAuthors;
