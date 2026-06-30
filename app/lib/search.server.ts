import {
  ensureDatabase,
  getDb,
  getIndexedEmbeddingConfig,
  normalizeVector,
  type ScriptureResult,
  vectorSql
} from "./db.server";
import { embedText, getDefaultEmbeddingConfig } from "./embeddings.server";

let vectorSearchTail = Promise.resolve();
const EXACT_BOOK_SEARCH_LIMIT = 12;

type StoredEmbeddingRow = {
  embedding?: unknown;
};

type SearchEmbeddingOptions = {
  excludeIds?: string[];
};

type SimilarScriptureSearch = {
  source: {
    id: string;
    reference: string;
  };
  results: ScriptureResult[];
};

export async function searchScripture(
  question: string,
  limit = 10,
  books: string[] = [],
  options: SearchEmbeddingOptions = {}
): Promise<ScriptureResult[]> {
  const trace = createSearchTrace(question, limit, books);
  await ensureDatabase();
  trace.mark("ensureDatabase");

  const embeddingConfig = await getIndexedEmbeddingConfig() ?? getDefaultEmbeddingConfig();
  trace.mark("embeddingConfig");
  const embedding = await embedText(question, embeddingConfig);
  trace.mark("embedText");

  if (embedding) {
    if (shouldSearchBooksExactly(books)) {
      const bookResults = await searchBookEmbeddingsExact(embedding, limit, books, options);
      trace.mark("searchBookEmbeddingsExact", { count: bookResults.length });
      if (bookResults.length > 0) {
        const results = await attachVerseHighlights(embedding, bookResults);
        trace.finish("book-vector-exact", { count: results.length });
        return results;
      }

      trace.finish("no-vector-results", { count: 0 });
      return [];
    }

    const vectorResults = await runVectorSearchExclusive(
      () => searchVector(embedding, limit, books, options),
      () => trace.mark("searchVectorStart")
    );
    trace.mark("searchVector", { count: vectorResults.length });
    if (vectorResults.length >= Math.min(4, limit)) {
      const results = await attachVerseHighlights(embedding, vectorResults);
      trace.finish("vector", { count: results.length });
      return results;
    }

    trace.finish("no-vector-results", { count: 0 });
    return [];
  }

  trace.finish("no-vector-results", { count: 0 });
  return [];
}

export async function searchSimilarScripture(
  passageId: string,
  limit = 10,
  books: string[] = []
): Promise<SimilarScriptureSearch | null> {
  const trace = createSearchTrace(`similar:${passageId}`, limit, books);
  await ensureDatabase();
  trace.mark("ensureDatabase");

  const sourceResponse = await getDb().execute({
    sql: `
      SELECT id, reference, embedding
      FROM passages
      WHERE id = ?
        AND embedding IS NOT NULL
    `,
    args: [passageId]
  });
  const source = sourceResponse.rows[0];

  if (typeof source?.id !== "string") {
    trace.finish("missing-source", { count: 0 });
    return null;
  }

  const embedding = readStoredEmbedding(source as StoredEmbeddingRow);
  if (!embedding) {
    trace.finish("missing-embedding", { count: 0 });
    return null;
  }

  const options = { excludeIds: [passageId] } satisfies SearchEmbeddingOptions;
  if (shouldSearchBooksExactly(books)) {
    const bookResults = await searchBookEmbeddingsExact(embedding, limit, books, options);
    trace.mark("searchBookEmbeddingsExact", { count: bookResults.length });
    const results = await attachVerseHighlights(embedding, bookResults);
    trace.finish(bookResults.length > 0 ? "book-vector-exact" : "no-vector-results", {
      count: results.length
    });

    return {
      source: {
        id: String(source.id),
        reference: String(source.reference)
      },
      results
    };
  }

  const vectorResults = await runVectorSearchExclusive(
    () => searchVector(embedding, limit, books, options),
    () => trace.mark("searchVectorStart")
  );
  trace.mark("searchVector", { count: vectorResults.length });
  if (vectorResults.length >= Math.min(4, limit)) {
    const results = await attachVerseHighlights(embedding, vectorResults);
    trace.finish("vector", { count: results.length });
    return {
      source: {
        id: String(source.id),
        reference: String(source.reference)
      },
      results
    };
  }

  trace.finish("no-vector-results", { count: 0 });
  return {
    source: {
      id: String(source.id),
      reference: String(source.reference)
    },
    results: []
  };
}

async function attachVerseHighlights(
  embedding: ArrayLike<number>,
  results: ScriptureResult[]
) {
  if (results.length === 0) {
    return results;
  }

  try {
    const db = getDb();
    const paragraphIds = results.map((result) => result.id);
    const paragraphScores = new Map<string, number>();
    const query = normalizeVector(embedding);

    for (const result of results) {
      if (typeof result.score === "number" && Number.isFinite(result.score)) {
        paragraphScores.set(result.id, result.score);
      }
    }

    const missingParagraphScores = results
      .filter((result) => !paragraphScores.has(result.id))
      .map((result) => result.id);

    if (missingParagraphScores.length > 0) {
      const paragraphResponse = await db.execute({
        sql: `
          SELECT id, embedding
          FROM passages
          WHERE id IN (${placeholders(missingParagraphScores)})
            AND embedding IS NOT NULL
        `,
        args: missingParagraphScores
      });

      for (const row of paragraphResponse.rows) {
        const id = String(row.id);
        const stored = readStoredEmbedding(row as StoredEmbeddingRow);

        if (!stored) {
          continue;
        }

        const score = cosineSimilarity(query, stored);

        if (Number.isFinite(score)) {
          paragraphScores.set(id, score);
        }
      }
    }

    const verseResponse = await db.execute({
      sql: `
        SELECT paragraph_id, verse, embedding
        FROM paragraph_verses
        WHERE paragraph_id IN (${placeholders(paragraphIds)})
          AND embedding IS NOT NULL
      `,
      args: paragraphIds
    });
    const bestByParagraph = new Map<string, { score: number; verse: number }>();

    for (const row of verseResponse.rows) {
      const paragraphId = String(row.paragraph_id);
      const verse = Number(row.verse);
      const stored = readStoredEmbedding(row as StoredEmbeddingRow);

      if (!stored) {
        continue;
      }

      const score = cosineSimilarity(query, stored);
      const current = bestByParagraph.get(paragraphId);

      if (Number.isFinite(score) && (!current || score > current.score)) {
        bestByParagraph.set(paragraphId, { score, verse });
      }
    }

    return results.map((result) => {
      const paragraphScore = paragraphScores.get(result.id);

      return {
        ...result,
        score: paragraphScore ?? result.score,
        highlightVerse: getHighlightVerse(result.id, paragraphScores, bestByParagraph)
      };
    });
  } catch {
    return results;
  }
}

function getHighlightVerse(
  paragraphId: string,
  paragraphScores: Map<string, number>,
  bestByParagraph: Map<string, { score: number; verse: number }>
) {
  const paragraphScore = paragraphScores.get(paragraphId);
  const bestVerse = bestByParagraph.get(paragraphId);

  if (!bestVerse || typeof paragraphScore !== "number") {
    return undefined;
  }

  return bestVerse.score > paragraphScore ? bestVerse.verse : undefined;
}

async function searchVector(
  embedding: ArrayLike<number>,
  limit: number,
  books: string[],
  options: SearchEmbeddingOptions = {}
) {
  const db = getDb();
  const excludeIds = options.excludeIds ?? [];
  const candidateLimit = Math.max(limit * 40, 300);
  const bookClause = books.length ? `AND p.book IN (${placeholders(books)})` : "";
  const excludeClause = excludeIds.length ? `AND p.id NOT IN (${placeholders(excludeIds)})` : "";

  try {
    const response = await db.execute({
      sql: `
        SELECT p.id, p.reference, p.result_type, p.embedding
        FROM vector_top_k('passages_embedding_idx', vector32(?), ?) AS v
        JOIN passages p ON p.rowid = v.id
        WHERE p.text <> ''
          ${bookClause}
          ${excludeClause}
        LIMIT ?
      `,
      args: [
        vectorSql(embedding),
        candidateLimit,
        ...books,
        ...excludeIds,
        limit
      ]
    });

    const query = normalizeVector(embedding);
    const results: ScriptureResult[] = [];

    for (const row of response.rows) {
      const stored = readStoredEmbedding(row as StoredEmbeddingRow);

      if (!stored) {
        continue;
      }

      const score = cosineSimilarity(query, stored);

      if (!Number.isFinite(score)) {
        continue;
      }

      results.push({
        id: String(row.id),
        reference: String(row.reference),
        type: "paragraph",
        score
      });
    }

    return results
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
      .slice(0, limit);
  } catch {
    if (process.env.SEARCH_TRACE === "1") {
      console.info(
        JSON.stringify({
          type: "search-timing",
          label: "searchVectorError",
          limit,
          bookCount: books.length
        })
      );
    }
    return [];
  }
}

async function searchBookEmbeddingsExact(
  embedding: ArrayLike<number>,
  limit: number,
  books: string[],
  options: SearchEmbeddingOptions = {}
) {
  const db = getDb();
  const query = normalizeVector(embedding);
  const excludeIds = options.excludeIds ?? [];
  const response = await db.execute({
    sql: `
      SELECT id, reference, result_type, embedding
      FROM passages
      WHERE embedding IS NOT NULL
        AND book IN (${placeholders(books)})
        ${excludeIds.length ? `AND id NOT IN (${placeholders(excludeIds)})` : ""}
    `,
    args: [...books, ...excludeIds]
  });
  const results: ScriptureResult[] = [];

  for (const row of response.rows) {
    const stored = readStoredEmbedding(row as StoredEmbeddingRow);

    if (!stored) {
      continue;
    }

    const score = cosineSimilarity(query, stored);

    if (!Number.isFinite(score)) {
      continue;
    }

    results.push({
      id: String(row.id),
      reference: String(row.reference),
      type: "paragraph",
      score
    });
  }

  return results
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, limit);
}

function shouldSearchBooksExactly(books: string[]) {
  return books.length > 0 && books.length <= EXACT_BOOK_SEARCH_LIMIT;
}

async function runVectorSearchExclusive<T>(
  operation: () => Promise<T>,
  onStart: () => void
) {
  const previous = vectorSearchTail;
  let release = () => {};

  vectorSearchTail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous.catch(() => undefined);
  onStart();

  try {
    return await operation();
  } finally {
    release();
  }
}

function placeholders(values: unknown[]) {
  return values.map(() => "?").join(", ");
}

function readStoredEmbedding(row: StoredEmbeddingRow) {
  const vector = readEmbeddingBlob(row.embedding);

  if (vector) {
    return vector;
  }

  return null;
}

function readEmbeddingBlob(value: unknown) {
  if (value instanceof ArrayBuffer) {
    return value.byteLength % Float32Array.BYTES_PER_ELEMENT === 0
      ? new Float32Array(value)
      : null;
  }

  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;

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

function createSearchTrace(question: string, limit: number, books: string[]) {
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
        label,
        elapsedMs: elapsed(now),
        deltaMs: delta(now),
        limit,
        bookCount: books.length,
        queryLength: question.length,
        ...details
      })
    );
    previous = now;
  }

  return {
    mark: log,
    finish(label: string, details: Record<string, unknown> = {}) {
      log("finish", { branch: label, ...details });
    }
  };
}
