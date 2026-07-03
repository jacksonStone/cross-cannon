#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";

const inputPath = path.resolve(process.argv[2] ?? "public/church-fathers-preview/books.json");
const runtimeDbUrl = process.env.EARLY_CHRISTIAN_DATABASE_URL
  ?? process.env.CHURCH_FATHERS_DATABASE_URL
  ?? "file:./storage/early-christian-works.db";

const raw = await readFile(inputPath, "utf8");
const workIndex = JSON.parse(raw);
const books = Array.isArray(workIndex.books) ? workIndex.books : [];

if (books.length === 0) {
  throw new Error(`No books found in ${inputPath}`);
}

const db = createClient({ url: runtimeDbUrl });
await db.execute("PRAGMA busy_timeout = 5000");
await db.batch([
  {
    sql: `
      CREATE INDEX IF NOT EXISTS early_christian_works_author_idx
      ON early_christian_works(author, id)
    `
  },
  {
    sql: `
      CREATE INDEX IF NOT EXISTS early_christian_passage_metadata_work_idx
      ON early_christian_passage_metadata(work_id, passage_id, chapter_id)
    `
  }
], "write");

let updatedCount = 0;
const bookIds = new Set(books.map((book) => String(book.id)));
const statements = books.map((book) => {
  updatedCount += 1;

  return {
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
      book.id,
      book.name,
      book.metadata?.author ?? book.author ?? null,
      book.metadata?.authorshipDateRange ?? null,
      JSON.stringify(book.classification ?? {}),
      book.metadata?.ccel?.id ?? book.metadata?.source?.id ?? "",
      book.metadata?.ccel?.title ?? book.metadata?.source?.title ?? "",
      book.metadata?.ccel?.sourceUrl ?? book.metadata?.source?.sourceUrl ?? "",
      JSON.stringify(book.metadata?.source ?? {}),
      Array.isArray(book.chapters) ? book.chapters.length : 0
    ]
  };
});

for (let index = 0; index < statements.length; index += 500) {
  await db.batch(statements.slice(index, index + 500), "write");
}

const existingWorks = await db.execute("SELECT id FROM early_christian_works");
const prunedWorkIds = existingWorks.rows
  .map((row) => String(row.id))
  .filter((id) => !bookIds.has(id));

let prunedCount = 0;
let prunedPassageCount = 0;
let prunedChapterCount = 0;

for (let index = 0; index < prunedWorkIds.length; index += 200) {
  const ids = prunedWorkIds.slice(index, index + 200);
  const placeholders = ids.map(() => "?").join(", ");

  const counts = await db.execute({
    sql: `
      SELECT
        COUNT(DISTINCT passage_id) AS passages,
        COUNT(DISTINCT chapter_id) AS chapters
      FROM early_christian_passage_metadata
      WHERE work_id IN (${placeholders})
    `,
    args: ids
  });
  prunedPassageCount += Number(counts.rows[0]?.passages ?? 0);
  prunedChapterCount += Number(counts.rows[0]?.chapters ?? 0);

  await db.batch([
    {
      sql: `
        DELETE FROM paragraph_verses
        WHERE paragraph_id IN (
          SELECT passage_id
          FROM early_christian_passage_metadata
          WHERE work_id IN (${placeholders})
        )
      `,
      args: ids
    },
    {
      sql: `
        DELETE FROM passages
        WHERE id IN (
          SELECT passage_id
          FROM early_christian_passage_metadata
          WHERE work_id IN (${placeholders})
        )
      `,
      args: ids
    },
    {
      sql: `
        DELETE FROM early_christian_passage_metadata
        WHERE work_id IN (${placeholders})
      `,
      args: ids
    },
    {
      sql: `
        DELETE FROM early_christian_chapters
        WHERE work_id IN (${placeholders})
      `,
      args: ids
    },
    {
      sql: `
        DELETE FROM early_christian_works
        WHERE id IN (${placeholders})
      `,
      args: ids
    }
  ], "write");

  prunedCount += ids.length;
}

console.log(
  `Updated Church Fathers metadata for ${updatedCount} works in ${runtimeDbUrl}`
);
console.log(
  `Pruned ${prunedCount} excluded works, ${prunedChapterCount} chapters, and ${prunedPassageCount} passages`
);
