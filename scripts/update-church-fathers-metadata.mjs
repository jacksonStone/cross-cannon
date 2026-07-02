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

let updatedCount = 0;
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

console.log(`Updated Church Fathers metadata for ${updatedCount} works in ${runtimeDbUrl}`);
