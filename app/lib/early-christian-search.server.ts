import { createClient, type Client } from "@libsql/client";

import {
  getDb,
  normalizeVector,
  vectorSql,
  type IndexedEmbeddingConfig
} from "./db.server";
import { embedText, getDefaultEmbeddingConfig } from "./embeddings.server";
import {
  cosineSimilarity,
  readStoredEmbedding,
  type StoredEmbeddingRow
} from "./vector-search.server";
import { withCalibratedMatchStrength } from "~/features/search/match-strength";

export type EarlyChristianSearchResult = {
  author: string | null;
  chapterId: string;
  chapterReference: string;
  date: string | null;
  highlightPassage: {
    id: string;
    rangeLabel: string;
    reference: string;
    text: string;
    verseEnd: number | null;
    verseStart: number | null;
  };
  matchStrength: number;
  score?: number;
  source: string;
  title: string;
};

export type EarlyChristianSimilarSource = {
  id: string;
  reference: string;
  text: string;
};

type PassageCandidate = {
  author: string | null;
  chapterId: string;
  chapterReference: string;
  date: string | null;
  id: string;
  reference: string;
  score: number;
  source: string;
  text: string;
  title: string;
  verseEnd: number | null;
  verseStart: number | null;
};

type ChapterCandidate = {
  id: string;
  score: number;
};

type EarlyChristianSearchTrace = {
  finish: (label: string, details?: Record<string, unknown>) => void;
  mark: (label: string, details?: Record<string, unknown>) => void;
};

type SearchByEmbeddingOptions = {
  authors?: string[];
  excludePassageIds?: string[];
};

export type EarlyChristianEmbeddingSource = {
  embedding: ArrayLike<number>;
  id: string;
  reference: string;
  text: string;
};

let client: Client | null = null;
let earlyChristianAuthorsPromise: Promise<string[]> | null = null;
const AUTHOR_FILTER_PAGE_SIZE = 10_000;

export function getEarlyChristianDb() {
  client ??= createClient({
    url: process.env.EARLY_CHRISTIAN_DATABASE_URL
      ?? process.env.CHURCH_FATHERS_DATABASE_URL
      ?? "file:./storage/early-christian-works.db"
  });

  return client;
}

export async function getEarlyChristianAuthors() {
  earlyChristianAuthorsPromise ??= readEarlyChristianAuthors().catch((error: unknown) => {
    earlyChristianAuthorsPromise = null;
    throw error;
  });
  return earlyChristianAuthorsPromise;
}

async function readEarlyChristianAuthors() {
  const response = await getEarlyChristianDb().execute(`
    SELECT author
    FROM early_christian_works
    WHERE author IS NOT NULL
      AND TRIM(author) <> ''
    GROUP BY author
    ORDER BY LOWER(author)
  `);

  return response.rows.map((row) => String(row.author));
}

export async function searchEarlyChristianWorks(
  question: string,
  limit = 10,
  authors: string[] = []
) {
  const trace = createEarlyChristianSearchTrace("theme", question, limit);
  const embeddingConfig = await getEarlyChristianEmbeddingConfig();
  trace.mark("embeddingConfig", embeddingConfig);
  const embedding = await embedText(question, embeddingConfig);
  trace.mark("embedText", { hasEmbedding: Boolean(embedding) });

  if (!embedding) {
    trace.finish("missing-query-embedding", { count: 0 });
    return [];
  }

  const results = withMatchStrength(await searchByEmbedding(embedding, limit, { authors }, trace));
  trace.finish("results", { count: results.length });
  return results;
}

export async function searchSimilarEarlyChristianPassages(
  sourceKey: string,
  limit = 10,
  authors: string[] = []
) {
  const trace = createEarlyChristianSearchTrace("similar", sourceKey, limit);
  const source = await findSourcePassage(sourceKey, trace);
  trace.mark("findSourcePassage", { found: Boolean(source) });

  if (!source) {
    trace.finish("missing-source", { count: 0 });
    return null;
  }

  const embedding = readStoredEmbedding(source as StoredEmbeddingRow);
  trace.mark("readSourceEmbedding", { hasEmbedding: Boolean(embedding) });

  if (!embedding) {
    trace.finish("missing-source-embedding", { count: 0 });
    return null;
  }

  const results = await searchByEmbedding(embedding, limit, {
    authors,
    excludePassageIds: [String(source.id)]
  }, trace);
  const rankedResults = withMatchStrength(results);
  trace.finish("results", { count: rankedResults.length });

  return {
    results: rankedResults,
    source: {
      id: String(source.id),
      reference: String(source.reference),
      text: String(source.text)
    } satisfies EarlyChristianSimilarSource
  };
}

export async function searchSimilarEarlyChristianFromScripture(
  passageId: string,
  limit = 10,
  authors: string[] = []
) {
  const trace = createEarlyChristianSearchTrace("similar", `scripture:${passageId}`, limit);
  const source = await findScriptureSourcePassage(passageId, trace);
  trace.mark("findScriptureSourcePassage", { found: Boolean(source) });

  if (!source) {
    trace.finish("missing-scripture-source", { count: 0 });
    return null;
  }

  const embedding = readStoredEmbedding(source as StoredEmbeddingRow);
  trace.mark("readScriptureSourceEmbedding", { hasEmbedding: Boolean(embedding) });

  if (!embedding) {
    trace.finish("missing-scripture-source-embedding", { count: 0 });
    return null;
  }

  const results = withMatchStrength(await searchEarlyChristianPassagesByEmbedding(
    embedding,
    limit,
    [],
    trace,
    authors
  ));
  trace.finish("results", { count: results.length });

  return {
    results,
    source: {
      id: String(source.id),
      reference: String(source.reference)
    }
  };
}

export async function getEarlyChristianEmbeddingSource(
  sourceKey: string
): Promise<EarlyChristianEmbeddingSource | null> {
  const trace = createEarlyChristianSearchTrace("similar", sourceKey, 1);
  const source = await findSourcePassage(sourceKey, trace);

  if (!source) {
    return null;
  }

  const embedding = readStoredEmbedding(source as StoredEmbeddingRow);

  if (!embedding) {
    return null;
  }

  return {
    embedding,
    id: String(source.id),
    reference: String(source.reference),
    text: String(source.text)
  };
}

export async function searchEarlyChristianByEmbedding(
  embedding: ArrayLike<number>,
  limit = 10,
  excludePassageIds: string[] = [],
  trace: EarlyChristianSearchTrace = createEarlyChristianSearchTrace("internal", "embedding", limit),
  authors: string[] = []
) {
  return searchByEmbedding(embedding, limit, { authors, excludePassageIds }, trace);
}

export async function searchEarlyChristianPassagesByEmbedding(
  embedding: ArrayLike<number>,
  limit = 10,
  excludePassageIds: string[] = [],
  trace: EarlyChristianSearchTrace = createEarlyChristianSearchTrace("internal", "passage-embedding", limit),
  authors: string[] = []
) {
  trace.mark("searchPassagesNarrowedStart", {
    authorCount: authors.length,
    excludeCount: excludePassageIds.length
  });
  const results = await searchByEmbedding(embedding, limit, {
    authors,
    excludePassageIds
  }, trace);
  trace.mark("searchPassagesNarrowed", { count: results.length });
  return results;
}

async function getEarlyChristianEmbeddingConfig(): Promise<IndexedEmbeddingConfig> {
  try {
    const response = await getEarlyChristianDb().execute(`
      SELECT model, dimensions
      FROM scripture_embedding_config
      WHERE id = 'active'
    `);
    const row = response.rows[0];

    if (typeof row?.model === "string") {
      return {
        dimensions: Number(row.dimensions),
        model: row.model
      };
    }
  } catch {
    // Fall back to the application default if the early Christian DB is absent.
  }

  return getDefaultEmbeddingConfig();
}

async function searchByEmbedding(
  embedding: ArrayLike<number>,
  limit: number,
  options: SearchByEmbeddingOptions = {},
  trace: EarlyChristianSearchTrace = createEarlyChristianSearchTrace("internal", "", limit)
) {
  const query = normalizeVector(embedding);
  trace.mark("normalizeVector", { dimensions: query.length });

  if (options.authors?.length) {
    return searchPassagesByAuthorsExact(
      query,
      limit,
      options.authors,
      options.excludePassageIds ?? [],
      trace
    );
  }

  const chapterLimit = Math.max(limit * 40, 300);
  const chapterCandidates = await searchChapters(query, chapterLimit, trace);
  trace.mark("searchChapters", {
    chapterCandidateCount: chapterCandidates.length,
    chapterLimit
  });

  if (chapterCandidates.length > 0) {
    const chapterResults = await searchPassagesInChapters(
      query,
      chapterCandidates.map((chapter) => chapter.id),
      limit,
      options.excludePassageIds ?? [],
      trace
    );
    trace.mark("searchPassagesInChapters", { count: chapterResults.length });

    if (chapterResults.length > 0) {
      return chapterResults;
    }
  }

  trace.mark("searchAllPassagesExactSkipped", {
    reason: "disabled",
    searchedChapterCandidates: chapterCandidates.length
  });
  return [];
}

async function searchChapters(
  embedding: ArrayLike<number>,
  limit: number,
  trace: EarlyChristianSearchTrace
) {
  const db = getEarlyChristianDb();

  try {
    trace.mark("chapterAnnStart", { candidateLimit: limit });
    const response = await db.execute({
      sql: `
        SELECT c.id, c.embedding
        FROM vector_top_k('early_christian_chapters_embedding_idx', vector32(?), ?) AS v
        JOIN early_christian_chapters c ON c.rowid = v.id
        WHERE c.embedding IS NOT NULL
      `,
      args: [vectorSql(embedding), limit]
    });
    trace.mark("chapterAnnSql", { rowCount: response.rows.length });

    const results = rowsToChapterCandidates(response.rows, embedding, limit);
    trace.mark("chapterAnnRank", { count: results.length });

    if (results.length > 0) {
      return results;
    }
  } catch (error) {
    trace.mark("chapterAnnError", { error: errorMessage(error) });
    return [];
  }

  return [];
}

async function searchPassagesInChapters(
  embedding: ArrayLike<number>,
  chapterIds: string[],
  limit: number,
  excludePassageIds: string[],
  trace: EarlyChristianSearchTrace
) {
  if (chapterIds.length === 0) {
    return [];
  }

  const excludeClause = excludePassageIds.length
    ? `AND p.id NOT IN (${placeholders(excludePassageIds)})`
    : "";
  trace.mark("passageCandidateSqlStart", {
    chapterCount: chapterIds.length,
    excludeCount: excludePassageIds.length
  });
  const response = await getEarlyChristianDb().execute({
    sql: `
      SELECT
        p.id,
        p.reference,
        p.text,
        p.embedding,
        p.verse_start,
        p.verse_end,
        c.id AS chapter_id,
        c.reference AS chapter_reference,
        w.title,
        w.author,
        w.authorship_date_range,
        w.ccel_id
      FROM passages p
      JOIN early_christian_passage_metadata pm ON pm.passage_id = p.id
      JOIN early_christian_chapters c ON c.id = pm.chapter_id
      LEFT JOIN early_christian_works w ON w.id = pm.work_id
      WHERE p.embedding IS NOT NULL
        AND pm.chapter_id IN (${placeholders(chapterIds)})
        ${excludeClause}
    `,
    args: [...chapterIds, ...excludePassageIds]
  });
  trace.mark("passageCandidateSql", { rowCount: response.rows.length });

  const results = groupPassageRowsByChapter(response.rows, embedding, limit);
  trace.mark("passageCandidateRank", { count: results.length });
  return results;
}

async function searchPassagesByAuthorsExact(
  embedding: ArrayLike<number>,
  limit: number,
  authors: string[],
  excludePassageIds: string[],
  trace: EarlyChristianSearchTrace
) {
  if (authors.length === 0) {
    return [];
  }

  const excludeClause = excludePassageIds.length
    ? `AND p.id NOT IN (${placeholders(excludePassageIds)})`
    : "";
  const bestByChapter = new Map<string, PassageCandidate>();
  let lastMetadataRowid = 0;
  let scannedCount = 0;

  for (;;) {
    trace.mark("authorPassagePageSqlStart", {
      authorCount: authors.length,
      excludeCount: excludePassageIds.length,
      lastMetadataRowid,
      pageSize: AUTHOR_FILTER_PAGE_SIZE
    });
    const response = await getEarlyChristianDb().execute({
      sql: `
        SELECT
          pm.rowid AS metadata_rowid,
          p.id,
          p.reference,
          p.text,
          p.embedding,
          p.verse_start,
          p.verse_end,
          c.id AS chapter_id,
          c.reference AS chapter_reference,
          w.title,
          w.author,
          w.authorship_date_range,
          w.ccel_id
        FROM early_christian_passage_metadata pm
        JOIN passages p ON p.id = pm.passage_id
        JOIN early_christian_chapters c ON c.id = pm.chapter_id
        JOIN early_christian_works w ON w.id = pm.work_id
        WHERE pm.rowid > ?
          AND p.embedding IS NOT NULL
          AND w.author IN (${placeholders(authors)})
          ${excludeClause}
        ORDER BY pm.rowid
        LIMIT ?
      `,
      args: [
        lastMetadataRowid,
        ...authors,
        ...excludePassageIds,
        AUTHOR_FILTER_PAGE_SIZE
      ]
    });
    trace.mark("authorPassagePageSql", { rowCount: response.rows.length });

    if (response.rows.length === 0) {
      break;
    }

    for (const row of response.rows as Array<Record<string, unknown>>) {
      lastMetadataRowid = Math.max(
        lastMetadataRowid,
        Number(row.metadata_rowid) || lastMetadataRowid
      );
      scannedCount += 1;

      const candidate = passageCandidateFromRow(row, embedding);

      if (!candidate) {
        continue;
      }

      const current = bestByChapter.get(candidate.chapterId);

      if (!current || candidate.score > current.score) {
        bestByChapter.set(candidate.chapterId, candidate);
      }
    }

    trace.mark("authorPassagePageRank", {
      bestChapterCount: bestByChapter.size,
      scannedCount
    });

    if (response.rows.length < AUTHOR_FILTER_PAGE_SIZE) {
      break;
    }
  }

  const results = [...bestByChapter.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(passageCandidateToSearchResult);

  trace.mark("authorPassageExactRank", {
    authorCount: authors.length,
    count: results.length,
    scannedCount
  });
  return results;
}

async function findSourcePassage(sourceKey: string, trace: EarlyChristianSearchTrace) {
  const db = getEarlyChristianDb();

  if (/^ecw:[a-f0-9]{24}$/.test(sourceKey)) {
    trace.mark("findSourceByIdStart");
    const response = await db.execute({
      sql: `
        SELECT id, reference, text, embedding
        FROM passages
        WHERE id = ?
          AND embedding IS NOT NULL
      `,
      args: [sourceKey]
    });
    trace.mark("findSourceByIdSql", { rowCount: response.rows.length });

    return response.rows[0] ?? null;
  }

  const rangeMatch = sourceKey.match(/^(.+):(\d+)-(\d+)$/);

  if (!rangeMatch) {
    return null;
  }

  const [, chapterId, verseStart, verseEnd] = rangeMatch;
  trace.mark("findSourceByRangeStart");
  const response = await db.execute({
    sql: `
      SELECT p.id, p.reference, p.text, p.embedding
      FROM passages p
      JOIN early_christian_passage_metadata pm ON pm.passage_id = p.id
      WHERE pm.chapter_id = ?
        AND p.verse_start = ?
        AND p.verse_end = ?
        AND p.embedding IS NOT NULL
      LIMIT 1
    `,
    args: [chapterId, Number(verseStart), Number(verseEnd)]
  });
  trace.mark("findSourceByRangeSql", { rowCount: response.rows.length });

  return response.rows[0] ?? null;
}

async function findScriptureSourcePassage(
  passageId: string,
  trace: EarlyChristianSearchTrace
) {
  trace.mark("findScriptureSourceByIdStart");
  const response = await getDb().execute({
    sql: `
      SELECT id, reference, embedding
      FROM passages
      WHERE id = ?
        AND embedding IS NOT NULL
    `,
    args: [passageId]
  });
  trace.mark("findScriptureSourceByIdSql", { rowCount: response.rows.length });

  return response.rows[0] ?? null;
}

function rowsToChapterCandidates(
  rows: unknown[],
  embedding: ArrayLike<number>,
  limit: number
) {
  const results: ChapterCandidate[] = [];

  for (const row of rows as Array<Record<string, unknown>>) {
    const stored = readStoredEmbedding(row as StoredEmbeddingRow);

    if (!stored) {
      continue;
    }

    const score = cosineSimilarity(embedding, stored);

    if (Number.isFinite(score)) {
      results.push({
        id: String(row.id),
        score
      });
    }
  }

  return results
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function groupPassageRowsByChapter(
  rows: unknown[],
  embedding: ArrayLike<number>,
  limit: number
) {
  const bestByChapter = new Map<string, PassageCandidate>();

  for (const row of rows as Array<Record<string, unknown>>) {
    const candidate = passageCandidateFromRow(row, embedding);

    if (!candidate) {
      continue;
    }
    const current = bestByChapter.get(candidate.chapterId);

    if (!current || candidate.score > current.score) {
      bestByChapter.set(candidate.chapterId, candidate);
    }
  }

  return [...bestByChapter.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(passageCandidateToSearchResult);
}

function passageCandidateFromRow(
  row: Record<string, unknown>,
  embedding: ArrayLike<number>
) {
  const stored = readStoredEmbedding(row as StoredEmbeddingRow);

  if (!stored) {
    return null;
  }

  const score = cosineSimilarity(embedding, stored);
  const chapterId = String(row.chapter_id ?? "");

  if (!chapterId || !Number.isFinite(score)) {
    return null;
  }

  return {
    author: typeof row.author === "string" ? row.author : null,
    chapterId,
    chapterReference: String(row.chapter_reference ?? row.reference ?? ""),
    date: typeof row.authorship_date_range === "string"
      ? row.authorship_date_range
      : null,
    id: String(row.id),
    reference: String(row.reference),
    score,
    source: String(row.ccel_id ?? ""),
    text: String(row.text),
    title: String(row.title ?? row.chapter_reference ?? ""),
    verseEnd: numberOrNull(row.verse_end),
    verseStart: numberOrNull(row.verse_start)
  } satisfies PassageCandidate;
}

function passageCandidateToSearchResult(candidate: PassageCandidate): EarlyChristianSearchResult {
  return {
    author: candidate.author,
    chapterId: candidate.chapterId,
    chapterReference: candidate.chapterReference,
    date: candidate.date,
    highlightPassage: {
      id: candidate.id,
      rangeLabel: passageRangeLabel(candidate.verseStart, candidate.verseEnd),
      reference: candidate.reference,
      text: candidate.text,
      verseEnd: candidate.verseEnd,
      verseStart: candidate.verseStart
    },
    matchStrength: 1,
    score: candidate.score,
    source: candidate.source,
    title: candidate.title
  };
}

const withMatchStrength = withCalibratedMatchStrength;

function passageRangeLabel(verseStart: number | null, verseEnd: number | null) {
  if (verseStart === null) {
    return "";
  }

  if (verseEnd === null || verseEnd === verseStart) {
    return String(verseStart);
  }

  return `${verseStart}-${verseEnd}`;
}

function placeholders(values: unknown[]) {
  return values.map(() => "?").join(", ");
}

function numberOrNull(value: unknown) {
  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function createEarlyChristianSearchTrace(
  mode: "internal" | "similar" | "theme",
  query: string,
  limit: number
): EarlyChristianSearchTrace {
  const enabled = process.env.SEARCH_TRACE === "1";
  const start = performance.now();
  let previous = start;

  function elapsed(now: number) {
    return Math.round((now - start) * 10) / 10;
  }

  function delta(now: number) {
    return Math.round((now - previous) * 10) / 10;
  }

  function log(label: string, details: Record<string, unknown> = {}) {
    if (!enabled) {
      return;
    }

    const now = performance.now();
    console.info(
      JSON.stringify({
        type: "search-timing",
        corpus: "early-christian",
        label,
        elapsedMs: elapsed(now),
        deltaMs: delta(now),
        limit,
        mode,
        queryLength: query.length,
        ...details
      })
    );
    previous = now;
  }

  return {
    finish(label: string, details: Record<string, unknown> = {}) {
      log("finish", { branch: label, ...details });
    },
    mark: log
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
