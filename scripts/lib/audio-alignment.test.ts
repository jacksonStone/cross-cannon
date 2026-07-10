import assert from "node:assert/strict";
import test from "node:test";

import { audioAlignmentPolicies } from "../audio-alignment-policies";

import {
  alignTrackSections,
  findBestAlignmentWindow,
  normalizeAlignmentText,
  normalizeTranscriptWords,
  parseAudioAlignmentArgs,
  prepareAlignmentArtifact,
  romanNumeralToNumber,
  roundAlignmentSeconds,
  runChapterAudioAlignment,
  selectAlignmentPolicy,
  toRomanNumeral,
  type AlignmentPolicy
} from "./audio-alignment";

const firstClementPolicy: AlignmentPolicy = {
  matching: {
    defaultMinConfidence: 0.6,
    preference: "marker-first",
    startHints: {
      2: ["now", "all", "of", "you", "were", "humble", "minded"]
    },
    useEndNeedle: false,
    warnOnSkipped: "always"
  },
  name: "First Clement",
  parseChapterLocation: () => ({ book: 1, chapter: 2 }),
  workId: "anf09:xii.iv"
};

test("audio alignment selects an Early Christian Work by exact CCEL ID", () => {
  assert.deepEqual(
    parseAudioAlignmentArgs([
      "--work-id",
      "anf09:xii.iv",
      "--track",
      "Clemens-01~03.mp3",
      "--reset"
    ]),
    {
      book: null,
      dryRun: false,
      limit: null,
      minConfidence: null,
      reset: true,
      trackFileName: "Clemens-01~03.mp3",
      workId: "anf09:xii.iv"
    }
  );

  assert.equal(
    selectAlignmentPolicy("anf09:xii.iv", [firstClementPolicy]),
    firstClementPolicy
  );
  assert.throws(
    () => selectAlignmentPolicy("missing", [firstClementPolicy]),
    /Unknown Work ID missing.*anf09:xii\.iv/
  );
});

test("an Alignment Policy can prefer a Work-specific start hint", () => {
  const words = normalizeTranscriptWords([
    { end: 1, start: 0, word: "preface" },
    { end: 2, start: 1, word: "now" },
    { end: 3, start: 2, word: "all" },
    { end: 4, start: 3, word: "of" },
    { end: 5, start: 4, word: "you" },
    { end: 6, start: 5, word: "were" },
    { end: 7, start: 6, word: "humble" },
    { end: 8, start: 7, word: "minded" }
  ]);

  assert.deepEqual(
    alignTrackSections([
      {
        book: 1,
        chapter: 2,
        id: "anf09:xii.iv.ii",
        text: "unrelated source text",
        title: "Chapter II"
      }
    ], words, firstClementPolicy.matching, 0.6),
    [{
      confidence: 1,
      endSeconds: 8,
      section: {
        book: 1,
        chapter: 2,
        id: "anf09:xii.iv.ii",
        text: "unrelated source text",
        title: "Chapter II"
      },
      startSeconds: 1
    }]
  );
});

test("alignment artifacts merge by default and reset only when requested", () => {
  const existing = {
    old: {
      audioUrl: "old.mp3",
      confidence: 0.7,
      endSeconds: 20,
      label: "Old",
      startSeconds: 10
    }
  };
  const generated = {
    next: {
      audioUrl: "next.mp3",
      confidence: 0.9,
      endSeconds: 30,
      label: "Next",
      startSeconds: 20
    }
  };
  const sections = [
    { book: 1, chapter: 1, id: "old", text: "", title: "Old" },
    { book: 1, chapter: 2, id: "next", text: "", title: "Next" }
  ];

  assert.deepEqual(
    prepareAlignmentArtifact({
      boundaryOffsetSeconds: undefined,
      existing,
      generated,
      generatedAt: "2026-07-10T00:00:00.000Z",
      reset: false,
      sections,
      source: "https://example.test"
    }),
    {
      chapters: { old: existing.old, next: generated.next },
      generatedAt: "2026-07-10T00:00:00.000Z",
      source: "https://example.test"
    }
  );

  assert.deepEqual(
    Object.keys(prepareAlignmentArtifact({
      boundaryOffsetSeconds: undefined,
      existing,
      generated,
      generatedAt: "2026-07-10T00:00:00.000Z",
      reset: true,
      sections,
      source: "https://example.test"
    }).chapters),
    ["next"]
  );
});

test("the shared command dry-runs every configured Early Christian Work", async () => {
  const expected = new Map([
    ["anf09:xii.iv", { chapterCount: 65, trackCount: 1 }],
    ["npnf101:vi", { chapterCount: 275, trackCount: 31 }],
    ["npnf102:iv", { chapterCount: 664, trackCount: 69 }]
  ]);

  for (const [workId, counts] of expected) {
    const result = await runChapterAudioAlignment(
      ["--work-id", workId, "--dry-run"],
      audioAlignmentPolicies,
      { log() {} }
    );

    assert.equal(result.workId, workId);
    assert.equal(result.chapterCount, counts.chapterCount);
    assert.equal(result.trackCount, counts.trackCount);
  }
});

test("audio alignment normalization preserves the existing token contract", () => {
  assert.deepEqual(normalizeAlignmentText("Grace & peace—always!"), [
    "grace",
    "and",
    "peacealways"
  ]);
  assert.deepEqual(normalizeTranscriptWords([
    { end: 1, start: 0, word: "Grace," },
    { end: 2, start: 1, word: "..." }
  ]), [
    { end: 1, normalized: "grace", start: 0, word: "Grace," }
  ]);
});

test("audio alignment finds the same best LCS window", () => {
  assert.deepEqual(
    findBestAlignmentWindow(
      ["intro", "grace", "and", "peace", "ending"],
      ["grace", "peace"],
      0
    ),
    { index: 0, score: 1 }
  );
});

test("audio alignment shares numeral and timestamp formatting", () => {
  assert.equal(romanNumeralToNumber("xliv"), 44);
  assert.equal(toRomanNumeral(44), "XLIV");
  assert.equal(roundAlignmentSeconds(12.349), 12.3);
});
