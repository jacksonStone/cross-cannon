import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  BookIndex,
  ChapterAsset,
} from "~/features/early-christian-reader/types";
import { relatedCommentaryPassages } from "~/features/christian-classics/commentary-passages";

const index: BookIndex = JSON.parse(
  await readFile("public/christian-classics-text/books.json", "utf8")
);
const readChapter = async (assetPath: string): Promise<ChapterAsset> =>
  JSON.parse(await readFile(path.join("public", assetPath), "utf8"));

test("the imported collection preserves full source structure and declares the Wesley source gap", () => {
  const counts = Object.fromEntries(
    index.books.map((work) => [work.id, work.chapters.length])
  );
  assert.deepEqual(counts, {
    "classics:imitation": 114,
    "classics:catena": 89,
    "classics:henry": 1189,
    "classics:wesley": 1188,
  });
  const wesley = index.books.find((work) => work.id === "classics:wesley")!;
  assert.equal(
    wesley.chapters.filter(
      (chapter) => chapter.scriptureReference?.book === "Proverbs"
    ).length,
    31
  );
  assert.ok(
    !wesley.chapters.some(
      (chapter) =>
        chapter.scriptureReference?.book === "2 Samuel" &&
        chapter.scriptureReference.chapter === 24
    )
  );
  assert.match(wesley.metadata.edition ?? "", /2 Samuel 24/);
});

test("every catalog Chapter resolves to ordered, nonempty text with the original reference", async () => {
  for (const work of index.books)
    for (const entry of work.chapters) {
      const chapter = await readChapter(entry.assetPath);
      assert.equal(chapter.id, entry.id);
      assert.equal(chapter.verses.length, entry.verseCount);
      assert.ok(chapter.reference);
      assert.equal(chapter.metadata.source.id, work.metadata.source.id);
      chapter.verses.forEach((verse, index) => {
        assert.equal(verse.verse, index + 1);
        assert.ok(verse.text.trim());
      });
    }
});

test("passage commentary uses source verse coverage rather than unrelated chapter introductions", async () => {
  for (const id of ["classics:henry", "classics:wesley", "classics:catena"]) {
    const work = index.books.find((work) => work.id === id)!;
    const entry = work.chapters.find(
      (chapter) =>
        chapter.scriptureReference?.book === "Matthew" &&
        chapter.scriptureReference.chapter === 5
    )!;
    const chapter = await readChapter(entry.assetPath);
    const passages = relatedCommentaryPassages(chapter, 3, 6);
    assert.ok(passages.length, id);
    assert.ok(passages.every((passage) => passage.text.length > 0));
    assert.ok(
      !passages
        .map((passage) => passage.text)
        .join(" ")
        .includes("We have here a general account of this sermon.")
    );
    assert.equal(relatedCommentaryPassages(chapter, 1000, 1001).length, 0);
  }
});
