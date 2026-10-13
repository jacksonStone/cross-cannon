import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { audioFileResponse } from "./audio-response.server";

test("audio streams byte ranges and HEAD without downloading the whole work", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "continuous-audio-"));
  const file = path.join(directory, "book.m4a");
  await writeFile(file, "0123456789");
  try {
    for (const [range, expected, contentRange] of [
      ["bytes=3-5", "345", "bytes 3-5/10"],
      ["bytes=8-", "89", "bytes 8-9/10"],
      ["bytes=-2", "89", "bytes 8-9/10"],
      ["bytes=8-99", "89", "bytes 8-9/10"],
    ]) {
      const response = await audioFileResponse(
        new Request("http://local/audio", { headers: { Range: range } }),
        file,
        "audio/mp4"
      );
      assert.equal(response.status, 206);
      assert.equal(response.headers.get("content-range"), contentRange);
      assert.equal(
        response.headers.get("content-length"),
        String(expected.length)
      );
      assert.equal(await response.text(), expected);
    }
    for (const range of [
      "bytes=10-",
      "bytes=4-2",
      "bytes=-0",
      "bytes=",
      "bytes=0-1,3-4",
    ]) {
      const response = await audioFileResponse(
        new Request("http://local/audio", { headers: { Range: range } }),
        file,
        "audio/mp4"
      );
      assert.equal(response.status, 416);
      assert.equal(response.headers.get("content-range"), "bytes */10");
    }
    const head = await audioFileResponse(
      new Request("http://local/audio", { method: "HEAD" }),
      file,
      "audio/mp4"
    );
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), "10");
    assert.equal(await head.text(), "");
    const full = await audioFileResponse(
      new Request("http://local/audio"),
      file,
      "audio/mp4"
    );
    assert.equal(await full.text(), "0123456789");
    await assert.rejects(
      audioFileResponse(
        new Request("http://local/audio"),
        `${file}-missing`,
        "audio/mp4"
      ),
      (error: unknown) => error instanceof Response && error.status === 404
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
