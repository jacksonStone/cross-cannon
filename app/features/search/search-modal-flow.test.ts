import assert from "node:assert/strict";
import test from "node:test";

import {
  initialSearchModalFlowState,
  searchModalFlowReducer
} from "./search-modal-flow";

test("search modal flow opens and closes without changing focus", () => {
  const open = searchModalFlowReducer(
    { focusedId: "abc", isOpen: false },
    { type: "open" }
  );

  assert.deepEqual(open, { focusedId: "abc", isOpen: true });
  assert.deepEqual(
    searchModalFlowReducer(open, { type: "close" }),
    { focusedId: "abc", isOpen: false }
  );
});

test("theme results clear focused passage and open search", () => {
  assert.deepEqual(
    searchModalFlowReducer(
      { focusedId: "abc", isOpen: false },
      { type: "theme-results" }
    ),
    { focusedId: null, isOpen: true }
  );
});

test("similar transitions focus the submitted source and open search", () => {
  assert.deepEqual(
    searchModalFlowReducer(initialSearchModalFlowState, {
      focusedId: "source",
      type: "submitting-similar"
    }),
    { focusedId: "source", isOpen: true }
  );
  assert.deepEqual(
    searchModalFlowReducer(initialSearchModalFlowState, {
      focusedId: "source",
      type: "similar-results"
    }),
    { focusedId: "source", isOpen: true }
  );
});
