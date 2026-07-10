import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEarlyChristianReaderUrl,
  buildScriptureReaderUrl
} from "./reader-links";

test("Scripture Reader Links preserve passage and filter scope", () => {
  assert.equal(
    buildScriptureReaderUrl("web:John:3:16", {
      books: ["John", "Romans"],
      canon: "catholic",
      matchCount: 20
    }),
    "/reader/web:John:3:16?canon=catholic&matchCount=20&books=John&books=Romans"
  );
});

test("Early Christian Reader Links encode chapter and optional passage range", () => {
  assert.equal(
    buildEarlyChristianReaderUrl("npnf101:vi.I_1.XIV", "4-6"),
    "/church-fathers?chapter=npnf101%3Avi.I_1.XIV&passage=4-6"
  );
  assert.equal(
    buildEarlyChristianReaderUrl("npnf101:vi.I_1.XIV"),
    "/church-fathers?chapter=npnf101%3Avi.I_1.XIV"
  );
});
