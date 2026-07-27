import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("the Kindle export command creates a navigable EPUB from Bible JSON", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cross-cannon-epub-"));
  const outputPath = path.join(tempDir, "bible.epub");

  try {
    const exportResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/export-kindle-bible.ts",
        "--input",
        "data/sample-bible.json",
        "--output",
        outputPath
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8"
      }
    );

    assert.equal(
      exportResult.status,
      0,
      `${exportResult.stdout}\n${exportResult.stderr}`
    );

    const entries = runUnzip(["-Z1", outputPath]).trim().split("\n");
    assert.deepEqual(entries.slice(0, 4), [
      "mimetype",
      "META-INF/container.xml",
      "EPUB/package.opf",
      "EPUB/nav.xhtml"
    ]);
    assert.ok(entries.includes("EPUB/text/book-001.xhtml"));
    assert.ok(entries.includes("EPUB/text/book-005.xhtml"));

    assert.equal(
      runUnzip(["-p", outputPath, "mimetype"]),
      "application/epub+zip"
    );

    const navigation = runUnzip(["-p", outputPath, "EPUB/nav.xhtml"]);
    assert.match(navigation, /<a href="text\/book-001\.xhtml">Genesis<\/a>/);
    assert.match(
      navigation,
      /<a href="text\/book-001\.xhtml#genesis-chapter-1">Chapter 1<\/a>/
    );

    const genesis = runUnzip([
      "-p",
      outputPath,
      "EPUB/text/book-001.xhtml"
    ]);
    assert.match(genesis, /<h1>Genesis<\/h1>/);
    assert.match(genesis, /id="genesis-chapter-1"/);
    assert.match(genesis, /<sup class="verse-number">1<\/sup>/);
    assert.match(
      genesis,
      /In the beginning God created the heaven and the earth\./
    );

    const packageDocument = runUnzip([
      "-p",
      outputPath,
      "EPUB/package.opf"
    ]);
    assert.match(packageDocument, /The Holy Bible — World English Bible/);
    assert.match(packageDocument, /properties="nav"/);

    const archiveDetails = runUnzip(["-lv", outputPath]);
    assert.match(
      archiveDetails,
      /application\/epub\+zip|mimetype/
    );
    const mimetypeRow = archiveDetails
      .split("\n")
      .find((line) => line.trim().endsWith("mimetype"));
    assert.match(mimetypeRow ?? "", /\s0%\s/);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("the Kindle export omits empty source verse records without renumbering", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cross-cannon-epub-"));
  const inputPath = path.join(tempDir, "bible.json");
  const outputPath = path.join(tempDir, "bible.epub");

  try {
    await writeFile(inputPath, JSON.stringify([
      {
        book: "Example",
        chapters: [{
          chapter: 1,
          verses: [
            { verse: 1, text: " \n" },
            { verse: 2, text: "The preserved verse." }
          ]
        }]
      },
      {
        book: "Front Matter",
        chapters: []
      }
    ]));

    const exportResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/export-kindle-bible.ts",
        "--input",
        inputPath,
        "--output",
        outputPath
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8"
      }
    );

    assert.equal(
      exportResult.status,
      0,
      `${exportResult.stdout}\n${exportResult.stderr}`
    );

    const chapter = runUnzip([
      "-p",
      outputPath,
      "EPUB/text/book-001.xhtml"
    ]);
    assert.doesNotMatch(chapter, /verse-1"/);
    assert.match(chapter, /example-chapter-1-verse-2/);
    assert.match(chapter, /The preserved verse\./);

    const entries = runUnzip(["-Z1", outputPath]);
    assert.doesNotMatch(entries, /book-002\.xhtml/);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

function runUnzip(args: string[]) {
  const result = spawnSync("unzip", args, { encoding: "utf8" });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
