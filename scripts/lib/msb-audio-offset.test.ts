import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync, brotliDecompressSync } from "node:zlib";
import { findIntroOffset, introClipEnd, reconcileIntroOffsets, type IntroTranscript } from "./msb-audio-offset";

const intro = (): IntroTranscript => ({
  duration: 8, text: "Audio Bible. Genesis chapter one.",
  words: [
    { word: "Audio", start: 1.14, end: 2.06 },
    { word: "Bible,", start: 2.06, end: 2.46 },
    { word: "Genesis", start: 3.9, end: 4.2 },
  ],
  segments: [{ avg_logprob: -0.79, no_speech_prob: 0.36 }],
});
test("starts just after Audio Bible while preserving the chapter announcement", () => {
  assert.deepEqual(findIntroOffset(intro()), { status: "detected", startSeconds: 2.46, reason: "after-audio-bible" });
});
test("does not shift into speech immediately after the intro", () => {
  const value = intro(); value.words![2].start = 2.5;
  assert.equal(findIntroOffset(value).startSeconds, 2.46);
});
test("joined AudioBible spelling preserves the same spoken phrase boundary", () => {
  const value = intro();
  value.words = [{ word: "AudioBible,", start: 1.14, end: 2.46 }, value.words![2]];
  assert.equal(findIntroOffset(value).startSeconds, 2.46);
});
test("connected speech needs no silence or padding after the target words", () => {
  const value = intro(); value.words![2].start = value.words![1].end;
  assert.equal(findIntroOffset(value).status, "detected");
  assert.equal(findIntroOffset(value).startSeconds, 2.46);
});
test("missing, ambiguous, or untimed phrases stay null for review", () => {
  for (const words of [undefined, [], [{ word: "Bible", start: 1, end: 2 }],
    [...intro().words!, { word: "Audio", start: 5, end: 5.5 }, { word: "Bible", start: 5.5, end: 6 }],
    [{ word: "Audio", start: 1, end: 1.1 }, { word: "Bible", start: 1.1, end: 1.1 }],
    [{ word: "Audio", start: 1, end: 2 }, { word: "Bible", start: 1, end: 3 }],
    [{ word: "Audio", start: 6.5, end: 7 }, { word: "Bible", start: 7, end: 8 }],
    [{ word: "Audio", start: 1, end: 2 }, { word: "Bible", start: 2, end: NaN }],
  ]) {
    const result = findIntroOffset({ ...intro(), words });
    assert.equal(result.status, "needs-review"); assert.equal(result.startSeconds, null);
  }
});
test("low confidence and audio outside the eight-second window need review", () => {
  for (const value of [
    { ...intro(), duration: 9 },
    { ...intro(), segments: [{ avg_logprob: -1.5, no_speech_prob: 0.1 }] },
    { ...intro(), segments: [{ avg_logprob: -1.3, no_speech_prob: 0.9 }] },
  ]) assert.equal(findIntroOffset(value).status, "needs-review");
});
test("bad confidence in trailing silence does not reject a clearly transcribed introduction", () => {
  const value = intro();
  value.segments = [
    { start: 1, end: 5, avg_logprob: -0.6, no_speech_prob: 0.2 },
    { start: 7, end: 8, avg_logprob: -1.5, no_speech_prob: 0.99 },
  ];
  assert.equal(findIntroOffset(value).status, "detected");
  value.segments[0].no_speech_prob = 0.99;
  assert.equal(findIntroOffset(value).status, "detected", "silence probability alone cannot reject a confident decode");
  value.segments[0].avg_logprob = -1.2;
  assert.equal(findIntroOffset(value).status, "needs-review");
});
test("retry clips keep the chapter announcements and never extend past eight seconds", () => {
  assert.equal(introClipEnd([{ start: 0, end: 1.5 }, { start: 2.5, end: 3.3 }, { start: 4.1, end: 6.4 }]), 4.3);
  assert.equal(introClipEnd([{ start: 7.1, end: 8 }]), 8);
  assert.equal(introClipEnd([]), 8);
});
test("a retry keeps confirmed older evidence and flags disagreement instead of guessing", () => {
  const missing = { ...intro(), text: "Genesis chapter one.", words: [] };
  const restored = reconcileIntroOffsets([{ source: "retry", transcript: missing }, { source: "original", transcript: intro() }]);
  assert.equal(restored.status, "detected"); assert.equal(restored.transcriptSource, "original");
  const shifted = intro(); shifted.words = shifted.words!.map(word => ({ ...word, start: word.start + 1, end: word.end + 1 }));
  const conflict = reconcileIntroOffsets([{ source: "retry", transcript: shifted }, { source: "original", transcript: intro() }]);
  assert.equal(conflict.status, "needs-review"); assert.equal(conflict.startSeconds, null);
});

test("the published index covers the entire catalog and never guesses review offsets", async () => {
  const catalog = JSON.parse(await readFile(new URL("../../public/scripture-translations/msb-audio.json", import.meta.url), "utf8"));
  const report = JSON.parse(await readFile(new URL("../../public/scripture-translations/msb-audio-offsets.json", import.meta.url), "utf8"));
  const review = await readFile(new URL("../../docs/research/msb-audio-offset-review.md", import.meta.url), "utf8");
  const expected = Object.entries(catalog.books).flatMap(([book, entry]) => {
    assert.ok(entry && typeof entry === "object" && "chapters" in entry && typeof entry.chapters === "number");
    return Array.from({ length: entry.chapters }, (_, i) => `${book}:${i + 1}`);
  });
  assert.equal(expected.length, 1189);
  assert.deepEqual(Object.keys(report.chapters).sort(), expected.sort());
  assert.equal(report.indexedChapters, 1189);
  assert.equal(report.clipSeconds, 8);
  assert.equal(report.timingMethod, "word-timestamps");
  const compactFile = new URL("../../public/msb-audio-offsets.json", import.meta.url);
  const compactBytes = await readFile(compactFile);
  const compact = JSON.parse(compactBytes.toString());
  assert.equal(compactBytes.toString(), JSON.stringify(compact), "The fetch file must be minified with no metadata");
  assert.deepEqual(Object.keys(compact).sort(), expected.sort());
  assert.deepEqual(gunzipSync(await readFile(new URL(`${compactFile}.gz`))), compactBytes);
  assert.deepEqual(brotliDecompressSync(await readFile(new URL(`${compactFile}.br`))), compactBytes);
  let detected = 0, uncertain = 0;
  for (const id of expected) {
    const entry = report.chapters[id];
    assert.match(entry.sourceSha256, /^[a-f0-9]{64}$/);
    if (entry.status === "detected") {
      detected++;
      assert.equal(entry.reason, "after-audio-bible");
      assert.ok(Number.isFinite(entry.startSeconds) && entry.startSeconds > 0 && entry.startSeconds < 8);
      assert.equal(compact[id], entry.startSeconds);
    } else {
      uncertain++;
      assert.equal(entry.status, "needs-review"); assert.equal(entry.startSeconds, null);
      assert.equal(compact[id], null);
      assert.ok(entry.reason); assert.ok(review.includes(`| ${id} |`));
    }
  }
  assert.equal(report.detectedChapters, detected); assert.equal(report.needsReviewChapters, uncertain);
});
