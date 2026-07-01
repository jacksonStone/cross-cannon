import { createClient, type Client } from "@libsql/client";

import {
  normalizeVector,
  vectorSql,
  type IndexedEmbeddingConfig
} from "./db.server";
import { embedText, getDefaultEmbeddingConfig } from "./embeddings.server";

type StoredEmbeddingRow = {
  embedding?: unknown;
};

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

let client: Client | null = null;

export function getEarlyChristianDb() {
  client ??= createClient({
    url: process.env.EARLY_CHRISTIAN_DATABASE_URL
      ?? process.env.CHURCH_FATHERS_DATABASE_URL
      ?? "file:./storage/early-christian-works.db"
  });

  return client;
}

export async function searchEarlyChristianWorks(question: string, limit = 10) {
  const embeddingConfig = await getEarlyChristianEmbeddingConfig();
  const embedding = await embedText(question, embeddingConfig);

  if (!embedding) {
    return [];
  }

  return withMatchStrength(await searchByEmbedding(embedding, limit));
}

export async function searchSimilarEarlyChristianPassages(sourceKey: string, limit = 10) {
  const source = await findSourcePassage(sourceKey);

  if (!source) {
    return null;
  }

  const embedding = readStoredEmbedding(source as StoredEmbeddingRow);

  if (!embedding) {
    return null;
  }

  const results = await searchByEmbedding(embedding, limit, {
    excludePassageIds: [String(source.id)]
  });

  return {
    results: withMatchStrength(results),
    source: {
      id: String(source.id),
      reference: String(source.reference),
      text: String(source.text)
    } satisfies EarlyChristianSimilarSource
  };
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
  options: { excludePassageIds?: string[] } = {}
) {
  const query = normalizeVector(embedding);
  const chapterCandidates = await searchChapters(query, Math.max(limit * 40, 300));

  if (chapterCandidates.length > 0) {
    const chapterResults = await searchPassagesInChapters(
      query,
      chapterCandidates.map((chapter) => chapter.id),
      limit,
      options.excludePassageIds ?? []
    );

    if (chapterResults.length > 0) {
      return chapterResults;
    }
  }

  return searchAllPassagesExact(query, limit, options.excludePassageIds ?? []);
}

async function searchChapters(embedding: ArrayLike<number>, limit: number) {
  const db = getEarlyChristianDb();

  try {
    const response = await db.execute({
      sql: `
        SELECT c.id, c.embedding
        FROM vector_top_k('early_christian_chapters_embedding_idx', vector32(?), ?) AS v
        JOIN early_christian_chapters c ON c.rowid = v.id
        WHERE c.embedding IS NOT NULL
      `,
      args: [vectorSql(embedding), limit]
    });

    const results = rowsToChapterCandidates(response.rows, embedding, limit);

    if (results.length > 0) {
      return results;
    }
  } catch {
    // Local DBs without the chapter vector index can still exact-scan chapters.
  }

  try {
    const response = await db.execute(`
      SELECT id, embedding
      FROM early_christian_chapters
      WHERE embedding IS NOT NULL
    `);

    return rowsToChapterCandidates(response.rows, embedding, limit);
  } catch {
    return [];
  }
}

async function searchPassagesInChapters(
  embedding: ArrayLike<number>,
  chapterIds: string[],
  limit: number,
  excludePassageIds: string[]
) {
  if (chapterIds.length === 0) {
    return [];
  }

  const excludeClause = excludePassageIds.length
    ? `AND p.id NOT IN (${placeholders(excludePassageIds)})`
    : "";
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

  return groupPassageRowsByChapter(response.rows, embedding, limit);
}

async function searchAllPassagesExact(
  embedding: ArrayLike<number>,
  limit: number,
  excludePassageIds: string[]
) {
  const excludeClause = excludePassageIds.length
    ? `AND p.id NOT IN (${placeholders(excludePassageIds)})`
    : "";
  const response = await getEarlyChristianDb().execute({
    sql: `
      SELECT
        p.id,
        p.reference,
        p.text,
        p.embedding,
        p.verse_start,
        p.verse_end,
        pm.chapter_id,
        p.book || ' ' || p.chapter AS chapter_reference,
        w.title,
        w.author,
        w.authorship_date_range,
        w.ccel_id
      FROM passages p
      LEFT JOIN early_christian_passage_metadata pm ON pm.passage_id = p.id
      LEFT JOIN early_christian_works w ON w.id = pm.work_id
      WHERE p.embedding IS NOT NULL
        ${excludeClause}
    `,
    args: excludePassageIds
  });

  return groupPassageRowsByChapter(response.rows, embedding, limit);
}

async function findSourcePassage(sourceKey: string) {
  const db = getEarlyChristianDb();

  if (/^ecw:[a-f0-9]{24}$/.test(sourceKey)) {
    const response = await db.execute({
      sql: `
        SELECT id, reference, text, embedding
        FROM passages
        WHERE id = ?
          AND embedding IS NOT NULL
      `,
      args: [sourceKey]
    });

    return response.rows[0] ?? null;
  }

  const rangeMatch = sourceKey.match(/^(.+):(\d+)-(\d+)$/);

  if (!rangeMatch) {
    return null;
  }

  const [, chapterId, verseStart, verseEnd] = rangeMatch;
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
    const stored = readStoredEmbedding(row as StoredEmbeddingRow);

    if (!stored) {
      continue;
    }

    const score = cosineSimilarity(embedding, stored);
    const chapterId = String(row.chapter_id ?? "");

    if (!chapterId || !Number.isFinite(score)) {
      continue;
    }

    const candidate: PassageCandidate = {
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
    };
    const current = bestByChapter.get(chapterId);

    if (!current || candidate.score > current.score) {
      bestByChapter.set(chapterId, candidate);
    }
  }

  return [...bestByChapter.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(passageCandidateToSearchResult);
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

function withMatchStrength(results: EarlyChristianSearchResult[]) {
  const scores = results
    .map((result) => result.score)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  const min = scores.length ? Math.min(...scores) : null;
  const max = scores.length ? Math.max(...scores) : null;
  const spread = min !== null && max !== null ? max - min : 0;
  const denominator = Math.max(results.length - 1, 1);

  return results.map((result, index) => {
    let matchStrength = Math.max(1, 4 - Math.floor((index / denominator) * 4));

    if (typeof result.score === "number" && Number.isFinite(result.score)) {
      matchStrength = spread > 0
        ? 1 + Math.round(((result.score - (min ?? result.score)) / spread) * 3)
        : 4;
    }

    return {
      ...result,
      matchStrength: Math.max(1, Math.min(4, matchStrength))
    };
  });
}

function passageRangeLabel(verseStart: number | null, verseEnd: number | null) {
  if (verseStart === null) {
    return "";
  }

  if (verseEnd === null || verseEnd === verseStart) {
    return String(verseStart);
  }

  return `${verseStart}-${verseEnd}`;
}

function readStoredEmbedding(row: StoredEmbeddingRow) {
  if (row.embedding instanceof ArrayBuffer) {
    return row.embedding.byteLength % Float32Array.BYTES_PER_ELEMENT === 0
      ? new Float32Array(row.embedding)
      : null;
  }

  if (ArrayBuffer.isView(row.embedding)) {
    const view = row.embedding as ArrayBufferView;

    return view.byteLength % Float32Array.BYTES_PER_ELEMENT === 0
      ? new Float32Array(view.buffer, view.byteOffset, view.byteLength / Float32Array.BYTES_PER_ELEMENT)
      : null;
  }

  return null;
}

function cosineSimilarity(left: ArrayLike<number>, right: ArrayLike<number>) {
  const length = Math.min(left.length, right.length);
  let sum = 0;

  for (let index = 0; index < length; index += 1) {
    sum += left[index] * right[index];
  }

  return sum;
}

function placeholders(values: unknown[]) {
  return values.map(() => "?").join(", ");
}

function numberOrNull(value: unknown) {
  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}
