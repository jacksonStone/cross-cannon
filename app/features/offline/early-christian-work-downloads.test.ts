import assert from "node:assert/strict";
import test from "node:test";

import { isValidEarlyChristianChapterResponse } from "./early-christian-work-downloads";
import { promoteCompletedWorkGenerations } from "./offline-work-storage.client";

test("validates a downloaded Early Christian Chapter", async () => {
  const response = jsonResponse({
    id: "work:chapter-1",
    verses: [
      { modernizedText: "Modern", text: "Original", verse: 1 },
      { text: "Original only", verse: 2 },
    ],
  });

  assert.equal(
    await isValidEarlyChristianChapterResponse(response, "work:chapter-1"),
    true
  );
});

test("rejects corrupt or unexpected Chapter responses", async () => {
  assert.equal(
    await isValidEarlyChristianChapterResponse(
      jsonResponse({ id: "another-chapter", verses: [] }),
      "work:chapter-1"
    ),
    false
  );
  assert.equal(
    await isValidEarlyChristianChapterResponse(
      jsonResponse({ id: "work:chapter-1", verses: [{ text: 42, verse: 1 }] })
    ),
    false
  );
  assert.equal(
    await isValidEarlyChristianChapterResponse(
      new Response("<html>Server error</html>", { status: 200 })
    ),
    false
  );
});

test("promotes only validated Work replacements on the next reader mount", async () => {
  const active = {
    cacheName: "cross-canon-work-v1-work-old",
    chapterUrls: ["/old"],
    complete: true,
    completedAt: 1,
    version: "old",
  };
  const staged = await promoteCompletedWorkGenerations(
    {
      ready: {
        ...active,
        pending: {
          cacheName: "cross-canon-work-v1-work-new",
          chapterUrls: ["/new"],
          complete: true,
          completedAt: 2,
          version: "new",
        },
      },
      evicted: {
        ...active,
        pending: {
          cacheName: "cross-canon-work-v1-work-evicted",
          chapterUrls: ["/evicted"],
          complete: true,
          version: "new",
        },
      },
      validationError: {
        ...active,
        pending: {
          cacheName: "cross-canon-work-v1-work-error",
          chapterUrls: ["/error"],
          complete: true,
          version: "new",
        },
      },
      interrupted: {
        ...active,
        pending: {
          cacheName: "cross-canon-work-v1-work-partial",
          chapterUrls: ["/partial"],
          version: "new",
        },
      },
    },
    async (generation) => {
      if (generation.cacheName.endsWith("-error")) {
        throw new Error("Cache unavailable");
      }

      return generation.cacheName.endsWith("-new");
    }
  );

  assert.deepEqual(staged.ready, {
    cacheName: "cross-canon-work-v1-work-new",
    chapterUrls: ["/new"],
    complete: true,
    completedAt: 2,
    version: "new",
  });
  assert.equal(staged.evicted.version, "old");
  assert.equal(staged.evicted.pending?.version, "new");
  assert.equal(staged.validationError.version, "old");
  assert.equal(staged.interrupted.version, "old");
  assert.equal(staged.interrupted.pending?.version, "new");
});

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}
