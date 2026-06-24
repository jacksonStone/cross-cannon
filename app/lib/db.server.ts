import { createClient, type Client } from "@libsql/client";

let client: Client | null = null;
let schemaReady = false;

export type ScriptureResult = {
  id: string;
  reference: string;
  type: "paragraph";
  highlightVerse?: number;
  score?: number;
};

export function getDb() {
  if (!client) {
    client = createClient({
      url: process.env.DATABASE_URL ?? "file:./storage/crosscannon.db",
      authToken: process.env.TURSO_AUTH_TOKEN
    });
  }

  return client;
}

export async function ensureDatabase() {
  if (schemaReady) {
    return;
  }

  const db = getDb();
  await ensureParagraphSchema(db);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS passages (
      id TEXT PRIMARY KEY,
      result_type TEXT NOT NULL CHECK (result_type IN ('paragraph')),
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      verse_start INTEGER,
      verse_end INTEGER,
      reference TEXT NOT NULL,
      text TEXT NOT NULL,
      embedding F32_BLOB(1536),
      embedding_json TEXT,
      source_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS passages_reference_idx
    ON passages(book, chapter, verse_start)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS paragraph_verses (
      paragraph_id TEXT NOT NULL,
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      verse INTEGER NOT NULL,
      reference TEXT NOT NULL,
      text TEXT NOT NULL,
      embedding F32_BLOB(1536),
      embedding_json TEXT,
      source_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (paragraph_id, verse)
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS paragraph_verses_reference_idx
    ON paragraph_verses(book, chapter, verse)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS paragraph_verses_paragraph_idx
    ON paragraph_verses(paragraph_id)
  `);

  await db.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS passages_fts
    USING fts5(reference, text, content='passages', content_rowid='rowid')
  `);

  try {
    await db.execute(`
      CREATE INDEX IF NOT EXISTS passages_embedding_idx
      ON passages(libsql_vector_idx(embedding))
    `);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Vector index unavailable; lexical and brute-force search remain enabled.");
    }
  }

  schemaReady = true;
}

async function ensureParagraphSchema(db: Client) {
  const response = await db.execute(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table' AND name = 'passages'
  `);
  const createSql = String(response.rows[0]?.sql ?? "");

  if (!createSql || createSql.includes("'paragraph'")) {
    return;
  }

  await dropSearchIndexes(db);
  await db.execute("DROP TABLE IF EXISTS passages_fts");
  await db.execute("ALTER TABLE passages RENAME TO passages_old");
  await db.execute(`
    CREATE TABLE passages (
      id TEXT PRIMARY KEY,
      result_type TEXT NOT NULL CHECK (result_type IN ('paragraph')),
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      verse_start INTEGER,
      verse_end INTEGER,
      reference TEXT NOT NULL,
      text TEXT NOT NULL,
      embedding F32_BLOB(1536),
      embedding_json TEXT,
      source_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute("DROP TABLE passages_old");
}

async function dropSearchIndexes(db: Client) {
  for (const sql of [
    "DROP INDEX IF EXISTS passages_embedding_idx",
    "DROP INDEX IF EXISTS passages_embedding_idx_shadow_idx",
    "DROP TABLE IF EXISTS passages_embedding_idx_shadow"
  ]) {
    try {
      await db.execute(sql);
    } catch {
      // Existing local DBs may have partially rebuilt libSQL vector shadow state.
    }
  }
}

export function normalizeVector(vector: number[]) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  if (!norm) {
    return vector;
  }

  return vector.map((value) => value / norm);
}

export function vectorSql(vector: number[]) {
  return `[${vector.map((value) => Number(value.toFixed(8))).join(",")}]`;
}
