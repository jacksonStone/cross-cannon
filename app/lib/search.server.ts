import { ensureDatabase, getDb, normalizeVector, type ScriptureResult, vectorSql } from "./db.server";
import { embedText } from "./embeddings.server";

export async function searchScripture(question: string, limit = 10): Promise<ScriptureResult[]> {
  await ensureDatabase();

  const embedding = await embedText(question);

  if (embedding) {
    const vectorResults = await searchVector(embedding, limit);
    if (vectorResults.length >= Math.min(4, limit)) {
      return vectorResults;
    }

    const bruteForceResults = await searchStoredEmbeddings(embedding, limit);
    if (bruteForceResults.length >= Math.min(4, limit)) {
      return bruteForceResults;
    }
  }

  return searchLexical(question, limit);
}

async function searchVector(embedding: number[], limit: number) {
  const db = getDb();

  try {
    const response = await db.execute({
      sql: `
        SELECT p.reference, p.text, p.result_type
        FROM vector_top_k('passages_embedding_idx', vector32(?), ?)
        JOIN passages p ON p.rowid = id
        WHERE p.text <> ''
        LIMIT ?
      `,
      args: [vectorSql(embedding), limit, limit]
    });

    return response.rows.map((row) => ({
      reference: String(row.reference),
      text: String(row.text),
      type: row.result_type === "chapter" ? "chapter" : "verse"
    })) satisfies ScriptureResult[];
  } catch {
    return [];
  }
}

async function searchStoredEmbeddings(embedding: number[], limit: number) {
  const db = getDb();
  const query = normalizeVector(embedding);
  const response = await db.execute(`
    SELECT reference, text, result_type, embedding_json
    FROM passages
    WHERE embedding_json IS NOT NULL
  `);

  return response.rows
    .map((row) => {
      const stored = parseEmbedding(String(row.embedding_json ?? "[]"));

      return {
        reference: String(row.reference),
        text: String(row.text),
        type: row.result_type === "chapter" ? "chapter" as const : "verse" as const,
        score: cosineSimilarity(query, normalizeVector(stored))
      };
    })
    .filter((result) => Number.isFinite(result.score))
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, limit);
}

async function searchLexical(question: string, limit: number) {
  const db = getDb();
  const ftsQuery = toFtsQuery(question);

  if (ftsQuery) {
    try {
      const response = await db.execute({
        sql: `
          SELECT p.reference, p.text, p.result_type
          FROM passages_fts
          JOIN passages p ON passages_fts.rowid = p.rowid
          WHERE passages_fts MATCH ?
          ORDER BY bm25(passages_fts)
          LIMIT ?
        `,
        args: [ftsQuery, limit]
      });

      if (response.rows.length > 0) {
        return response.rows.map((row) => ({
          reference: String(row.reference),
          text: String(row.text),
          type: row.result_type === "chapter" ? "chapter" : "verse"
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
      SELECT reference, text, result_type
      FROM passages
      WHERE ${where}
      LIMIT ?
    `,
    args: [...terms.map((term) => `%${term}%`), limit]
  });

  return response.rows.map((row) => ({
    reference: String(row.reference),
    text: String(row.text),
    type: row.result_type === "chapter" ? "chapter" : "verse"
  })) satisfies ScriptureResult[];
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
