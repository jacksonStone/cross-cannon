import assert from "node:assert/strict";
import test from "node:test";

import {
  isBrowserPassage,
  isScriptureCachePayload
} from "./scripture-cache-contract";

test("isScriptureCachePayload accepts valid browser passages", () => {
  assert.equal(isScriptureCachePayload({
    passages: [
      {
        audioUrl: "/audio/genesis-1.mp3",
        id: "a",
        reference: "Genesis 1:1",
        text: "In the beginning",
        type: "paragraph",
        verses: [{ number: 1, text: "In the beginning" }]
      }
    ]
  }), true);
});

test("isBrowserPassage rejects invalid verse shapes", () => {
  assert.equal(isBrowserPassage({
    id: "a",
    reference: "Genesis 1:1",
    text: "In the beginning",
    type: "paragraph",
    verses: [{ number: "1", text: "In the beginning" }]
  }), false);
});

test("isScriptureCachePayload rejects invalid audio URL shapes", () => {
  assert.equal(isScriptureCachePayload({
    passages: [
      {
        audioUrl: 1,
        id: "a",
        reference: "Genesis 1:1",
        text: "In the beginning",
        type: "paragraph",
        verses: [{ number: 1, text: "In the beginning" }]
      }
    ]
  }), false);
});
