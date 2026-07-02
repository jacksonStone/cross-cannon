import assert from "node:assert/strict";
import test from "node:test";

import type { BrowserPassage } from "~/lib/scripture-cache.server";

import {
  buildChapterIndex,
  chapterKey,
  parsePassageLocation
} from "./chapter-index";

const passages: BrowserPassage[] = [
  {
    id: "a",
    reference: "Genesis 1:1-3",
    text: "First",
    type: "paragraph",
    verses: [
      { number: 1, text: "In the beginning" },
      { number: 2, text: "The earth" },
      { number: 3, text: "God said" }
    ]
  },
  {
    audioUrl: "/audio/genesis-1.mp3",
    id: "b",
    reference: "Genesis 1:4-5",
    text: "Second",
    type: "paragraph",
    verses: [
      { number: 4, text: "God saw" },
      { number: 5, text: "Evening" }
    ]
  },
  {
    id: "c",
    reference: "Genesis 2:1",
    text: "Third",
    type: "paragraph",
    verses: [{ number: 1, text: "Finished" }]
  }
];

test("parsePassageLocation reads book, chapter, and verse range", () => {
  assert.deepEqual(parsePassageLocation("Song of Solomon 2:10-13"), {
    book: "Song of Solomon",
    chapter: 2,
    verseEnd: 13,
    verseStart: 10
  });
  assert.equal(parsePassageLocation("not a passage"), null);
});

test("buildChapterIndex groups passages by chapter and preserves passage locations", () => {
  const index = buildChapterIndex(passages);
  const genesisOne = index.chaptersByKey.get(chapterKey("Genesis", 1));

  assert.equal(genesisOne?.passages.length, 2);
  assert.equal(genesisOne?.passages[0].id, "a");
  assert.equal(genesisOne?.passages[1].id, "b");
  assert.deepEqual(index.locationByPassageId.get("b"), {
    book: "Genesis",
    chapter: 1,
    verseEnd: 5,
    verseStart: 4
  });
});

test("buildChapterIndex orders chapter keys within each book", () => {
  const index = buildChapterIndex(passages);

  assert.deepEqual(index.orderedKeysByBook.get("Genesis"), [
    chapterKey("Genesis", 1),
    chapterKey("Genesis", 2)
  ]);
});
