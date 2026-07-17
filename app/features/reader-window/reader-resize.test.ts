import assert from "node:assert/strict";
import test from "node:test";

import { shouldPreserveReaderAnchorOnResize } from "./reader-resize";

test("reader anchor preservation ignores toolbar-only viewport height changes", () => {
  assert.equal(shouldPreserveReaderAnchorOnResize(390, 390), false);
});

test("reader anchor preservation runs when the layout width changes", () => {
  assert.equal(shouldPreserveReaderAnchorOnResize(390, 360), true);
});
