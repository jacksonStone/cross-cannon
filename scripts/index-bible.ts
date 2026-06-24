import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createClient, type Client } from "@libsql/client";

import { ensureDatabase, getDb, normalizeVector, vectorSql } from "../app/lib/db.server";
import { embedText } from "../app/lib/embeddings.server";

type PassageType = "paragraph";

type Verse = {
  book: string;
  chapter: number;
  verse: number;
  text: string;
};

type Passage = {
  id: string;
  resultType: PassageType;
  book: string;
  chapter: number;
  verseStart: number | null;
  verseEnd: number | null;
  reference: string;
  text: string;
  verses: Verse[];
  sourceHash: string;
};

type Options = {
  inputPath: string;
  runtimeDbUrl: string;
  jobsDbUrl: string;
  archive: boolean;
  reset: boolean;
  resume: boolean;
  limit: number | null;
  passageType: PassageType | "all";
  book: string | null;
  skipParagraphEmbeddings: boolean;
  skipIndexRebuild: boolean;
  rebuildIndexesOnly: boolean;
};

const options = parseArgs(process.argv.slice(2));
process.env.DATABASE_URL = options.runtimeDbUrl;

if (options.archive) {
  await archiveLocalDbs([options.runtimeDbUrl, options.jobsDbUrl]);
}

const absoluteInputPath = path.resolve(options.inputPath);
const raw = await readFile(absoluteInputPath, "utf8");
const sourceHash = stableId(raw);
const parsed = JSON.parse(raw);
const verses = normalizeBibleJson(parsed);
const passages = buildPassages(verses)
  .filter((passage) =>
    options.passageType === "all" ? true : passage.resultType === options.passageType
  )
  .filter((passage) =>
    options.book ? normalizeBookName(passage.book) === normalizeBookName(options.book) : true
  );

if (passages.length === 0) {
  throw new Error(`No passages found in ${absoluteInputPath}`);
}

await ensureDatabase();
const runtimeDb = getDb();
const jobsDb = createClient({ url: options.jobsDbUrl });
await setBusyTimeout(runtimeDb);
await setBusyTimeout(jobsDb);
await ensureJobsDatabase(jobsDb);

if (options.rebuildIndexesOnly) {
  await rebuildFts(runtimeDb);
  await rebuildVectorIndex(runtimeDb);
  console.log(`Rebuilt search indexes for ${options.runtimeDbUrl}`);
  process.exit(0);
}

if (options.reset) {
  await resetRuntimeDatabase(runtimeDb);
}

const jobId = options.resume
  ? await findActiveJob(jobsDb, sourceHash, options)
  : null;
const activeJobId = jobId ?? randomUUID();

if (!jobId) {
  await jobsDb.execute({
    sql: `
      INSERT INTO indexing_jobs (
        id,
        source_path,
        source_hash,
        runtime_db_url,
        embedding_model,
        embedding_dimensions,
        passage_type,
        book_filter,
        total_passages,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    args: [
      activeJobId,
      absoluteInputPath,
      sourceHash,
      options.runtimeDbUrl,
      process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
      Number(process.env.OPENAI_EMBEDDING_DIMENSIONS ?? 1536),
      options.passageType,
      options.book,
      passages.length
    ]
  });
}

let indexedCount = 0;
let attemptedCount = 0;
let skippedCount = 0;
let embeddedCount = 0;
let verseEmbeddedCount = 0;

for (const passage of passages) {
  if (options.limit !== null && attemptedCount >= options.limit) {
    break;
  }

  const status = await getPassageStatus(jobsDb, activeJobId, passage.id);
  if (status === "indexed") {
    skippedCount += 1;
    continue;
  }

  const embeddingInputText = await getEmbeddingInputText(jobsDb, activeJobId, passage);
  attemptedCount += 1;
  await markPassageStatus(jobsDb, activeJobId, passage, embeddingInputText, "indexing");

  try {
    const hasExistingEmbedding = await passageHasEmbedding(runtimeDb, passage.id);
    const embedding = hasExistingEmbedding || options.skipParagraphEmbeddings
      ? null
      : await embedText(embeddingInputText);
    const normalizedEmbedding = embedding ? normalizeVector(embedding) : undefined;

    await upsertPassage(runtimeDb, passage, normalizedEmbedding);
    const embeddedVerses = await upsertParagraphVerses(runtimeDb, passage);
    await markPassageStatus(jobsDb, activeJobId, passage, embeddingInputText, "indexed");

    indexedCount += 1;
    if (normalizedEmbedding) {
      embeddedCount += 1;
    }
    verseEmbeddedCount += embeddedVerses;
  } catch (error) {
    await markPassageStatus(
      jobsDb,
      activeJobId,
      passage,
      embeddingInputText,
      "failed",
      error instanceof Error ? error.message : String(error)
    );
  }
}

if (!options.skipIndexRebuild) {
  await rebuildFts(runtimeDb);
  await rebuildVectorIndex(runtimeDb);
}

await jobsDb.execute({
  sql: `
    UPDATE indexing_jobs
    SET updated_at = CURRENT_TIMESTAMP,
        finished_at = CASE
          WHEN (
            SELECT COUNT(*)
            FROM indexing_passages
            WHERE job_id = ? AND status = 'indexed'
          ) >= total_passages THEN CURRENT_TIMESTAMP
          ELSE finished_at
        END
    WHERE id = ?
  `,
  args: [activeJobId, activeJobId]
});

const summary = await getJobSummary(jobsDb, activeJobId);
console.log(`Job ${activeJobId}`);
console.log(`Source: ${absoluteInputPath}`);
console.log(`Runtime DB: ${options.runtimeDbUrl}`);
console.log(`Jobs DB: ${options.jobsDbUrl}`);
console.log(`Indexed this wave: ${indexedCount}`);
console.log(`Skipped already indexed: ${skippedCount}`);
console.log(`Paragraph embeddings stored this wave: ${embeddedCount}`);
console.log(`Verse embeddings stored this wave: ${verseEmbeddedCount}`);
console.log(`Progress: ${summary.indexed}/${passages.length} indexed, ${summary.failed} failed`);

function parseArgs(args: string[]): Options {
  let inputPath = process.env.BIBLE_JSON_PATH ?? "data/sample-bible.json";
  let runtimeDbUrl = process.env.DATABASE_URL ?? "file:./storage/crosscannon.db";
  let jobsDbUrl = process.env.INDEXING_JOBS_DATABASE_URL ?? "file:./storage/indexing-jobs.db";
  let archive = true;
  let reset = false;
  let resume = true;
  let limit: number | null = null;
  let passageType: PassageType | "all" = "paragraph";
  let book: string | null = null;
  let skipParagraphEmbeddings = false;
  let skipIndexRebuild = false;
  let rebuildIndexesOnly = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--db" && next) {
      runtimeDbUrl = toFileUrl(next);
      index += 1;
      continue;
    }

    if (arg === "--jobs-db" && next) {
      jobsDbUrl = toFileUrl(next);
      index += 1;
      continue;
    }

    if (arg === "--limit" && next) {
      limit = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--passage-type" && next) {
      if (!["all", "paragraph"].includes(next)) {
        throw new Error("--passage-type must be all or paragraph");
      }
      passageType = next as PassageType | "all";
      index += 1;
      continue;
    }

    if (arg === "--book" && next) {
      book = next;
      index += 1;
      continue;
    }

    if (arg === "--reset") {
      reset = true;
      resume = false;
      continue;
    }

    if (arg === "--resume") {
      resume = true;
      continue;
    }

    if (arg === "--no-archive") {
      archive = false;
      continue;
    }

    if (arg === "--skip-paragraph-embeddings") {
      skipParagraphEmbeddings = true;
      continue;
    }

    if (arg === "--skip-index-rebuild") {
      skipIndexRebuild = true;
      continue;
    }

    if (arg === "--rebuild-indexes-only") {
      rebuildIndexesOnly = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      inputPath = arg;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }

  return {
    inputPath,
    runtimeDbUrl,
    jobsDbUrl,
    archive,
    reset,
    resume,
    limit,
    passageType,
    book,
    skipParagraphEmbeddings,
    skipIndexRebuild,
    rebuildIndexesOnly
  };
}

async function setBusyTimeout(db: Client) {
  await db.execute("PRAGMA busy_timeout = 30000");
}

async function archiveLocalDbs(dbUrls: string[]) {
  const timestamp = timestampForFilename(new Date());
  const archiveDir = path.resolve("storage/archive");
  await mkdir(archiveDir, { recursive: true });

  for (const dbUrl of dbUrls) {
    const dbPath = fileUrlPath(dbUrl);
    if (!dbPath) {
      continue;
    }

    try {
      const parsed = path.parse(dbPath);
      const archivePath = path.join(archiveDir, `${parsed.name}-${timestamp}${parsed.ext}`);
      await copyFile(dbPath, archivePath);
      console.log(`Archived ${dbPath} -> ${archivePath}`);
    } catch (error) {
      const code = isRecord(error) ? error.code : null;
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }
}

async function ensureJobsDatabase(db: Client) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS indexing_jobs (
      id TEXT PRIMARY KEY,
      source_path TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      runtime_db_url TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      embedding_dimensions INTEGER NOT NULL,
      passage_type TEXT NOT NULL,
      book_filter TEXT,
      total_passages INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT
    )
  `);

  await addColumnIfMissing(db, "indexing_jobs", "book_filter", "TEXT");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS indexing_passages (
      job_id TEXT NOT NULL,
      passage_id TEXT NOT NULL,
      reference TEXT NOT NULL,
      result_type TEXT NOT NULL,
      embedding_input_text TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('indexing', 'indexed', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (job_id, passage_id)
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS indexing_passages_status_idx
    ON indexing_passages(job_id, status)
  `);
}

async function addColumnIfMissing(db: Client, table: string, column: string, definition: string) {
  try {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    if (!String(error).includes("duplicate column name")) {
      throw error;
    }
  }
}

async function resetRuntimeDatabase(db: Client) {
  await db.execute("DROP INDEX IF EXISTS passages_embedding_idx");
  await db.execute("DROP INDEX IF EXISTS passages_embedding_idx_shadow_idx");
  await db.execute("DROP TABLE IF EXISTS passages_embedding_idx_shadow");
  await db.execute("DROP TABLE IF EXISTS passages_fts");
  await db.execute("DELETE FROM paragraph_verses");
  await db.execute("DELETE FROM passages");
  await db.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS passages_fts
    USING fts5(reference, text, content='passages', content_rowid='rowid')
  `);
}

async function findActiveJob(db: Client, sourceHash: string, options: Options) {
  const response = await db.execute({
    sql: `
      SELECT id
      FROM indexing_jobs
      WHERE source_hash = ?
        AND runtime_db_url = ?
        AND passage_type = ?
        AND COALESCE(book_filter, '') = COALESCE(?, '')
        AND finished_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `,
    args: [sourceHash, options.runtimeDbUrl, options.passageType, options.book]
  });

  const id = response.rows[0]?.id;
  return typeof id === "string" ? id : null;
}

async function getPassageStatus(db: Client, jobId: string, passageId: string) {
  const response = await db.execute({
    sql: `
      SELECT status
      FROM indexing_passages
      WHERE job_id = ? AND passage_id = ?
    `,
    args: [jobId, passageId]
  });

  const status = response.rows[0]?.status;
  return typeof status === "string" ? status : null;
}

async function getEmbeddingInputText(db: Client, jobId: string, passage: Passage) {
  const response = await db.execute({
    sql: `
      SELECT embedding_input_text
      FROM indexing_passages
      WHERE job_id = ? AND passage_id = ?
    `,
    args: [jobId, passage.id]
  });
  const existing = response.rows[0]?.embedding_input_text;

  if (typeof existing === "string" && existing.trim()) {
    return existing;
  }

  return passage.text;
}

async function markPassageStatus(
  db: Client,
  jobId: string,
  passage: Passage,
  embeddingInputText: string,
  status: "indexing" | "indexed" | "failed",
  error: string | null = null
) {
  await db.execute({
    sql: `
      INSERT INTO indexing_passages (
        job_id,
        passage_id,
        reference,
        result_type,
        embedding_input_text,
        status,
        attempts,
        error,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(job_id, passage_id) DO UPDATE SET
        reference = excluded.reference,
        result_type = excluded.result_type,
        embedding_input_text = excluded.embedding_input_text,
        status = excluded.status,
        attempts = indexing_passages.attempts + CASE WHEN excluded.status = 'indexing' THEN 1 ELSE 0 END,
        error = excluded.error,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [
      jobId,
      passage.id,
      passage.reference,
      passage.resultType,
      embeddingInputText,
      status,
      error
    ]
  });
}

async function passageHasEmbedding(db: Client, passageId: string) {
  const response = await db.execute({
    sql: "SELECT embedding_json FROM passages WHERE id = ?",
    args: [passageId]
  });

  return typeof response.rows[0]?.embedding_json === "string";
}

async function upsertPassage(db: Client, passage: Passage, normalizedEmbedding: number[] | undefined) {
  await db.execute({
    sql: `
      INSERT INTO passages (
        id,
        result_type,
        book,
        chapter,
        verse_start,
        verse_end,
        reference,
        text,
        embedding,
        embedding_json,
        source_hash
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${normalizedEmbedding ? "vector32(?)" : "NULL"}, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        result_type = excluded.result_type,
        book = excluded.book,
        chapter = excluded.chapter,
        verse_start = excluded.verse_start,
        verse_end = excluded.verse_end,
        reference = excluded.reference,
        text = excluded.text,
        embedding = COALESCE(excluded.embedding, passages.embedding),
        embedding_json = COALESCE(excluded.embedding_json, passages.embedding_json),
        source_hash = excluded.source_hash
    `,
    args: [
      passage.id,
      passage.resultType,
      passage.book,
      passage.chapter,
      passage.verseStart,
      passage.verseEnd,
      passage.reference,
      passage.text,
      ...(normalizedEmbedding ? [vectorSql(normalizedEmbedding)] : []),
      normalizedEmbedding ? JSON.stringify(normalizedEmbedding) : null,
      passage.sourceHash
    ]
  });
}

async function upsertParagraphVerses(db: Client, passage: Passage) {
  await db.execute({
    sql: "DELETE FROM paragraph_verses WHERE paragraph_id = ?",
    args: [passage.id]
  });

  let embeddedCount = 0;

  for (const verse of passage.verses) {
    const embedding = await embedText(verse.text);
    const normalizedEmbedding = embedding ? normalizeVector(embedding) : null;

    await db.execute({
      sql: `
        INSERT INTO paragraph_verses (
          paragraph_id,
          book,
          chapter,
          verse,
          reference,
          text,
          embedding,
          embedding_json,
          source_hash
        )
        VALUES (?, ?, ?, ?, ?, ?, ${normalizedEmbedding ? "vector32(?)" : "NULL"}, ?, ?)
      `,
      args: [
        passage.id,
        verse.book,
        verse.chapter,
        verse.verse,
        `${verse.book} ${verse.chapter}:${verse.verse}`,
        verse.text.trim(),
        ...(normalizedEmbedding ? [vectorSql(normalizedEmbedding)] : []),
        normalizedEmbedding ? JSON.stringify(normalizedEmbedding) : null,
        stableId(`${verse.book}-${verse.chapter}-${verse.verse}-${verse.text}`)
      ]
    });

    if (normalizedEmbedding) {
      embeddedCount += 1;
    }
  }

  return embeddedCount;
}

async function rebuildFts(db: Client) {
  await db.execute("INSERT INTO passages_fts(passages_fts) VALUES('rebuild')");
}

async function rebuildVectorIndex(db: Client) {
  try {
    await db.execute("DROP INDEX IF EXISTS passages_embedding_idx");
    await db.execute(`
      CREATE INDEX IF NOT EXISTS passages_embedding_idx
      ON passages(libsql_vector_idx(embedding))
    `);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Vector index rebuild unavailable; stored-vector fallback remains enabled.");
    }
  }
}

async function getJobSummary(db: Client, jobId: string) {
  const response = await db.execute({
    sql: `
      SELECT status, COUNT(*) AS count
      FROM indexing_passages
      WHERE job_id = ?
      GROUP BY status
    `,
    args: [jobId]
  });

  let indexed = 0;
  let failed = 0;

  for (const row of response.rows) {
    if (row.status === "indexed") {
      indexed = Number(row.count);
    }
    if (row.status === "failed") {
      failed = Number(row.count);
    }
  }

  return { indexed, failed };
}

function normalizeBibleJson(input: unknown): Verse[] {
  if (Array.isArray(input)) {
    return normalizeArray(input);
  }

  if (isRecord(input)) {
    const booksValue = input.books ?? input.Books;
    if (Array.isArray(booksValue)) {
      return normalizeBooksArray(booksValue);
    }

    const versesValue = input.verses ?? input.Verses;
    if (Array.isArray(versesValue)) {
      return normalizeArray(versesValue);
    }

    return normalizeBookObject(input);
  }

  return [];
}

function normalizeArray(items: unknown[]) {
  const verses: Verse[] = [];

  for (const item of items) {
    if (!isRecord(item)) {
      continue;
    }

    if (Array.isArray(item.chapters) || Array.isArray(item.Chapters)) {
      verses.push(...normalizeBooksArray([item]));
      continue;
    }

    const book = stringValue(item.book ?? item.book_name ?? item.bookName ?? item.name);
    const chapter = numberValue(item.chapter ?? item.chapter_number ?? item.chapterNumber);
    const verse = numberValue(item.verse ?? item.verse_number ?? item.verseNumber);
    const text = stringValue(item.text ?? item.value ?? item.content);

    if (book && chapter && verse && text) {
      verses.push({ book, chapter, verse, text });
    }
  }

  return verses;
}

function normalizeBooksArray(books: unknown[]) {
  const verses: Verse[] = [];

  for (const bookItem of books) {
    if (!isRecord(bookItem)) {
      continue;
    }

    const book = stringValue(bookItem.book ?? bookItem.name ?? bookItem.bookName ?? bookItem.book_name);
    const chapters = bookItem.chapters ?? bookItem.Chapters;

    if (!book || !Array.isArray(chapters)) {
      continue;
    }

    chapters.forEach((chapterItem, chapterIndex) => {
      if (!isRecord(chapterItem) && !Array.isArray(chapterItem)) {
        return;
      }

      const chapter = isRecord(chapterItem)
        ? numberValue(chapterItem.chapter ?? chapterItem.number ?? chapterItem.chapterNumber) ?? chapterIndex + 1
        : chapterIndex + 1;
      const chapterVerses = isRecord(chapterItem)
        ? chapterItem.verses ?? chapterItem.Verses
        : chapterItem;

      if (!Array.isArray(chapterVerses)) {
        return;
      }

      chapterVerses.forEach((verseItem, verseIndex) => {
        const verse = isRecord(verseItem)
          ? numberValue(verseItem.verse ?? verseItem.number ?? verseItem.verseNumber) ?? verseIndex + 1
          : verseIndex + 1;
        const text = isRecord(verseItem)
          ? stringValue(verseItem.text ?? verseItem.value ?? verseItem.content)
          : stringValue(verseItem);

        if (chapter && verse && text) {
          verses.push({ book, chapter, verse, text });
        }
      });
    });
  }

  return verses;
}

function normalizeBookObject(input: Record<string, unknown>) {
  const verses: Verse[] = [];

  for (const [book, chapters] of Object.entries(input)) {
    if (!isRecord(chapters) && !Array.isArray(chapters)) {
      continue;
    }

    const chapterEntries = Array.isArray(chapters)
      ? chapters.map((chapter, index) => [String(index + 1), chapter] as const)
      : Object.entries(chapters);

    for (const [chapterKey, chapterValue] of chapterEntries) {
      const chapter = Number(chapterKey);
      if (!Number.isFinite(chapter)) {
        continue;
      }

      if (Array.isArray(chapterValue)) {
        chapterValue.forEach((text, index) => {
          if (stringValue(text)) {
            verses.push({ book, chapter, verse: index + 1, text: stringValue(text) });
          }
        });
        continue;
      }

      if (!isRecord(chapterValue)) {
        continue;
      }

      for (const [verseKey, text] of Object.entries(chapterValue)) {
        const verse = Number(verseKey);
        if (Number.isFinite(verse) && stringValue(text)) {
          verses.push({ book, chapter, verse, text: stringValue(text) });
        }
      }
    }
  }

  return verses;
}

function buildPassages(verses: Verse[]) {
  const sorted = verses
    .filter((verse) => verse.text.trim())
    .sort((left, right) =>
      left.book.localeCompare(right.book) ||
      left.chapter - right.chapter ||
      left.verse - right.verse
    );

  const passages: Passage[] = [];
  const chapters = new Map<string, Verse[]>();

  for (const verse of sorted) {
    const key = `${verse.book}\t${verse.chapter}`;
    chapters.set(key, [...(chapters.get(key) ?? []), verse]);
  }

  for (const chapterVerses of chapters.values()) {
    passages.push(...buildParagraphsForChapter(chapterVerses));
  }

  return passages;
}

function buildParagraphsForChapter(chapterVerses: Verse[]) {
  const paragraphs: Passage[] = [];
  const targetCharacters = 520;
  const maxCharacters = 820;
  let current: Verse[] = [];
  let currentCharacters = 0;

  for (const verse of chapterVerses) {
    const verseText = verse.text.trim();
    const nextCharacters = currentCharacters + verseText.length + 1;
    const shouldFlush =
      current.length > 0 &&
      currentCharacters >= targetCharacters &&
      (nextCharacters > maxCharacters || current.length >= 4);

    if (shouldFlush) {
      paragraphs.push(buildParagraph(current));
      current = [];
      currentCharacters = 0;
    }

    current.push(verse);
    currentCharacters += verseText.length + 1;
  }

  if (current.length > 0) {
    paragraphs.push(buildParagraph(current));
  }

  return paragraphs;
}

function buildParagraph(paragraphVerses: Verse[]) {
  const first = paragraphVerses[0];
  const last = paragraphVerses[paragraphVerses.length - 1];
  const reference = first.verse === last.verse
    ? `${first.book} ${first.chapter}:${first.verse}`
    : `${first.book} ${first.chapter}:${first.verse}-${last.verse}`;
  const text = paragraphVerses.map((verse) => verse.text.trim()).join(" ");

  return {
    id: stableId(`paragraph-${first.book}-${first.chapter}-${first.verse}-${last.verse}`),
    resultType: "paragraph" as const,
    book: first.book,
    chapter: first.chapter,
    verseStart: first.verse,
    verseEnd: last.verse,
    reference,
    text,
    verses: paragraphVerses,
    sourceHash: stableId(`${reference}-${text}`)
  };
}

function toFileUrl(value: string) {
  return value.startsWith("file:") ? value : `file:${value}`;
}

function fileUrlPath(dbUrl: string) {
  if (!dbUrl.startsWith("file:")) {
    return null;
  }

  return path.resolve(dbUrl.slice("file:".length));
}

function timestampForFilename(date: Date) {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
}

function normalizeBookName(book: string) {
  return book.trim().toLowerCase();
}

function stableId(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}
