import { gzipSync } from "node:zlib";

import type { LoaderFunctionArgs } from "@remix-run/node";

import { ensureDatabase, getDb } from "~/lib/db.server";

type BrowserPassage = {
  id: string;
  reference: string;
  text: string;
  type: "paragraph";
  verses: Array<{
    number: number;
    text: string;
  }>;
};

let scriptureCache:
  | {
      version: string;
      body: string;
      gzippedBody: Buffer;
    }
  | null = null;

export async function loader({ request }: LoaderFunctionArgs) {
  await ensureDatabase();

  const version = await getScriptureCacheVersion();
  const cache = scriptureCache?.version === version
    ? scriptureCache
    : await buildScriptureCache(version);
  const acceptsGzip = request.headers.get("Accept-Encoding")?.includes("gzip") ?? false;
  const headers = new Headers({
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Type": "application/json; charset=utf-8",
    "ETag": `"${version}"`,
    "Vary": "Accept-Encoding"
  });

  if (!acceptsGzip) {
    return new Response(cache.body, { headers });
  }

  headers.set("Content-Encoding", "gzip");
  return new Response(new Uint8Array(cache.gzippedBody), { headers });
}

async function buildScriptureCache(version: string) {
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

  const body = JSON.stringify({
    passages: response.rows.map((row) => ({
      id: String(row.id),
      reference: String(row.reference),
      text: String(row.text),
      type: "paragraph",
      verses: versesByParagraph.get(String(row.id)) ?? []
    })) satisfies BrowserPassage[]
  });
  scriptureCache = {
    version,
    body,
    gzippedBody: gzipSync(body)
  };

  return scriptureCache;
}

async function getScriptureCacheVersion() {
  const response = await getDb().execute(`
    SELECT
      (SELECT COUNT(*) FROM passages) AS passage_count,
      (SELECT COUNT(*) FROM paragraph_verses) AS verse_count,
      (SELECT COALESCE(MAX(id), '') FROM passages) AS max_passage_id,
      (SELECT COALESCE(MAX(source_hash), '') FROM paragraph_verses) AS max_verse_hash
  `);
  const row = response.rows[0];

  return [
    row?.passage_count,
    row?.verse_count,
    row?.max_passage_id,
    row?.max_verse_hash
  ].join("-");
}
