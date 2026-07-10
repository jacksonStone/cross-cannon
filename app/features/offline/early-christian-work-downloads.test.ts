import assert from "node:assert/strict";
import test from "node:test";

import { isValidEarlyChristianChapterResponse } from "./early-christian-work-downloads";

test("validates a downloaded Early Christian Chapter", async () => {
  const response = jsonResponse({
    id: "work:chapter-1",
    verses: [
      { modernizedText: "Modern", text: "Original", verse: 1 },
      { text: "Original only", verse: 2 }
    ]
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

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" }
  });
}
