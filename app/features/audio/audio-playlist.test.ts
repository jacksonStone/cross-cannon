import assert from "node:assert/strict";
import test from "node:test";
import {
  chapterAtTime,
  nextAudioChapter,
  type AudioChapter,
} from "./audio-playlist";

const chapters: AudioChapter[] = [
  {
    id: "one",
    title: "One",
    workId: "book",
    audio: { url: "/book.m4a", startSeconds: 0, endSeconds: 10 },
  },
  {
    id: "two",
    title: "Two",
    workId: "book",
    audio: { url: "/book.m4a", startSeconds: 12, endSeconds: 20 },
  },
  {
    id: "three",
    title: "Three",
    workId: "book",
    audio: { url: "/book.m4a", startSeconds: 20, endSeconds: 30 },
  },
  {
    id: "other",
    title: "Other",
    workId: "other",
    audio: { url: "/other.m4a", startSeconds: 0 },
  },
];
test("resuming after suspended JS finds the audible chapter without replaying skipped chapters", () => {
  assert.equal(chapterAtTime(chapters, "/book.m4a", 25)?.id, "three");
  assert.equal(chapterAtTime(chapters, "/book.m4a", 20)?.id, "three");
  assert.equal(chapterAtTime(chapters, "/book.m4a", 11), undefined);
  assert.equal(chapterAtTime(chapters, "/book.m4a", 30), undefined);
  assert.equal(chapterAtTime(chapters, "/missing.m4a", 0), undefined);
});
test("next/previous chapter stay within a work and do not skip missing audio", () => {
  assert.equal(nextAudioChapter(chapters, "one")?.id, "two");
  assert.equal(nextAudioChapter(chapters, "two", -1)?.id, "one");
  assert.equal(nextAudioChapter(chapters, "one", -1), null);
  assert.equal(nextAudioChapter(chapters, "three"), null);
  assert.equal(nextAudioChapter(chapters, "missing"), null);
  assert.equal(
    nextAudioChapter([chapters[0], { ...chapters[1], audio: null }], "one"),
    null
  );
});
test("ambiguous legacy track offsets preserve the first mapped chapter", () => {
  assert.equal(
    chapterAtTime(
      [
        { ...chapters[0], audio: { url: "/old.mp3", startSeconds: 0 } },
        { ...chapters[1], audio: { url: "/old.mp3", startSeconds: 0 } },
      ],
      "/old.mp3",
      40
    )?.id,
    "one"
  );
});
