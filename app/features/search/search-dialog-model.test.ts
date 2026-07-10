import assert from "node:assert/strict";
import test from "node:test";

import {
  getSearchDialogFilterState,
  getSearchDialogIntent,
  resolveSearchDialogTarget
} from "./search-dialog-model";

const intentCases = [
  ["scripture", false, "scripture", "theme"],
  ["scripture", false, "early-christian", "theme-early-christian"],
  ["scripture", true, "scripture", "similar-passage"],
  ["scripture", true, "early-christian", "similar-early-christian"],
  ["early-christian", false, "early-christian", "theme"],
  ["early-christian", false, "scripture", "theme-scripture"],
  ["early-christian", true, "early-christian", "similar-passage"],
  ["early-christian", true, "scripture", "similar-scripture"]
] as const;

for (const [readerCorpus, hasFocusedPassage, targetCorpus, expected] of intentCases) {
  test(`${readerCorpus} dialog maps ${hasFocusedPassage ? "focused" : "theme"} ${targetCorpus} intent`, () => {
    assert.equal(getSearchDialogIntent({
      hasFocusedPassage,
      readerCorpus,
      targetCorpus
    }), expected);
  });
}

test("dialog filters count only the active corpus scope", () => {
  assert.deepEqual(getSearchDialogFilterState({
    authorCount: 2,
    bookCount: 3,
    isDefaultMatchCount: false,
    targetCorpus: "scripture"
  }), {
    activeFilterCount: 4,
    showAuthorFilters: false,
    showScriptureFilters: true
  });
});

test("dialog target resolves explicit results before reader defaults", () => {
  assert.equal(resolveSearchDialogTarget({
    actionMode: "theme-scripture",
    readerCorpus: "early-christian"
  }), "scripture");
  assert.equal(resolveSearchDialogTarget({
    actionMode: "theme",
    actionTargetCorpus: "early-christian",
    readerCorpus: "scripture"
  }), "early-christian");
});
