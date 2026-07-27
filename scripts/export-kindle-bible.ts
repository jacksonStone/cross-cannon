import { deflateRawSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Bible = {
  books: BibleBook[];
};

type BibleBook = {
  chapters: BibleChapter[];
  name: string;
};

type BibleChapter = {
  number: number;
  verses: BibleVerse[];
};

type BibleVerse = {
  number: number;
  text: string;
};

type EpubEntry = {
  body: Buffer;
  compression: "deflate" | "store";
  path: string;
};

const DEFAULT_INPUT_PATH = "data/bible.json";
const DEFAULT_OUTPUT_PATH = "exports/kindle/cross-canon-bible.epub";
const EPUB_TITLE = "The Holy Bible — World English Bible";

async function run() {
  const { inputPath, outputPath } = parseArgs(process.argv.slice(2));
  const bible = parseBibleJson(await readFile(inputPath, "utf8"));
  const generatedAt = new Date();
  const epub = createBibleEpub(bible, generatedAt);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, epub);

  console.log(
    `Exported ${bible.books.length} Scripture Books to ${outputPath} `
    + `(${formatBytes(epub.byteLength)})`
  );
}

function parseArgs(args: string[]) {
  let inputPath = DEFAULT_INPUT_PATH;
  let outputPath = DEFAULT_OUTPUT_PATH;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--input") {
      inputPath = requireArgValue(args, ++index, argument);
      continue;
    }

    if (argument === "--output") {
      outputPath = requireArgValue(args, ++index, argument);
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return {
    inputPath: path.resolve(process.cwd(), inputPath),
    outputPath: path.resolve(process.cwd(), outputPath)
  };
}

function requireArgValue(args: string[], index: number, flag: string) {
  const value = args[index];

  if (!value) {
    throw new Error(`${flag} requires a path.`);
  }

  return value;
}

function parseBibleJson(source: string): Bible {
  const parsed: unknown = JSON.parse(source);
  const bookValues = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.books)
      ? parsed.books
      : null;

  if (!bookValues) {
    throw new Error("Bible JSON must be an array of Books or an object with a books array.");
  }

  const books = bookValues.map((bookValue, bookIndex) => {
    if (!isRecord(bookValue) || !Array.isArray(bookValue.chapters)) {
      throw new Error(`Book ${bookIndex + 1} does not contain a chapters array.`);
    }

    const name = readNonEmptyString(bookValue.name ?? bookValue.book);
    if (!name) {
      throw new Error(`Book ${bookIndex + 1} does not have a name.`);
    }

    const chapters = bookValue.chapters.map((chapterValue, chapterIndex) => {
      if (!isRecord(chapterValue) || !Array.isArray(chapterValue.verses)) {
        throw new Error(`${name} chapter ${chapterIndex + 1} does not contain verses.`);
      }

      const number = readPositiveInteger(chapterValue.chapter);
      if (number === null) {
        throw new Error(`${name} chapter ${chapterIndex + 1} has an invalid number.`);
      }

      const verses = chapterValue.verses.flatMap((verseValue, verseIndex): BibleVerse[] => {
        if (!isRecord(verseValue)) {
          throw new Error(`${name} ${number}:${verseIndex + 1} is invalid.`);
        }

        const verseNumber = readPositiveInteger(verseValue.verse);
        if (verseNumber === null || typeof verseValue.text !== "string") {
          throw new Error(`${name} ${number}:${verseIndex + 1} is invalid.`);
        }

        const text = verseValue.text.trim();
        if (!text) {
          return [];
        }

        return [{
          number: verseNumber,
          text: text.replace(/\s+/g, " ")
        }];
      });

      return { number, verses };
    });

    return { chapters, name };
  }).filter((book) => book.chapters.length > 0);

  if (books.length === 0) {
    throw new Error("Bible JSON does not contain any Books.");
  }

  return { books };
}

function createBibleEpub(bible: Bible, generatedAt: Date) {
  const entries: EpubEntry[] = [
    textEntry("mimetype", "application/epub+zip", "store"),
    textEntry("META-INF/container.xml", createContainerDocument()),
    textEntry("EPUB/package.opf", createPackageDocument(bible, generatedAt)),
    textEntry("EPUB/nav.xhtml", createNavigationDocument(bible)),
    textEntry("EPUB/styles/book.css", createBookStyles()),
    textEntry("EPUB/text/title.xhtml", createTitlePage())
  ];

  bible.books.forEach((book, index) => {
    entries.push(
      textEntry(`EPUB/text/${bookFileName(index)}`, createBookDocument(book))
    );
  });

  return createZip(entries, generatedAt);
}

function createContainerDocument() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}

function createPackageDocument(bible: Bible, generatedAt: Date) {
  const bookManifest = bible.books
    .map((_, index) => (
      `    <item id="book-${padNumber(index + 1)}" href="text/${bookFileName(index)}" `
      + 'media-type="application/xhtml+xml"/>'
    ))
    .join("\n");
  const bookSpine = bible.books
    .map((_, index) => `    <itemref idref="book-${padNumber(index + 1)}"/>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">https://www.crosscanon.com/exports/world-english-bible</dc:identifier>
    <dc:title>${escapeXml(EPUB_TITLE)}</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>World English Bible</dc:creator>
    <dc:publisher>Cross Canon</dc:publisher>
    <dc:rights>Public Domain</dc:rights>
    <meta property="dcterms:modified">${generatedAt.toISOString().replace(/\.\d{3}Z$/, "Z")}</meta>
    <meta property="rendition:layout">reflowable</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="styles" href="styles/book.css" media-type="text/css"/>
    <item id="title" href="text/title.xhtml" media-type="application/xhtml+xml"/>
${bookManifest}
  </manifest>
  <spine>
    <itemref idref="title"/>
    <itemref idref="nav"/>
${bookSpine}
  </spine>
</package>
`;
}

function createNavigationDocument(bible: Bible) {
  const books = bible.books.map((book, index) => {
    const fileName = bookFileName(index);
    const chapters = book.chapters
      .map((chapter) => (
        `          <li><a href="text/${fileName}#${chapterId(book.name, chapter.number)}">`
        + `Chapter ${chapter.number}</a></li>`
      ))
      .join("\n");

    return `      <li>
        <a href="text/${fileName}">${escapeXml(book.name)}</a>
        <ol>
${chapters}
        </ol>
      </li>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Contents</title>
  <link rel="stylesheet" type="text/css" href="styles/book.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol class="contents">
${books}
    </ol>
  </nav>
  <nav epub:type="landmarks" hidden="hidden">
    <ol>
      <li><a epub:type="toc" href="nav.xhtml">Contents</a></li>
      <li><a epub:type="bodymatter" href="text/book-001.xhtml">Beginning</a></li>
    </ol>
  </nav>
</body>
</html>
`;
}

function createTitlePage() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(EPUB_TITLE)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/book.css"/>
</head>
<body epub:type="frontmatter">
  <section epub:type="titlepage" class="title-page">
    <h1>The Holy Bible</h1>
    <p class="subtitle">World English Bible</p>
    <p>Prepared for Kindle by Cross Canon</p>
  </section>
  <section epub:type="copyright-page" class="source-note">
    <h2>About this edition</h2>
    <p>The World English Bible is in the public domain.</p>
    <p>This edition was generated from the Cross Canon Scripture source, including its deuterocanonical books.</p>
    <p>Source: World English Bible USFM data assembled at github.com/jacksonStone/Bible_as_JSON.</p>
  </section>
</body>
</html>
`;
}

function createBookDocument(book: BibleBook) {
  const chapters = book.chapters.map((chapter) => {
    const verses = chapter.verses.map((verse) => (
      `    <p id="${chapterId(book.name, chapter.number)}-verse-${verse.number}" class="verse">`
      + `<sup class="verse-number">${verse.number}</sup> ${escapeXml(verse.text)}</p>`
    )).join("\n");

    return `  <section epub:type="chapter" id="${chapterId(book.name, chapter.number)}">
    <h2>Chapter ${chapter.number}</h2>
${verses}
  </section>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(book.name)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/book.css"/>
</head>
<body epub:type="bodymatter">
  <h1>${escapeXml(book.name)}</h1>
${chapters}
</body>
</html>
`;
}

function createBookStyles() {
  return `body {
  font-family: serif;
  line-height: 1.45;
  margin: 5%;
}

h1 {
  break-before: page;
  font-size: 1.75em;
  margin: 0 0 1.5em;
  text-align: center;
}

h2 {
  break-before: page;
  font-size: 1.35em;
  margin: 0 0 1em;
  text-align: center;
}

.verse {
  margin: 0 0 0.65em;
  orphans: 2;
  widows: 2;
}

.verse-number {
  font-size: 0.7em;
  font-weight: bold;
  vertical-align: super;
}

.title-page {
  margin-top: 25%;
  text-align: center;
}

.subtitle {
  font-size: 1.25em;
  font-style: italic;
}

.source-note {
  break-before: page;
}

.contents,
.contents ol {
  list-style-type: none;
}

.contents li {
  margin: 0.35em 0;
}
`;
}

function textEntry(
  entryPath: string,
  body: string,
  compression: EpubEntry["compression"] = "deflate"
): EpubEntry {
  return {
    body: Buffer.from(body, "utf8"),
    compression,
    path: entryPath
  };
}

function createZip(entries: EpubEntry[], modifiedAt: Date) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  const { date, time } = toDosDateTime(modifiedAt);

  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const compressed = entry.compression === "store"
      ? entry.body
      : deflateRawSync(entry.body, { level: 9 });
    const method = entry.compression === "store" ? 0 : 8;
    const checksum = crc32(entry.body);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.byteLength, 18);
    localHeader.writeUInt32LE(entry.body.byteLength, 22);
    localHeader.writeUInt16LE(name.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x031e, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.byteLength, 20);
    centralHeader.writeUInt32LE(entry.body.byteLength, 24);
    centralHeader.writeUInt16LE(name.byteLength, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);

    centralParts.push(centralHeader, name);
    localOffset += localHeader.byteLength + name.byteLength + compressed.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function toDosDateTime(value: Date) {
  const year = Math.max(1980, value.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | (value.getSeconds() >> 1)
  };
}

const crcTable = createCrcTable();

function createCrcTable() {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1
        ? 0xedb88320 ^ (value >>> 1)
        : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
}

function crc32(value: Buffer) {
  let crc = 0xffffffff;

  for (const byte of value) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function bookFileName(index: number) {
  return `book-${padNumber(index + 1)}.xhtml`;
}

function chapterId(bookName: string, chapterNumber: number) {
  return `${slugify(bookName)}-chapter-${chapterNumber}`;
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function padNumber(value: number) {
  return String(value).padStart(3, "0");
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function readPositiveInteger(value: unknown) {
  const parsed = typeof value === "string" && value.trim()
    ? Number(value)
    : value;
  return Number.isInteger(parsed) && Number(parsed) > 0 ? Number(parsed) : null;
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

await run();
