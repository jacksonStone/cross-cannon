import assert from "node:assert/strict";
import test from "node:test";

import { fitSingleLineText } from "./fit-single-line-text";

test("single-line text fitting corrects residual overflow after the first scale", () => {
  const baseFontSize = 28.48;
  const targetWidth = 314;
  let fontSize = baseFontSize;
  const measureWidth = () => (
    Math.ceil(399 * (fontSize / baseFontSize)) + 4
  );

  fitSingleLineText({
    availableWidth: 316,
    baseFontSize,
    measureWidth,
    setFontSize: (nextFontSize) => {
      fontSize = nextFontSize;
    }
  });

  assert.ok(
    measureWidth() <= targetWidth,
    `Expected fitted width at most ${targetWidth}px, got ${measureWidth()}px.`
  );
});
