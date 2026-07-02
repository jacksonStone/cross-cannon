import assert from "node:assert/strict";
import test from "node:test";

import {
  emptyWindowRange,
  expandWindowEnd,
  expandWindowStart,
  getCenteredWindowRange,
  rangeContainsIndex
} from "./window-range";

test("getCenteredWindowRange returns an empty range without items", () => {
  assert.deepEqual(
    getCenteredWindowRange({ after: 10, before: 5, count: 0, index: 4 }),
    emptyWindowRange()
  );
});

test("getCenteredWindowRange clamps around a valid index", () => {
  assert.deepEqual(
    getCenteredWindowRange({ after: 10, before: 5, count: 30, index: 12 }),
    { endIndex: 22, startIndex: 7 }
  );
});

test("getCenteredWindowRange falls back to the first item for missing indexes", () => {
  assert.deepEqual(
    getCenteredWindowRange({ after: 10, before: 5, count: 30, index: -1 }),
    { endIndex: 10, startIndex: 0 }
  );
});

test("rangeContainsIndex only matches indexes inside a non-empty range", () => {
  assert.equal(rangeContainsIndex({ endIndex: 5, startIndex: 2 }, 4), true);
  assert.equal(rangeContainsIndex({ endIndex: 5, startIndex: 2 }, 1), false);
  assert.equal(rangeContainsIndex(emptyWindowRange(), 0), false);
});

test("expandWindowStart and expandWindowEnd clamp to available bounds", () => {
  assert.deepEqual(
    expandWindowStart({ endIndex: 20, startIndex: 8 }, 10),
    { endIndex: 20, startIndex: 0 }
  );
  assert.deepEqual(
    expandWindowEnd({ endIndex: 20, startIndex: 8 }, 23, 10),
    { endIndex: 22, startIndex: 8 }
  );
});
