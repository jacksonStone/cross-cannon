import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inflateRawSync } from "node:zlib";

type ArchiveEntry = {
  body: Buffer;
  compressionMethod: number;
};

test("the Kindle export command creates a navigable EPUB from Bible JSON", async () => {
  await withBibleExport({ inputPath: "data/sample-bible.json" }, (archive) => {
    assert.deepEqual([...archive.keys()].slice(0, 4), [
      "mimetype",
      "META-INF/container.xml",
      "EPUB/package.opf",
      "EPUB/nav.xhtml"
    ]);
    assert.ok(archive.has("EPUB/text/book-001.xhtml"));
    assert.ok(archive.has("EPUB/text/book-005.xhtml"));

    const mimetype = readArchiveText(archive, "mimetype");
    assert.equal(mimetype, "application/epub+zip");
    assert.equal(archive.get("mimetype")?.compressionMethod, 0);

    const navigation = readArchiveText(archive, "EPUB/nav.xhtml");
    assert.match(navigation, /<a href="text\/book-001\.xhtml">Genesis<\/a>/);
    assert.match(
      navigation,
      /<a href="text\/book-001\.xhtml#genesis-chapter-1">Chapter 1<\/a>/
    );

    const genesis = readArchiveText(archive, "EPUB/text/book-001.xhtml");
    assert.match(genesis, /<h1>Genesis<\/h1>/);
    assert.match(genesis, /id="genesis-chapter-1"/);
    assert.doesNotMatch(genesis, /class="verse-number"/);
    assert.match(
      genesis,
      /In the beginning God created the heaven and the earth\./
    );

    const packageDocument = readArchiveText(archive, "EPUB/package.opf");
    assert.match(packageDocument, /The Holy Bible — World English Bible/);
    assert.match(packageDocument, /properties="nav"/);
  });
});

test("the Kindle export omits empty source records without renumbering", async () => {
  const inputBody = JSON.stringify([
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
  ]);

  await withBibleExport({ inputBody }, (archive) => {
    const chapter = readArchiveText(archive, "EPUB/text/book-001.xhtml");
    assert.doesNotMatch(chapter, /verse-1"/);
    assert.match(chapter, /example-chapter-1-verse-2/);
    assert.match(chapter, /The preserved verse\./);
    assert.equal(archive.has("EPUB/text/book-002.xhtml"), false);
  });
});

async function withBibleExport(
  source: { inputBody: string } | { inputPath: string },
  inspect: (archive: Map<string, ArchiveEntry>) => void
) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cross-cannon-epub-"));
  const outputPath = path.join(tempDir, "bible.epub");
  const inputPath = "inputBody" in source
    ? path.join(tempDir, "bible.json")
    : source.inputPath;

  try {
    if ("inputBody" in source) {
      await writeFile(inputPath, source.inputBody);
    }

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

    inspect(readZipEntries(await readFile(outputPath)));
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

function readZipEntries(archive: Buffer) {
  const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const endOffset = archive.lastIndexOf(endSignature);
  assert.notEqual(endOffset, -1, "Missing ZIP end-of-central-directory record.");

  const entryCount = archive.readUInt16LE(endOffset + 10);
  let centralOffset = archive.readUInt32LE(endOffset + 16);
  const entries = new Map<string, ArchiveEntry>();

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(archive.readUInt32LE(centralOffset), 0x02014b50);

    const compressionMethod = archive.readUInt16LE(centralOffset + 10);
    const compressedSize = archive.readUInt32LE(centralOffset + 20);
    const nameLength = archive.readUInt16LE(centralOffset + 28);
    const extraLength = archive.readUInt16LE(centralOffset + 30);
    const commentLength = archive.readUInt16LE(centralOffset + 32);
    const localOffset = archive.readUInt32LE(centralOffset + 42);
    const name = archive
      .subarray(centralOffset + 46, centralOffset + 46 + nameLength)
      .toString("utf8");

    assert.equal(archive.readUInt32LE(localOffset), 0x04034b50);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const bodyOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = archive.subarray(bodyOffset, bodyOffset + compressedSize);
    const body = compressionMethod === 0
      ? compressed
      : inflateRawSync(compressed);

    entries.set(name, { body, compressionMethod });
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readArchiveText(
  archive: Map<string, ArchiveEntry>,
  entryPath: string
) {
  const entry = archive.get(entryPath);
  assert.ok(entry, `Missing EPUB entry: ${entryPath}`);
  return entry.body.toString("utf8");
}
