import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createClient, type Client, type InStatement } from "@libsql/client";
import OpenAI from "openai";

import {
  normalizeVector,
  vectorSql,
  type IndexedEmbeddingConfig
} from "../app/lib/db.server";
import { getDefaultEmbeddingConfig } from "../app/lib/embeddings.server";

type SourceMetadata = {
  id: string;
  provider: string;
  sourceUrl: string;
  title: string;
};

type WorkMetadata = {
  author: string | null;
  authorshipDateRange: string | null;
  ccel: {
    id: string;
    sourceUrl: string;
    title: string;
  };
  source: SourceMetadata;
};

type WorkClassification = {
  bucket: string;
  canonicalStatus: string;
  contentKind: string;
  cautionReason: string;
  doctrinalStatus: string;
  labels: string[];
  severity: number;
};

type ChapterSummary = {
  assetPath: string;
  chapter: number;
  id: string;
  title: string;
  verseCount: number;
};

type WorkSummary = {
  author: string | null;
  book: string;
  chapters: ChapterSummary[];
  classification: WorkClassification;
  id: string;
  metadata: WorkMetadata;
  name: string;
};

type WorkIndex = {
  books: WorkSummary[];
  generatedAt: string;
  source: string;
};

type ChapterAsset = {
  author: string | null;
  book: string;
  chapter: number;
  classification: WorkClassification;
  id: string;
  lineage: string[];
  metadata: WorkMetadata;
  originalBook: string | null;
  sourceVolumeId: string;
  title: string;
  source: {
    id: string;
    sourceUrl: string;
    title: string;
  };
  verses: Array<{
    book: string;
    chapter: number;
    verse: number;
    text: string;
  }>;
};

type Passage = {
  id: string;
  resultType: "paragraph";
  book: string;
  chapter: number;
  verseStart: number | null;
  verseEnd: number | null;
  reference: string;
  text: string;
  verses: Array<{
    book: string;
    chapter: number;
    verse: number;
    text: string;
  }>;
  sourceHash: string;
  work: WorkSummary;
  chapterAsset: ChapterAsset;
};

type Chapter = {
  id: string;
  workId: string;
  book: string;
  chapter: number;
  title: string;
  reference: string;
  text: string;
  verseCount: number;
  sourceVolumeId: string;
  lineage: string[];
  sourceHash: string;
  work: WorkSummary;
};

type EmbeddingItem =
  {
    kind: "passage";
    id: string;
    text: string;
  }
  | {
    kind: "chapter";
    id: string;
    text: string;
  };

type Options = {
  inputPath: string;
  runtimeDbUrl: string;
  reset: boolean;
  limit: number | null;
  batchSize: number;
  skipIndexRebuild: boolean;
  rebuildIndexesOnly: boolean;
};

const MAX_EMBEDDING_INPUT_CHARS = 24_000;
const EXCLUDED_SOURCE_VOLUME_IDS = new Set(["anf01"]);
const EXCLUDED_WORK_IDS = new Set([
  "anf07:x",
  "npnf101:vii",
  "npnf205:ix.ii",
  "npnf205:x.ii"
]);
const options = parseArgs(process.argv.slice(2));
const embeddingConfig = getDefaultEmbeddingConfig();

if (process.env.EMBEDDING_PROVIDER !== "mock" && !process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required to index early Christian works with real embeddings.");
}

await mkdir("storage", { recursive: true });
const db = createClient({ url: options.runtimeDbUrl });
await setBusyTimeout(db);
await ensureEarlyChristianDatabase(db);
await setIndexedEmbeddingConfig(db, embeddingConfig);

if (options.rebuildIndexesOnly) {
  await rebuildVectorIndex(db);
  console.log(`Rebuilt early Christian vector indexes for ${options.runtimeDbUrl}`);
  process.exit(0);
}

if (options.reset) {
  await resetRuntimeDatabase(db);
  await ensureEarlyChristianDatabase(db);
  await setIndexedEmbeddingConfig(db, embeddingConfig);
}

const absoluteInputPath = path.resolve(options.inputPath);
const raw = await readFile(absoluteInputPath, "utf8");
const sourceHash = stableId(raw);
const workIndex = JSON.parse(raw) as WorkIndex;
const indexData = await buildIndexData(workIndex, absoluteInputPath, sourceHash);
const passages = indexData.passages;
const selectedPassages = options.limit === null ? passages : passages.slice(0, options.limit);
const selectedChapterIds = new Set(selectedPassages.map((passage) => passage.chapterAsset.id));
const selectedChapters = indexData.chapters.filter((chapter) => selectedChapterIds.has(chapter.id));

if (selectedPassages.length === 0) {
  throw new Error(`No passages found in ${absoluteInputPath}`);
}

console.log(`Source: ${absoluteInputPath}`);
console.log(`Runtime DB: ${options.runtimeDbUrl}`);
console.log(`Embedding model: ${embeddingConfig.model}`);
console.log(`Embedding dimensions: ${embeddingConfig.dimensions}`);
console.log(`Works: ${new Set(selectedPassages.map((passage) => passage.work.id)).size}`);
console.log(`Chapters to index: ${selectedChapters.length}`);
console.log(`Passages to index: ${selectedPassages.length}`);

await upsertWorks(db, selectedPassages);
await upsertChapters(db, selectedChapters);

let indexedPassages = 0;
const embeddingItems: EmbeddingItem[] = [];
const rowStatements: InStatement[] = [];

for (const chapter of selectedChapters) {
  embeddingItems.push({
    kind: "chapter",
    id: chapter.id,
    text: chapter.text
  });
}

for (const passage of selectedPassages) {
  rowStatements.push(...upsertPassageStatements(passage));
  indexedPassages += 1;
  embeddingItems.push({
    kind: "passage",
    id: passage.id,
    text: passage.text
  });

  for (const verse of passage.verses) {
    rowStatements.push(upsertParagraphVerseStatement(passage, verse));
  }
}

await executeBatch(db, rowStatements, 750);
console.log(`Passage rows stored: ${indexedPassages}`);
const existingEmbeddingIds = await getExistingEmbeddingIds(db);
const pendingEmbeddingItems = embeddingItems.filter((item) => !existingEmbeddingIds.get(item.kind)?.has(item.id));
console.log(`Existing chapter embeddings skipped: ${existingEmbeddingIds.get("chapter")?.size ?? 0}`);
console.log(`Existing passage embeddings skipped: ${existingEmbeddingIds.get("passage")?.size ?? 0}`);
console.log(`Embeddings to store: ${pendingEmbeddingItems.length}`);

let embeddedCount = 0;
for (let index = 0; index < pendingEmbeddingItems.length; index += options.batchSize) {
  const batch = pendingEmbeddingItems.slice(index, index + options.batchSize);
  const embeddings = await embedItems(batch, embeddingConfig);
  const embeddingStatements: InStatement[] = [];

  for (let itemIndex = 0; itemIndex < batch.length; itemIndex += 1) {
    const normalized = normalizeVector(embeddings[itemIndex]);
    embeddingStatements.push(storeEmbeddingStatement(batch[itemIndex], normalized));
    embeddedCount += 1;
  }

  await executeBatch(db, embeddingStatements, 250);
  console.log(`Embedded ${Math.min(index + batch.length, pendingEmbeddingItems.length)}/${pendingEmbeddingItems.length}`);
}

if (!options.skipIndexRebuild) {
  await rebuildVectorIndex(db);
}

const summary = await getRuntimeSummary(db);
console.log(`Indexed early Christian DB complete.`);
console.log(`Chapters: ${summary.chapters}`);
console.log(`Passages: ${summary.passages}`);
console.log(`Paragraph verses: ${summary.paragraphVerses}`);
console.log(`Embeddings stored this run: ${embeddedCount}`);

function parseArgs(args: string[]): Options {
  let inputPath = "public/church-fathers-preview/books.json";
  let runtimeDbUrl = process.env.EARLY_CHRISTIAN_DATABASE_URL
    ?? process.env.CHURCH_FATHERS_DATABASE_URL
    ?? "file:./storage/early-christian-works.db";
  let reset = false;
  let limit: number | null = null;
  let batchSize = Number(process.env.EMBEDDING_BATCH_SIZE ?? 96);
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

    if (arg === "--input" && next) {
      inputPath = next;
      index += 1;
      continue;
    }

    if (arg === "--limit" && next) {
      limit = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--batch-size" && next) {
      batchSize = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--reset") {
      reset = true;
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

  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("--batch-size must be a positive integer");
  }

  return {
    batchSize,
    inputPath,
    limit,
    rebuildIndexesOnly,
    reset,
    runtimeDbUrl,
    skipIndexRebuild
  };
}

async function buildIndexData(workIndex: WorkIndex, inputPath: string, sourceHash: string) {
  const projectRoot = process.cwd();
  const chapters: Chapter[] = [];
  const passages: Passage[] = [];

  for (const work of workIndex.books) {
    if (isExcludedSourceVolume(work)) {
      continue;
    }

    for (const chapterSummary of work.chapters) {
      const assetPath = path.resolve(
        projectRoot,
        chapterSummary.assetPath.replace(/^\//, "public/")
      );
      const rawChapter = await readFile(assetPath, "utf8");
      const chapterAsset = JSON.parse(rawChapter) as ChapterAsset;
      const chapterText = chapterAsset.verses.map((verse) => verse.text.trim()).filter(Boolean).join(" ");

      chapters.push({
        book: work.name,
        chapter: chapterAsset.chapter,
        id: chapterAsset.id,
        lineage: chapterAsset.lineage,
        reference: `${work.name} ${chapterAsset.chapter}`,
        sourceHash: stableId(`${sourceHash}:${chapterAsset.id}`),
        sourceVolumeId: chapterAsset.sourceVolumeId,
        text: chapterText,
        title: chapterAsset.title,
        verseCount: chapterAsset.verses.length,
        work,
        workId: work.id
      });

      const groups = groupSentencesIntoPassages(chapterAsset.verses);

      for (const group of groups) {
        const first = group[0];
        const last = group[group.length - 1];
        const reference = `${work.name} ${chapterAsset.chapter}:${first.verse}-${last.verse}`;
        passages.push({
          book: work.name,
          chapter: chapterAsset.chapter,
          chapterAsset,
          id: stablePassageId(work.id, chapterAsset.id, first.verse, last.verse),
          reference,
          resultType: "paragraph",
          sourceHash: stableId(`${sourceHash}:${chapterAsset.id}:${first.verse}-${last.verse}`),
          text: group.map((verse) => verse.text.trim()).join(" "),
          verseEnd: last.verse,
          verseStart: first.verse,
          verses: group.map((verse) => ({
            book: work.name,
            chapter: chapterAsset.chapter,
            text: verse.text,
            verse: verse.verse
          })),
          work
        });
      }
    }
  }

  return { chapters, passages };
}

function isExcludedSourceVolume(work: WorkSummary) {
  return EXCLUDED_WORK_IDS.has(work.id)
    || EXCLUDED_SOURCE_VOLUME_IDS.has(work.metadata.ccel.id.toLowerCase())
    || EXCLUDED_SOURCE_VOLUME_IDS.has(work.metadata.source.id.toLowerCase());
}

function groupSentencesIntoPassages(verses: ChapterAsset["verses"]) {
  const groups: Array<ChapterAsset["verses"]> = [];
  let current: ChapterAsset["verses"] = [];

  for (const verse of verses) {
    current.push(verse);

    if (current.length >= 3) {
      groups.push(current);
      current = [];
    }
  }

  if (current.length > 0) {
    if (groups.length > 0 && current.length < 3) {
      groups[groups.length - 1].push(...current);
    } else {
      groups.push(current);
    }
  }

  return groups;
}

async function ensureEarlyChristianDatabase(db: Client) {
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

  await db.execute(`
    CREATE TABLE IF NOT EXISTS scripture_embedding_config (
      id TEXT PRIMARY KEY CHECK (id = 'active'),
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS early_christian_works (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      authorship_date_range TEXT,
      classification_json TEXT NOT NULL,
      ccel_id TEXT NOT NULL,
      ccel_title TEXT NOT NULL,
      ccel_source_url TEXT NOT NULL,
      source_json TEXT NOT NULL,
      chapter_count INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS early_christian_chapters (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL,
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      title TEXT NOT NULL,
      reference TEXT NOT NULL,
      text TEXT NOT NULL,
      verse_count INTEGER NOT NULL,
      source_volume_id TEXT NOT NULL,
      lineage_json TEXT NOT NULL,
      embedding F32_BLOB(1536),
      source_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (work_id) REFERENCES early_christian_works(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS early_christian_chapters_reference_idx
    ON early_christian_chapters(work_id, chapter)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS early_christian_passage_metadata (
      passage_id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      chapter_title TEXT NOT NULL,
      source_volume_id TEXT NOT NULL,
      lineage_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (passage_id) REFERENCES passages(id) ON DELETE CASCADE,
      FOREIGN KEY (work_id) REFERENCES early_christian_works(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS early_christian_passage_metadata_chapter_idx
    ON early_christian_passage_metadata(chapter_id, passage_id, work_id)
  `);
}

async function setIndexedEmbeddingConfig(db: Client, config: IndexedEmbeddingConfig) {
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

async function resetRuntimeDatabase(db: Client) {
  for (const sql of [
    "DROP INDEX IF EXISTS passages_embedding_idx",
    "DROP INDEX IF EXISTS passages_embedding_idx_shadow_idx",
    "DROP TABLE IF EXISTS passages_embedding_idx_shadow",
    "DROP INDEX IF EXISTS early_christian_chapters_embedding_idx",
    "DROP INDEX IF EXISTS early_christian_chapters_embedding_idx_shadow_idx",
    "DROP TABLE IF EXISTS early_christian_chapters_embedding_idx_shadow",
    "DELETE FROM libsql_vector_meta_shadow WHERE name = 'passages_embedding_idx'",
    "DELETE FROM libsql_vector_meta_shadow WHERE name = 'early_christian_chapters_embedding_idx'",
    "DELETE FROM early_christian_passage_metadata",
    "DELETE FROM early_christian_chapters",
    "DELETE FROM early_christian_works",
    "DELETE FROM paragraph_verses",
    "DELETE FROM passages"
  ]) {
    try {
      await db.execute(sql);
    } catch {
      // Local vector shadow tables may not exist in every libSQL runtime.
    }
  }
}

async function upsertWorks(db: Client, passages: Passage[]) {
  const seen = new Set<string>();
  const statements: InStatement[] = [];

  for (const passage of passages) {
    if (seen.has(passage.work.id)) {
      continue;
    }
    seen.add(passage.work.id);

    statements.push({
      sql: `
        INSERT INTO early_christian_works (
          id,
          title,
          author,
          authorship_date_range,
          classification_json,
          ccel_id,
          ccel_title,
          ccel_source_url,
          source_json,
          chapter_count,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          author = excluded.author,
          authorship_date_range = excluded.authorship_date_range,
          classification_json = excluded.classification_json,
          ccel_id = excluded.ccel_id,
          ccel_title = excluded.ccel_title,
          ccel_source_url = excluded.ccel_source_url,
          source_json = excluded.source_json,
          chapter_count = excluded.chapter_count,
          updated_at = CURRENT_TIMESTAMP
      `,
      args: [
        passage.work.id,
        passage.work.name,
        passage.work.metadata.author,
        passage.work.metadata.authorshipDateRange,
        JSON.stringify(passage.work.classification),
        passage.work.metadata.ccel.id,
        passage.work.metadata.ccel.title,
        passage.work.metadata.ccel.sourceUrl,
        JSON.stringify(passage.work.metadata.source),
        passage.work.chapters.length
      ]
    });
  }

  await executeBatch(db, statements, 500);
}

async function upsertChapters(db: Client, chapters: Chapter[]) {
  const statements: InStatement[] = chapters.map((chapter) => ({
    sql: `
      INSERT INTO early_christian_chapters (
        id,
        work_id,
        book,
        chapter,
        title,
        reference,
        text,
        verse_count,
        source_volume_id,
        lineage_json,
        embedding,
        source_hash,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        work_id = excluded.work_id,
        book = excluded.book,
        chapter = excluded.chapter,
        title = excluded.title,
        reference = excluded.reference,
        text = excluded.text,
        verse_count = excluded.verse_count,
        source_volume_id = excluded.source_volume_id,
        lineage_json = excluded.lineage_json,
        source_hash = excluded.source_hash,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [
      chapter.id,
      chapter.workId,
      chapter.book,
      chapter.chapter,
      chapter.title,
      chapter.reference,
      chapter.text,
      chapter.verseCount,
      chapter.sourceVolumeId,
      JSON.stringify(chapter.lineage),
      chapter.sourceHash
    ]
  }));

  await executeBatch(db, statements, 500);
}

function upsertPassageStatements(passage: Passage): InStatement[] {
  return [
    {
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
          source_hash
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
        ON CONFLICT(id) DO UPDATE SET
          result_type = excluded.result_type,
          book = excluded.book,
          chapter = excluded.chapter,
          verse_start = excluded.verse_start,
          verse_end = excluded.verse_end,
          reference = excluded.reference,
          text = excluded.text,
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
        passage.sourceHash
      ]
    },
    {
      sql: `
        INSERT INTO early_christian_passage_metadata (
          passage_id,
          work_id,
          chapter_id,
          chapter_title,
          source_volume_id,
          lineage_json,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(passage_id) DO UPDATE SET
          work_id = excluded.work_id,
          chapter_id = excluded.chapter_id,
          chapter_title = excluded.chapter_title,
          source_volume_id = excluded.source_volume_id,
          lineage_json = excluded.lineage_json,
          updated_at = CURRENT_TIMESTAMP
      `,
      args: [
        passage.id,
        passage.work.id,
        passage.chapterAsset.id,
        passage.chapterAsset.title,
        passage.chapterAsset.sourceVolumeId,
        JSON.stringify(passage.chapterAsset.lineage)
      ]
    }
  ];
}

function upsertParagraphVerseStatement(
  passage: Passage,
  verse: Passage["verses"][number]
) {
  return {
    sql: `
      INSERT INTO paragraph_verses (
        paragraph_id,
        book,
        chapter,
        verse,
        reference,
        text,
        embedding,
        source_hash
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(paragraph_id, verse) DO UPDATE SET
        book = excluded.book,
        chapter = excluded.chapter,
        reference = excluded.reference,
        text = excluded.text,
        source_hash = excluded.source_hash
    `,
    args: [
      passage.id,
      verse.book,
      verse.chapter,
      verse.verse,
      `${verse.book} ${verse.chapter}:${verse.verse}`,
      verse.text.trim(),
      stableId(`${passage.id}:${verse.verse}:${verse.text}`)
    ]
  };
}

async function embedBatch(texts: string[], config: IndexedEmbeddingConfig): Promise<number[][]> {
  if (process.env.EMBEDDING_PROVIDER === "mock") {
    return texts.map((text) => mockEmbedding(text, config.dimensions));
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await client.embeddings.create({
        dimensions: config.dimensions,
        encoding_format: "float",
        input: texts,
        model: config.model
      });

      return response.data.map((item) => item.embedding);
    } catch (error) {
      if (isTokenLimitError(error) && texts.length > 1) {
        const midpoint = Math.ceil(texts.length / 2);
        const left = await embedBatch(texts.slice(0, midpoint), config);
        const right = await embedBatch(texts.slice(midpoint), config);

        return [...left, ...right];
      }

      if (attempt === maxAttempts) {
        throw error;
      }

      const delayMs = 1000 * 2 ** (attempt - 1);
      console.warn(`Embedding batch failed; retrying in ${delayMs}ms.`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error("Embedding batch failed unexpectedly.");
}

async function embedItems(items: EmbeddingItem[], config: IndexedEmbeddingConfig): Promise<number[][]> {
  const chunks: Array<{ itemIndex: number; text: string; weight: number }> = [];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex];
    const itemChunks = item.kind === "chapter"
      ? splitTextForEmbedding(item.text)
      : [item.text.trim()].filter(Boolean);

    for (const text of itemChunks) {
      chunks.push({
        itemIndex,
        text,
        weight: Math.max(text.length, 1)
      });
    }
  }

  const itemVectors = items.map(() => Array.from({ length: config.dimensions }, () => 0));
  const itemWeights = items.map(() => 0);

  if (chunks.length === 0) {
    return itemVectors;
  }

  const chunkEmbeddings = await embedBatch(
    chunks.map((chunk) => chunk.text),
    config
  );

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const embedding = chunkEmbeddings[chunkIndex];
    const vector = itemVectors[chunk.itemIndex];
    itemWeights[chunk.itemIndex] += chunk.weight;

    for (let dimension = 0; dimension < config.dimensions; dimension += 1) {
      vector[dimension] += embedding[dimension] * chunk.weight;
    }
  }

  return itemVectors.map((vector, itemIndex) => {
    const weight = itemWeights[itemIndex] || 1;

    return vector.map((value) => value / weight);
  });
}

function splitTextForEmbedding(text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.length <= MAX_EMBEDDING_INPUT_CHARS) {
    return [trimmed];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < trimmed.length) {
    let end = Math.min(start + MAX_EMBEDDING_INPUT_CHARS, trimmed.length);

    if (end < trimmed.length) {
      const sentenceBoundary = Math.max(
        trimmed.lastIndexOf(". ", end),
        trimmed.lastIndexOf("? ", end),
        trimmed.lastIndexOf("! ", end)
      );
      const whitespaceBoundary = trimmed.lastIndexOf(" ", end);
      const boundary = sentenceBoundary > start + MAX_EMBEDDING_INPUT_CHARS * 0.5
        ? sentenceBoundary + 1
        : whitespaceBoundary;

      if (boundary > start) {
        end = boundary;
      }
    }

    const chunk = trimmed.slice(start, end).trim();

    if (chunk) {
      chunks.push(chunk);
    }

    start = end;
  }

  return chunks;
}

function isTokenLimitError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: unknown; type?: unknown; status?: unknown };

  return candidate.status === 400
    && (candidate.code === "max_tokens_per_request" || candidate.type === "max_tokens_per_request");
}

function storeEmbeddingStatement(item: EmbeddingItem, vector: number[]): InStatement {
  if (item.kind === "chapter") {
    return {
      sql: "UPDATE early_christian_chapters SET embedding = vector32(?) WHERE id = ?",
      args: [vectorSql(vector), item.id]
    };
  }

  return {
    sql: "UPDATE passages SET embedding = vector32(?) WHERE id = ?",
    args: [vectorSql(vector), item.id]
  };
}

async function executeBatch(db: Client, statements: InStatement[], chunkSize: number) {
  for (let index = 0; index < statements.length; index += chunkSize) {
    await db.batch(statements.slice(index, index + chunkSize), "write");
  }
}

async function rebuildVectorIndex(db: Client) {
  try {
    await db.execute("DROP INDEX IF EXISTS passages_embedding_idx");
    await db.execute("DROP INDEX IF EXISTS passages_embedding_idx_shadow_idx");
    await db.execute("DROP TABLE IF EXISTS passages_embedding_idx_shadow");
    await db.execute("DROP INDEX IF EXISTS early_christian_chapters_embedding_idx");
    await db.execute("DROP INDEX IF EXISTS early_christian_chapters_embedding_idx_shadow_idx");
    await db.execute("DROP TABLE IF EXISTS early_christian_chapters_embedding_idx_shadow");
    await dropVectorIndexMetadata(db, "passages_embedding_idx");
    await dropVectorIndexMetadata(db, "early_christian_chapters_embedding_idx");
    await db.execute(`
      CREATE INDEX IF NOT EXISTS early_christian_chapters_embedding_idx
      ON early_christian_chapters(libsql_vector_idx(embedding))
    `);
  } catch {
    console.warn("Chapter vector index rebuild unavailable; exact vector scan query can still verify results.");
  }
}

async function dropVectorIndexMetadata(db: Client, indexName: string) {
  try {
    await db.execute({
      sql: "DELETE FROM libsql_vector_meta_shadow WHERE name = ?",
      args: [indexName]
    });
  } catch {
    // Older SQLite/libSQL states may not have vector metadata yet.
  }
}

async function getExistingEmbeddingIds(db: Client) {
  const chapterResponse = await db.execute(`
    SELECT id
    FROM early_christian_chapters
    WHERE embedding IS NOT NULL
  `);
  const passageResponse = await db.execute(`
    SELECT id
    FROM passages
    WHERE embedding IS NOT NULL
  `);

  return new Map<EmbeddingItem["kind"], Set<string>>([
    ["chapter", new Set(chapterResponse.rows.map((row) => String(row.id)))],
    ["passage", new Set(passageResponse.rows.map((row) => String(row.id)))]
  ]);
}

async function getRuntimeSummary(db: Client) {
  const chapters = await db.execute("SELECT COUNT(*) AS count FROM early_christian_chapters");
  const passages = await db.execute("SELECT COUNT(*) AS count FROM passages");
  const paragraphVerses = await db.execute("SELECT COUNT(*) AS count FROM paragraph_verses");

  return {
    chapters: Number(chapters.rows[0]?.count ?? 0),
    paragraphVerses: Number(paragraphVerses.rows[0]?.count ?? 0),
    passages: Number(passages.rows[0]?.count ?? 0)
  };
}

async function setBusyTimeout(db: Client) {
  try {
    await db.execute("PRAGMA busy_timeout = 5000");
  } catch {
    // Remote libSQL URLs may ignore SQLite pragmas.
  }
}

function stablePassageId(workId: string, chapterId: string, verseStart: number, verseEnd: number) {
  return `ecw:${stableId(`${workId}:${chapterId}:${verseStart}-${verseEnd}`).slice(0, 24)}`;
}

function stableId(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function toFileUrl(value: string) {
  if (/^[a-z]+:/i.test(value)) {
    return value;
  }

  return `file:${value}`;
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
