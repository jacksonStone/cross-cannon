import assert from "node:assert/strict";
import test from "node:test";

import {
  isSearchSourcePassageId,
  parseSearchMatchCount,
  validateSearchQuestion
} from "./search-request.server";

test("parseSearchMatchCount accepts valid match counts", () => {
  assert.deepEqual(parseSearchMatchCount("20"), { matchCount: 20 });
});

test("parseSearchMatchCount rejects out-of-range counts", () => {
  assert.deepEqual(parseSearchMatchCount("41"), {
    error: "Choose between 5 and 40 matches.",
    status: 400
  });
});

test("validateSearchQuestion enforces length limits", () => {
  assert.deepEqual(validateSearchQuestion("hope"), { question: "hope" });
  assert.deepEqual(validateSearchQuestion("no"), {
    error: "Enter a longer question.",
    status: 400
  });
  assert.deepEqual(validateSearchQuestion("x".repeat(501)), {
    error: "Keep the question under 500 characters.",
    status: 400
  });
});

test("isSearchSourcePassageId accepts indexed passage ids", () => {
  assert.equal(isSearchSourcePassageId("a".repeat(24)), true);
  assert.equal(isSearchSourcePassageId("not-a-passage"), false);
});
