import { createClient } from "@libsql/client";
import OpenAI from "openai";

import { normalizeVector, vectorSql } from "../app/lib/db.server";
import { getDefaultEmbeddingConfig } from "../app/lib/embeddings.server";

type StoredEmbeddingRow = {
  embedding?: unknown;
};

type ResultRow = {
  id: string;
  reference: string;
  text: string;
  score: number;
  author: string | null;
  date: string | null;
  source: string;
};

const options = parseArgs(process.argv.slice(2));
const db = createClient({ url: options.dbUrl });
const embeddingConfig = await getEmbeddingConfig();
const queryEmbedding = normalizeVector(await embedQuery(options.query, embeddingConfig));
const results = await search(queryEmbedding, options.limit);

console.log(JSON.stringify({
  query: options.query,
  db: options.dbUrl,
  embeddingModel: embeddingConfig.model,
  embeddingDimensions: embeddingConfig.dimensions,
  results
}, null, 2));

function parseArgs(args: string[]) {
  let query = "";
  let limit = 10;
  let dbUrl = process.env.EARLY_CHRISTIAN_DATABASE_URL
    ?? process.env.CHURCH_FATHERS_DATABASE_URL
    ?? "file:./storage/early-christian-works.db";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--db" && next) {
      dbUrl = /^[a-z]+:/i.test(next) ? next : `file:${next}`;
      index += 1;
      continue;
    }

    if (arg === "--limit" && next) {
      limit = Number(next);
      index += 1;
      continue;
    }

    if (!arg.startsWith("--")) {
      query = [query, arg].filter(Boolean).join(" ");
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!query.trim()) {
    throw new Error("Provide a query, e.g. npm run query:church-fathers -- \"mercy and repentance\"");
  }

  return { dbUrl, limit, query };
}

async function getEmbeddingConfig() {
  const response = await db.execute(`
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

  return getDefaultEmbeddingConfig();
}

async function embedQuery(
  text: string,
  config: { model: string; dimensions: number }
) {
  if (process.env.EMBEDDING_PROVIDER === "mock") {
    return mockEmbedding(text, config.dimensions);
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to query with real embeddings.");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.embeddings.create({
    dimensions: config.dimensions,
    encoding_format: "float",
    input: text,
    model: config.model
  });

  return response.data[0]?.embedding ?? [];
}

async function search(queryEmbedding: number[], limit: number): Promise<ResultRow[]> {
  const candidateLimit = Math.max(limit * 40, 300);

  try {
    const response = await db.execute({
      sql: `
        SELECT
          p.id,
          p.reference,
          p.text,
          p.embedding,
          w.author,
          w.authorship_date_range,
          w.ccel_id
        FROM vector_top_k('passages_embedding_idx', vector32(?), ?) AS v
        JOIN passages p ON p.rowid = v.id
        LEFT JOIN early_christian_passage_metadata pm ON pm.passage_id = p.id
        LEFT JOIN early_christian_works w ON w.id = pm.work_id
        WHERE p.text <> ''
        LIMIT ?
      `,
      args: [vectorSql(queryEmbedding), candidateLimit, limit]
    });

    const results = rowsToResults(response.rows, queryEmbedding, limit);

    if (results.length > 0) {
      return results;
    }
  } catch {
    // Fall through to exact scan below.
  }

  const response = await db.execute(`
    SELECT
      p.id,
      p.reference,
      p.text,
      p.embedding,
      w.author,
      w.authorship_date_range,
      w.ccel_id
    FROM passages p
    LEFT JOIN early_christian_passage_metadata pm ON pm.passage_id = p.id
    LEFT JOIN early_christian_works w ON w.id = pm.work_id
    WHERE p.embedding IS NOT NULL
  `);

  return rowsToResults(response.rows, queryEmbedding, limit);
}

function rowsToResults(rows: unknown[], queryEmbedding: number[], limit: number): ResultRow[] {
  const results: ResultRow[] = [];

  for (const row of rows as Array<Record<string, unknown>>) {
    const stored = readStoredEmbedding(row as StoredEmbeddingRow);

    if (!stored) {
      continue;
    }

    const score = cosineSimilarity(queryEmbedding, stored);

    if (!Number.isFinite(score)) {
      continue;
    }

    results.push({
      author: typeof row.author === "string" ? row.author : null,
      date: typeof row.authorship_date_range === "string" ? row.authorship_date_range : null,
      id: String(row.id),
      reference: String(row.reference),
      score,
      source: String(row.ccel_id ?? ""),
      text: String(row.text)
    });
  }

  return results
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
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

function mockEmbedding(text: string, dimensions: number) {
  const vector = Array.from({ length: dimensions }, () => 0);
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

  for (const word of words) {
    let hash = 2166136261;
    for (let index = 0; index < word.length; index += 1) {
      hash ^= word.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    vector[Math.abs(hash) % dimensions] += 1;
  }

  return vector;
}
