import assert from "node:assert/strict";
import test from "node:test";

import { readReaderPosition, rememberReaderPosition } from "./reader-position";

test("rememberReaderPosition writes once and updates tracking refs", () => {
  const localStorage = createLocalStorage();
  setTestWindow(localStorage);

  const savedRef = { current: "" };
  const lastReportedRef = { current: "" };

  assert.equal(readReaderPosition("reader:key"), "");
  assert.equal(
    rememberReaderPosition("reader:key", "Genesis:1", {
      lastReportedRef,
      savedRef
    }),
    true
  );
  assert.equal(localStorage.getItem("reader:key"), "Genesis:1");
  assert.equal(savedRef.current, "Genesis:1");
  assert.equal(lastReportedRef.current, "Genesis:1");
  assert.equal(
    rememberReaderPosition("reader:key", "Genesis:1", {
      lastReportedRef,
      savedRef
    }),
    false
  );
});

test("rememberReaderPosition writes when reported and saved refs diverge", () => {
  const localStorage = createLocalStorage();
  setTestWindow(localStorage);

  const savedRef = { current: "Psalms:50" };
  const lastReportedRef = { current: "Psalms:60" };

  assert.equal(
    rememberReaderPosition("reader:key", "Psalms:60", {
      lastReportedRef,
      savedRef
    }),
    true
  );
  assert.equal(localStorage.getItem("reader:key"), "Psalms:60");
  assert.equal(savedRef.current, "Psalms:60");
  assert.equal(lastReportedRef.current, "Psalms:60");
});

function createLocalStorage() {
  const values = new Map<string, string>();

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    }
  };
}

function setTestWindow(localStorage: ReturnType<typeof createLocalStorage>) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage
    }
  });
}
