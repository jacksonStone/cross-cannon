import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getDb } from "./db";
import { buildScriptureCachePayload, getScriptureCachePayloadVersion } from "./scripture-cache";

test("cache generation retains canonical passages, ordered verses and audio without empty text", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "crosscanon-cache-tool-"));
  process.env.DATABASE_URL = `file:${path.join(directory, "index.db")}`;
  const db = getDb();
  try {
    await db.batch([
      "CREATE TABLE passages (id TEXT PRIMARY KEY, reference TEXT, text TEXT, result_type TEXT, book TEXT, chapter INTEGER, verse_start INTEGER)",
      "CREATE TABLE paragraph_verses (paragraph_id TEXT, verse INTEGER, text TEXT, book TEXT, chapter INTEGER)",
      "CREATE TABLE passage_audio_files (passage_id TEXT, audio_url TEXT)",
      "INSERT INTO passages VALUES ('later', 'John 3:17', 'Later paragraph', 'paragraph', 'John', 3, 17), ('first', 'John 3:16', 'First paragraph', 'paragraph', 'John', 3, 16), ('empty', 'John 3:18', '', 'paragraph', 'John', 3, 18)",
      "INSERT INTO paragraph_verses VALUES ('first', 16, 'First verse', 'John', 3), ('later', 18, 'Second verse', 'John', 3), ('later', 17, 'Earlier verse', 'John', 3)",
      "INSERT INTO passage_audio_files VALUES ('first', '/audio/chapter-3.mp3')",
    ], "write");
    const payload = await buildScriptureCachePayload();
    assert.deepEqual(payload, { passages: [
      { id: "first", reference: "John 3:16", text: "First paragraph", type: "paragraph", audioUrl: "/audio/chapter-3.mp3", verses: [{ number: 16, text: "First verse" }] },
      { id: "later", reference: "John 3:17", text: "Later paragraph", type: "paragraph", audioUrl: undefined, verses: [{ number: 17, text: "Earlier verse" }, { number: 18, text: "Second verse" }] },
    ] });
    const version = getScriptureCachePayloadVersion(payload);
    assert.match(version, /^[a-f0-9]{16}$/);
    assert.equal(getScriptureCachePayloadVersion(await buildScriptureCachePayload()), version);
    await db.execute("UPDATE paragraph_verses SET text = 'Corrected source text' WHERE paragraph_id = 'first'");
    assert.notEqual(getScriptureCachePayloadVersion(await buildScriptureCachePayload()), version);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
