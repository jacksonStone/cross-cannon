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
let passageEmbeddingCache: Promise<CachedPassageEmbedding[]> | null = null;

type CachedPassageEmbedding = {
  id: string;
  reference: string;
  book: string;
  vector: Float32Array;
};

export async function searchScripture(
  question: string,
  limit = 10,
  books: string[] = []
): Promise<ScriptureResult[]> {
  const trace = createSearchTrace(question, limit, books);
  await ensureDatabase();
  trace.mark("ensureDatabase");

  const embeddingConfig = await getIndexedEmbeddingConfig() ?? getDefaultEmbeddingConfig();
  trace.mark("embeddingConfig");
  const embedding = await embedText(question, embeddingConfig);
  trace.mark("embedText");

  if (embedding) {
    const cachedResults = await searchCachedEmbeddings(embedding, limit, books);
    trace.mark("searchCachedEmbeddings", { count: cachedResults.length });
    if (cachedResults.length >= Math.min(4, limit)) {
      const results = await attachVerseHighlights(embedding, cachedResults);
      trace.finish("cached-vector", { count: results.length });
      return results;
    }

    const vectorResults = await runVectorSearchExclusive(
      () => searchVector(embedding, limit, books),
      () => trace.mark("searchVectorStart")
    );
    trace.mark("searchVector", { count: vectorResults.length });
    if (vectorResults.length >= Math.min(4, limit)) {
      const results = await attachVerseHighlights(embedding, vectorResults);
      trace.finish("vector", { count: results.length });
      return results;
    }

    const bruteForceResults = books.length > 0
      ? []
      : await searchStoredEmbeddings(embedding, limit, books);
    trace.mark("searchStoredEmbeddings", { count: bruteForceResults.length });
    if (bruteForceResults.length >= Math.min(4, limit)) {
      const results = await attachVerseHighlights(embedding, bruteForceResults);
      trace.finish("stored-vector", { count: results.length });
      return results;
    }
  }

  const results = await searchLexical(question, limit, books);
  trace.finish("lexical", { count: results.length });
  return results;
}

async function attachVerseHighlights(embedding: number[], results: ScriptureResult[]) {
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
          SELECT id, embedding_json
          FROM passages
          WHERE id IN (${placeholders(missingParagraphScores)})
            AND embedding_json IS NOT NULL
        `,
        args: missingParagraphScores
      });

      for (const row of paragraphResponse.rows) {
        const id = String(row.id);
        const stored = parseEmbedding(String(row.embedding_json ?? "[]"));
        const score = cosineSimilarity(query, normalizeVector(stored));

        if (Number.isFinite(score)) {
          paragraphScores.set(id, score);
        }
      }
    }

    const verseResponse = await db.execute({
      sql: `
        SELECT paragraph_id, verse, embedding_json
        FROM paragraph_verses
        WHERE paragraph_id IN (${placeholders(paragraphIds)})
          AND embedding_json IS NOT NULL
      `,
      args: paragraphIds
    });
    const bestByParagraph = new Map<string, { score: number; verse: number }>();

    for (const row of verseResponse.rows) {
      const paragraphId = String(row.paragraph_id);
      const verse = Number(row.verse);
      const stored = parseEmbedding(String(row.embedding_json ?? "[]"));
      const score = cosineSimilarity(query, normalizeVector(stored));
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

async function searchVector(embedding: number[], limit: number, books: string[]) {
  const db = getDb();
  const candidateLimit = books.length ? Math.max(limit * 40, 300) : limit;
  const bookClause = books.length ? `AND p.book IN (${placeholders(books)})` : "";

  try {
    const response = await db.execute({
      sql: `
        SELECT p.id, p.reference, p.result_type
        FROM vector_top_k('passages_embedding_idx', vector32(?), ?) AS v
        JOIN passages p ON p.rowid = v.id
        WHERE p.text <> ''
          ${bookClause}
        LIMIT ?
      `,
      args: books.length
        ? [vectorSql(embedding), candidateLimit, ...books, limit]
        : [vectorSql(embedding), candidateLimit, limit]
    });

    return response.rows.map((row) => ({
      id: String(row.id),
      reference: String(row.reference),
      type: "paragraph"
    })) satisfies ScriptureResult[];
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

async function searchCachedEmbeddings(embedding: number[], limit: number, books: string[]) {
  const query = normalizeVector(embedding);
  const bookFilter = books.length > 0 ? new Set(books) : null;
  const passages = await getPassageEmbeddingCache();
  const topResults: ScriptureResult[] = [];

  for (const passage of passages) {
    if (bookFilter && !bookFilter.has(passage.book)) {
      continue;
    }

    const score = cosineSimilarity(query, passage.vector);

    if (!Number.isFinite(score)) {
      continue;
    }

    insertTopResult(topResults, {
      id: passage.id,
      reference: passage.reference,
      type: "paragraph",
      score
    }, limit);
  }

  return topResults;
}

async function getPassageEmbeddingCache() {
  passageEmbeddingCache ??= loadPassageEmbeddingCache();
  return passageEmbeddingCache;
}

async function loadPassageEmbeddingCache() {
  const response = await getDb().execute(`
    SELECT id, reference, book, embedding_json
    FROM passages
    WHERE embedding_json IS NOT NULL
  `);

  return response.rows.flatMap((row) => {
    const parsed = parseEmbedding(String(row.embedding_json ?? "[]"));

    if (parsed.length === 0) {
      return [];
    }

    return {
      id: String(row.id),
      reference: String(row.reference),
      book: String(row.book),
      vector: Float32Array.from(parsed)
    };
  });
}

async function searchStoredEmbeddings(embedding: number[], limit: number, books: string[]) {
  const db = getDb();
  const query = normalizeVector(embedding);
  const response = await db.execute({
    sql: `
      SELECT id, reference, result_type, embedding_json
      FROM passages
      WHERE embedding_json IS NOT NULL
        ${books.length ? `AND book IN (${placeholders(books)})` : ""}
    `,
    args: books
  });

  const topResults: ScriptureResult[] = [];

  for (const row of response.rows) {
    const stored = parseEmbedding(String(row.embedding_json ?? "[]"));
    const score = cosineSimilarity(query, normalizeVector(stored));

    if (!Number.isFinite(score)) {
      continue;
    }

    insertTopResult(topResults, {
      id: String(row.id),
      reference: String(row.reference),
      type: "paragraph",
      score
    }, limit);
  }

  return topResults;
}

async function searchLexical(question: string, limit: number, books: string[]) {
  const db = getDb();
  const ftsQuery = toFtsQuery(question);
  const bookClause = books.length ? `AND p.book IN (${placeholders(books)})` : "";

  if (ftsQuery) {
    try {
      const response = await db.execute({
        sql: `
          SELECT p.id, p.reference, p.result_type
          FROM passages_fts
          JOIN passages p ON passages_fts.rowid = p.rowid
          WHERE passages_fts MATCH ?
            ${bookClause}
          ORDER BY bm25(passages_fts)
          LIMIT ?
        `,
        args: books.length ? [ftsQuery, ...books, limit] : [ftsQuery, limit]
      });

      if (response.rows.length > 0) {
        return response.rows.map((row) => ({
          id: String(row.id),
          reference: String(row.reference),
          type: "paragraph"
        })) satisfies ScriptureResult[];
      }
    } catch {
      // Fall through to LIKE search for malformed FTS input or local SQLite gaps.
    }
  }

  const terms = extractTerms(question).slice(0, 5);
  if (terms.length === 0) {
    return [];
  }

  const where = terms.map(() => "LOWER(text || ' ' || reference) LIKE ?").join(" OR ");
  const response = await db.execute({
    sql: `
      SELECT id, reference, result_type
      FROM passages
      WHERE (${where})
        ${books.length ? `AND book IN (${placeholders(books)})` : ""}
      LIMIT ?
    `,
    args: books.length
      ? [...terms.map((term) => `%${term}%`), ...books, limit]
      : [...terms.map((term) => `%${term}%`), limit]
  });

  return response.rows.map((row) => ({
    id: String(row.id),
    reference: String(row.reference),
    type: "paragraph"
  })) satisfies ScriptureResult[];
}

function placeholders(values: unknown[]) {
  return values.map(() => "?").join(", ");
}

function extractTerms(input: string) {
  const stopWords = new Set([
    "about",
    "does",
    "what",
    "where",
    "when",
    "which",
    "scripture",
    "bible",
    "verse",
    "verses",
    "chapter",
    "chapters",
    "the",
    "and",
    "for",
    "with"
  ]);

  return Array.from(new Set(input.toLowerCase().match(/[a-z0-9]+/g) ?? []))
    .filter((term) => term.length > 2 && !stopWords.has(term));
}

function toFtsQuery(input: string) {
  return extractTerms(input)
    .slice(0, 8)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" OR ");
}

function parseEmbedding(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(Number) : [];
  } catch {
    return [];
  }
}

function cosineSimilarity(left: ArrayLike<number>, right: ArrayLike<number>) {
  const length = Math.min(left.length, right.length);
  let sum = 0;

  for (let index = 0; index < length; index += 1) {
    sum += left[index] * right[index];
  }

  return sum;
}

function insertTopResult(results: ScriptureResult[], result: ScriptureResult, limit: number) {
  const score = result.score ?? Number.NEGATIVE_INFINITY;
  const insertAt = results.findIndex(
    (existing) => score > (existing.score ?? Number.NEGATIVE_INFINITY)
  );

  if (insertAt === -1) {
    if (results.length < limit) {
      results.push(result);
    }
    return;
  }

  results.splice(insertAt, 0, result);

  if (results.length > limit) {
    results.pop();
  }
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
