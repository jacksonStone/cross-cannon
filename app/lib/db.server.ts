import { createClient, type Client } from "@libsql/client";

import { buildAudioChapterFiles } from "./audio-chapters.server";

let client: Client | null = null;
let schemaReady = false;

export type ScriptureResult = {
  id: string;
  reference: string;
  type: "paragraph";
  highlightVerse?: number;
  score?: number;
};

export type IndexedEmbeddingConfig = {
  model: string;
  dimensions: number;
};

export function getDb() {
  if (!client) {
    client = createClient({
      url: process.env.DATABASE_URL ?? "file:./storage/crosscannon.db"
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
      source_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS passages_reference_idx
    ON passages(book, chapter, verse_start)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS passages_book_idx
    ON passages(book)
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

  await ensureEmbeddingBlobColumn(db, "passages");
  await ensureEmbeddingBlobColumn(db, "paragraph_verses");
  await dropLegacyEmbeddingJsonColumns(db);
  await dropLegacyTextSearchIndex(db);
  await ensureEmbeddingConfigTable(db);
  await ensureAudioSchema(db);

  try {
    await db.execute(`
      CREATE INDEX IF NOT EXISTS passages_embedding_idx
      ON passages(libsql_vector_idx(embedding))
    `);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Vector index unavailable; semantic search requires a rebuilt vector index.");
    }
  }

  schemaReady = true;
}

export async function getIndexedEmbeddingConfig() {
  await ensureDatabase();

  const response = await getDb().execute(`
    SELECT model, dimensions
    FROM scripture_embedding_config
    WHERE id = 'active'
  `);
  const row = response.rows[0];

  if (typeof row?.model !== "string") {
    return null;
  }

  return {
    model: row.model,
    dimensions: Number(row.dimensions)
  } satisfies IndexedEmbeddingConfig;
}

export async function setIndexedEmbeddingConfig(
  db: Client,
  config: IndexedEmbeddingConfig
) {
  await ensureEmbeddingConfigTable(db);
  await db.execute({
    sql: `
      INSERT INTO scripture_embedding_config (id, model, dimensions, updated_at)
      VALUES ('active', ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        model = excluded.model,
        dimensions = excluded.dimensions,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [config.model, config.dimensions]
  });
}

export async function syncPassageAudioFile(db: Client, passageId: string) {
  await db.execute({
    sql: `
      INSERT INTO passage_audio_files (
        passage_id,
        book,
        chapter,
        audio_source,
        audio_file_name,
        audio_file_path,
        audio_url
      )
      SELECT
        p.id,
        p.book,
        p.chapter,
        a.source,
        a.file_name,
        a.file_path,
        a.audio_url
      FROM passages p
      JOIN audio_chapter_files a
        ON a.book = p.book
       AND a.chapter = p.chapter
      WHERE p.id = ?
      ON CONFLICT(passage_id) DO UPDATE SET
        book = excluded.book,
        chapter = excluded.chapter,
        audio_source = excluded.audio_source,
        audio_file_name = excluded.audio_file_name,
        audio_file_path = excluded.audio_file_path,
        audio_url = excluded.audio_url,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [passageId]
  });
}

export async function syncPassageAudioFiles(db: Client) {
  await db.execute(`
    INSERT INTO passage_audio_files (
      passage_id,
      book,
      chapter,
      audio_source,
      audio_file_name,
      audio_file_path,
      audio_url
    )
    SELECT
      p.id,
      p.book,
      p.chapter,
      a.source,
      a.file_name,
      a.file_path,
      a.audio_url
    FROM passages p
    JOIN audio_chapter_files a
      ON a.book = p.book
     AND a.chapter = p.chapter
    ON CONFLICT(passage_id) DO UPDATE SET
      book = excluded.book,
      chapter = excluded.chapter,
      audio_source = excluded.audio_source,
      audio_file_name = excluded.audio_file_name,
      audio_file_path = excluded.audio_file_path,
      audio_url = excluded.audio_url,
      updated_at = CURRENT_TIMESTAMP
  `);
}

async function ensureEmbeddingConfigTable(db: Client) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS scripture_embedding_config (
      id TEXT PRIMARY KEY CHECK (id = 'active'),
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function ensureAudioSchema(db: Client) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS audio_chapter_files (
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      source TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      audio_url TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (book, chapter)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS passage_audio_files (
      passage_id TEXT PRIMARY KEY,
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      audio_source TEXT NOT NULL,
      audio_file_name TEXT NOT NULL,
      audio_file_path TEXT NOT NULL,
      audio_url TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE CASCADE,
      FOREIGN KEY (book, chapter) REFERENCES audio_chapter_files(book, chapter)
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS passage_audio_files_reference_idx
    ON passage_audio_files(book, chapter)
  `);

  for (const audioFile of buildAudioChapterFiles()) {
    await db.execute({
      sql: `
        INSERT INTO audio_chapter_files (
          book,
          chapter,
          source,
          file_name,
          file_path,
          audio_url
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(book, chapter) DO UPDATE SET
          source = excluded.source,
          file_name = excluded.file_name,
          file_path = excluded.file_path,
          audio_url = excluded.audio_url,
          updated_at = CURRENT_TIMESTAMP
      `,
      args: [
        audioFile.book,
        audioFile.chapter,
        audioFile.source,
        audioFile.fileName,
        audioFile.filePath,
        audioFile.audioUrl
      ]
    });
  }

  await syncPassageAudioFiles(db);
}

async function ensureEmbeddingBlobColumn(db: Client, tableName: "passages" | "paragraph_verses") {
  const response = await db.execute(`PRAGMA table_info(${tableName})`);
  const hasEmbeddingColumn = response.rows.some((row) => row.name === "embedding");

  if (hasEmbeddingColumn) {
    return;
  }

  await db.execute(`ALTER TABLE ${tableName} ADD COLUMN embedding F32_BLOB(1536)`);
}

async function dropLegacyEmbeddingJsonColumns(db: Client) {
  let droppedColumn = false;

  for (const tableName of ["passages", "paragraph_verses"] as const) {
    const tableInfo = await db.execute(`PRAGMA table_info(${tableName})`);
    const hasEmbeddingJsonColumn = tableInfo.rows.some((row) => row.name === "embedding_json");

    if (!hasEmbeddingJsonColumn) {
      continue;
    }

    if (!droppedColumn) {
      await dropSearchIndexes(db);
    }

    const missingResponse = await db.execute(`
      SELECT COUNT(*) AS count
      FROM ${tableName}
      WHERE embedding IS NULL
        AND embedding_json IS NOT NULL
    `);
    const missingCount = Number(missingResponse.rows[0]?.count ?? 0);

    if (missingCount === 0) {
      continue;
    }

    await db.execute(`
      UPDATE ${tableName}
      SET embedding = vector32(embedding_json)
      WHERE embedding IS NULL
        AND embedding_json IS NOT NULL
    `);

    await db.execute(`ALTER TABLE ${tableName} DROP COLUMN embedding_json`);
    droppedColumn = true;
  }
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
      source_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute("DROP TABLE passages_old");
}

async function dropLegacyTextSearchIndex(db: Client) {
  try {
    await db.execute("DROP TABLE IF EXISTS passages_fts");
  } catch {
    // Older local DBs may not have FTS support available in every runtime.
  }
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

export function normalizeVector(vector: ArrayLike<number>) {
  let normSquared = 0;

  for (let index = 0; index < vector.length; index += 1) {
    normSquared += vector[index] * vector[index];
  }

  const norm = Math.sqrt(normSquared);

  if (!norm) {
    return Array.from(vector);
  }

  return Array.from(vector, (value) => value / norm);
}

export function vectorSql(vector: ArrayLike<number>) {
  return `[${Array.from(vector, (value) => Number(value.toFixed(8))).join(",")}]`;
}
