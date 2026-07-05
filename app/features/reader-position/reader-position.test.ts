import assert from "node:assert/strict";
import test from "node:test";

import {
  createReaderLocation,
  readReaderLocation,
  readReaderPosition,
  rememberReaderLocation,
  rememberReaderPosition
} from "./reader-position";

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

test("readReaderLocation migrates legacy chapter keys", () => {
  const localStorage = createLocalStorage();
  setTestWindow(localStorage);
  localStorage.setItem("reader:key", "Psalms\t149");

  assert.deepEqual(readReaderLocation("reader:key", "scripture"), {
    chapterKey: "Psalms\t149",
    corpus: "scripture",
    passageKey: undefined,
    passageRange: undefined,
    version: 2
  });
  assert.equal(readReaderPosition("reader:key"), "Psalms\t149");
});

test("rememberReaderLocation stores a versioned reader location", () => {
  const localStorage = createLocalStorage();
  setTestWindow(localStorage);

  const savedRef = { current: "" };
  const lastReportedRef = { current: "" };
  const location = createReaderLocation({
    chapterKey: "npnf101:vi.I_1.XIV",
    corpus: "fathers",
    passageRange: "11-13"
  });

  assert.equal(
    rememberReaderLocation("reader:key", location, {
      lastReportedRef,
      savedRef
    }),
    true
  );
  assert.deepEqual(readReaderLocation("reader:key", "fathers"), location);
  assert.equal(readReaderPosition("reader:key"), "npnf101:vi.I_1.XIV");
  assert.equal(
    rememberReaderLocation("reader:key", location, {
      lastReportedRef,
      savedRef
    }),
    false
  );
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
