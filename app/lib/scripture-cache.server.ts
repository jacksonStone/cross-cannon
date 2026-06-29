import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { ensureDatabase, getDb } from "./db.server";

export type BrowserPassage = {
  audioUrl?: string;
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
  await ensureDatabase();

  const response = await getDb().execute(`
    SELECT
      (SELECT COUNT(*) FROM passages) AS passage_count,
      (SELECT COUNT(*) FROM paragraph_verses) AS verse_count,
      (SELECT COUNT(*) FROM passage_audio_files) AS audio_count,
      (SELECT COALESCE(MAX(id), '') FROM passages) AS max_passage_id,
      (SELECT COALESCE(MAX(source_hash), '') FROM paragraph_verses) AS max_verse_hash,
      (SELECT COALESCE(MAX(updated_at), '') FROM passage_audio_files) AS max_audio_updated_at
  `);
  const row = response.rows[0];

  return createHash("sha256")
    .update([
      row?.passage_count,
      row?.verse_count,
      row?.audio_count,
      row?.max_passage_id,
      row?.max_verse_hash,
      row?.max_audio_updated_at
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
    SELECT p.id, p.reference, p.text, p.result_type, paf.audio_url
    FROM passages p
    LEFT JOIN passage_audio_files paf
      ON paf.passage_id = p.id
    WHERE p.text <> ''
    ORDER BY p.book, p.chapter, p.verse_start IS NULL, p.verse_start
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
      audioUrl: typeof row.audio_url === "string" ? row.audio_url : undefined,
      id: String(row.id),
      reference: String(row.reference),
      text: String(row.text),
      type: "paragraph",
      verses: versesByParagraph.get(String(row.id)) ?? []
    })) satisfies BrowserPassage[]
  };
}
