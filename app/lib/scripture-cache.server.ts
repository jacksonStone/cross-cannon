import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { getDb } from "./db.server";

export type BrowserPassage = {
  id: string;
  reference: string;
  text: string;
  type: "paragraph";
  verses: Array<{
    number: number;
    text: string;
  }>;
};

export async function getScriptureCacheVersion() {
  const response = await getDb().execute(`
    SELECT
      (SELECT COUNT(*) FROM passages) AS passage_count,
      (SELECT COUNT(*) FROM paragraph_verses) AS verse_count,
      (SELECT COALESCE(MAX(id), '') FROM passages) AS max_passage_id,
      (SELECT COALESCE(MAX(source_hash), '') FROM paragraph_verses) AS max_verse_hash
  `);
  const row = response.rows[0];

  return createHash("sha256")
    .update([
      row?.passage_count,
      row?.verse_count,
      row?.max_passage_id,
      row?.max_verse_hash
    ].join("-"))
    .digest("hex")
    .slice(0, 16);
}

export async function getScriptureCacheInfo() {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(process.cwd(), "scripture-cache/manifest.json"), "utf8")
    ) as {
      version?: unknown;
      jsonPath?: unknown;
    };

    if (typeof manifest.version === "string" && typeof manifest.jsonPath === "string") {
      return {
        version: manifest.version,
        url: manifest.jsonPath
      };
    }
  } catch {
    // Local dev can run before the static cache artifact has been generated.
  }

  const version = await getScriptureCacheVersion();
  return {
    version,
    url: `/scripture-cache/${version}.json`
  };
}

export async function buildScriptureCachePayload() {
  const response = await getDb().execute(`
    SELECT id, reference, text, result_type
    FROM passages
    WHERE text <> ''
    ORDER BY book, chapter, verse_start IS NULL, verse_start
  `);
  const versesResponse = await getDb().execute(`
    SELECT paragraph_id, verse, text
    FROM paragraph_verses
    ORDER BY book, chapter, verse
  `);
  const versesByParagraph = new Map<string, BrowserPassage["verses"]>();

  for (const row of versesResponse.rows) {
    const paragraphId = String(row.paragraph_id);
    const verses = versesByParagraph.get(paragraphId) ?? [];
    verses.push({
      number: Number(row.verse),
      text: String(row.text)
    });
    versesByParagraph.set(paragraphId, verses);
  }

  return {
    passages: response.rows.map((row) => ({
      id: String(row.id),
      reference: String(row.reference),
      text: String(row.text),
      type: "paragraph",
      verses: versesByParagraph.get(String(row.id)) ?? []
    })) satisfies BrowserPassage[]
  };
}
