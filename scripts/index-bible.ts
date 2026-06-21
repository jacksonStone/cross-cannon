import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { ensureDatabase, getDb, normalizeVector, vectorSql } from "../app/lib/db.server";
import { embedText } from "../app/lib/embeddings.server";

type Verse = {
  book: string;
  chapter: number;
  verse: number;
  text: string;
};

type Passage = {
  id: string;
  resultType: "verse" | "chapter";
  book: string;
  chapter: number;
  verseStart: number | null;
  verseEnd: number | null;
  reference: string;
  text: string;
  sourceHash: string;
};

const inputPath = process.argv[2] ?? process.env.BIBLE_JSON_PATH ?? "data/sample-bible.json";
const absoluteInputPath = path.resolve(inputPath);

await ensureDatabase();

const raw = await readFile(absoluteInputPath, "utf8");
const parsed = JSON.parse(raw);
const verses = normalizeBibleJson(parsed);
const passages = buildPassages(verses);

if (passages.length === 0) {
  throw new Error(`No passages found in ${absoluteInputPath}`);
}

const db = getDb();

await db.execute("DELETE FROM passages_fts");
await db.execute("DELETE FROM passages");

let embeddedCount = 0;

for (const passage of passages) {
  const embedding = await embedText(`${passage.reference}\n${passage.text}`);
  const normalizedEmbedding = embedding ? normalizeVector(embedding) : null;

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

  await db.execute({
    sql: `
      INSERT INTO passages_fts(rowid, reference, text)
      SELECT rowid, reference, text
      FROM passages
      WHERE id = ?
    `,
    args: [passage.id]
  });

  if (normalizedEmbedding) {
    embeddedCount += 1;
  }
}

console.log(`Indexed ${passages.length} passages from ${absoluteInputPath}`);
console.log(`Embeddings stored for ${embeddedCount} passages`);

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

  const passages: Passage[] = sorted.map((verse) => ({
    id: stableId(`${verse.book}-${verse.chapter}-${verse.verse}`),
    resultType: "verse",
    book: verse.book,
    chapter: verse.chapter,
    verseStart: verse.verse,
    verseEnd: verse.verse,
    reference: `${verse.book} ${verse.chapter}:${verse.verse}`,
    text: verse.text.trim(),
    sourceHash: stableId(`${verse.book}-${verse.chapter}-${verse.verse}-${verse.text}`)
  }));

  const chapters = new Map<string, Verse[]>();

  for (const verse of sorted) {
    const key = `${verse.book}\t${verse.chapter}`;
    chapters.set(key, [...(chapters.get(key) ?? []), verse]);
  }

  for (const chapterVerses of chapters.values()) {
    const first = chapterVerses[0];
    const last = chapterVerses[chapterVerses.length - 1];
    passages.push({
      id: stableId(`${first.book}-${first.chapter}`),
      resultType: "chapter",
      book: first.book,
      chapter: first.chapter,
      verseStart: first.verse,
      verseEnd: last.verse,
      reference: `${first.book} ${first.chapter}`,
      text: chapterVerses.map((verse) => `${verse.verse} ${verse.text.trim()}`).join(" "),
      sourceHash: stableId(`${first.book}-${first.chapter}-${chapterVerses.map((verse) => verse.text).join("")}`)
    });
  }

  return passages;
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
