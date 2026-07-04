import assert from "node:assert/strict";
import test from "node:test";

import {
  MATCH_STRENGTH_THRESHOLDS,
  scoreToMatchStrength,
  withCalibratedMatchStrength
} from "./match-strength";

test("scoreToMatchStrength uses calibrated cosine thresholds", () => {
  assert.equal(scoreToMatchStrength(undefined), 1);
  assert.equal(scoreToMatchStrength(0.55), 1);
  assert.equal(scoreToMatchStrength(MATCH_STRENGTH_THRESHOLDS.plausible), 2);
  assert.equal(scoreToMatchStrength(MATCH_STRENGTH_THRESHOLDS.strong), 3);
  assert.equal(scoreToMatchStrength(MATCH_STRENGTH_THRESHOLDS.excellent), 4);
});

test("withCalibratedMatchStrength does not rank scores relative to the result set", () => {
  assert.deepEqual(
    withCalibratedMatchStrength([
      { id: "top", score: 0.55 },
      { id: "second", score: 0.54 }
    ]),
    [
      { id: "top", matchStrength: 1, score: 0.55 },
      { id: "second", matchStrength: 1, score: 0.54 }
    ]
  );
});
