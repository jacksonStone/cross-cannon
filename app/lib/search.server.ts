import { ensureDatabase, getDb, normalizeVector, type ScriptureResult, vectorSql } from "./db.server";
import { embedText } from "./embeddings.server";

export async function searchScripture(
  question: string,
  limit = 10,
  books: string[] = []
): Promise<ScriptureResult[]> {
  await ensureDatabase();

  const embedding = await embedText(question);

  if (embedding) {
    const vectorResults = await searchVector(embedding, limit, books);
    if (vectorResults.length >= Math.min(4, limit)) {
      return attachVerseHighlights(embedding, vectorResults);
    }

    const bruteForceResults = await searchStoredEmbeddings(embedding, limit, books);
    if (bruteForceResults.length >= Math.min(4, limit)) {
      return attachVerseHighlights(embedding, bruteForceResults);
    }
  }

  return searchLexical(question, limit, books);
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
        FROM vector_top_k('passages_embedding_idx', vector32(?), ?)
        JOIN passages p ON p.rowid = id
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
    return [];
  }
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

  return response.rows
    .map((row) => {
      const stored = parseEmbedding(String(row.embedding_json ?? "[]"));

      return {
        id: String(row.id),
        reference: String(row.reference),
        type: "paragraph" as const,
        score: cosineSimilarity(query, normalizeVector(stored))
      };
    })
    .filter((result) => Number.isFinite(result.score))
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, limit);
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

function cosineSimilarity(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  let sum = 0;

  for (let index = 0; index < length; index += 1) {
    sum += left[index] * right[index];
  }

  return sum;
}
