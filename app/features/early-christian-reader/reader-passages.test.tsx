import assert from "node:assert/strict";
import test from "node:test";

import { buildModernizedTextParts } from "./modernized-text";
import {
  findLoadedPassage,
  groupChapterPassages,
  isSelectedReaderPassage
} from "./reader-passages";

const chapter = {
  book: "Confessions",
  chapter: 1,
  id: "npnf101:vi.I_1.I",
  verses: [
    { text: "Great art thou.", verse: 1 },
    { text: "And greatly to be praised.", verse: 2 },
    { text: "Great is thy power.", verse: 3 },
    { text: "And thy wisdom infinite.", verse: 4 }
  ]
};

test("groupChapterPassages groups short trailing passages into the previous passage", () => {
  const passages = groupChapterPassages(chapter);

  assert.equal(passages.length, 1);
  assert.equal(passages[0].key, "npnf101:vi.I_1.I:1-4");
  assert.equal(passages[0].rangeLabel, "1-4");
  assert.match(passages[0].text, /Great art thou/);
});

test("findLoadedPassage and isSelectedReaderPassage match containing ranges", () => {
  const loadedPassage = findLoadedPassage(
    new Map([[chapter.id, chapter]]),
    "npnf101:vi.I_1.I:1-4",
    "modernized"
  );

  assert(loadedPassage);
  assert.equal(
    isSelectedReaderPassage({
      chapterId: chapter.id,
      passage: loadedPassage,
      selectedChapterId: chapter.id,
      selectedRange: "2-3"
    }),
    true
  );
});

test("buildModernizedTextParts marks only unmatched modernized words", () => {
  assert.deepEqual(
    buildModernizedTextParts(
      "For ye did all things.",
      "For you did all things."
    ),
    [
      { changed: false, text: "For" },
      { changed: false, text: " " },
      { changed: true, text: "you" },
      { changed: false, text: " " },
      { changed: false, text: "did" },
      { changed: false, text: " " },
      { changed: false, text: "all" },
      { changed: false, text: " " },
      { changed: false, text: "things." }
    ]
  );
});
