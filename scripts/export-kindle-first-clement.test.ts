import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("the First Clement export creates compact navigation and marks changed words", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "first-clement-epub-"));
  const outputPath = path.join(directory, "first-clement.epub");

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/export-kindle-first-clement.ts",
        "--output",
        outputPath
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8"
      }
    );

    assert.equal(result.status, 0, result.stderr);

    const entries = unzip(outputPath, "-Z1");
    assert.match(entries, /^mimetype\n/);
    assert.match(entries, /EPUB\/text\/contents\.xhtml/);
    assert.match(entries, /EPUB\/text\/chapter-065\.xhtml/);

    const navigation = unzip(outputPath, "-p", "EPUB/nav.xhtml");
    assert.match(navigation, /<a href="text\/contents\.xhtml">Contents<\/a>/);
    assert.match(
      navigation,
      /<a href="text\/chapter-065\.xhtml">Chapter 65:/
    );
    assert.ok(
      navigation.indexOf('href="text/contents.xhtml"')
      < navigation.indexOf('href="text/chapter-001.xhtml"')
    );

    const contents = unzip(outputPath, "-p", "EPUB/text/contents.xhtml");
    assert.equal((contents.match(/<tr>/g) ?? []).length, 13);
    assert.match(contents, /<a href="chapter-001\.xhtml">1<\/a>/);
    assert.match(contents, /<a href="chapter-065\.xhtml">65<\/a>/);

    const chapter = unzip(outputPath, "-p", "EPUB/text/chapter-002.xhtml");
    assert.match(
      chapter,
      /Moreover, <span class="modernized-change">you<\/span> were/
    );
    assert.doesNotMatch(chapter, /class="verse-number"/);

    const styles = unzip(outputPath, "-p", "EPUB/styles/book.css");
    assert.match(styles, /\.modernized-change \{\s*border-bottom: 0\.06em dotted;/);

    const packageDocument = unzip(outputPath, "-p", "EPUB/package.opf");
    assert.match(
      packageDocument,
      /<dc:title>The First Epistle of Clement to the Corinthians<\/dc:title>/
    );
    assert.match(packageDocument, /<dc:creator>Clement of Rome<\/dc:creator>/);
    assert.doesNotMatch(packageDocument, /Cross Canon/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function unzip(archivePath: string, option: string, entryPath?: string) {
  return execFileSync(
    "unzip",
    entryPath ? [option, archivePath, entryPath] : [option, archivePath],
    {
    encoding: "utf8"
    }
  );
}
