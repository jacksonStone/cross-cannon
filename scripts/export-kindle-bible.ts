import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createEpubArchive,
  epubTextEntry,
  type EpubArchiveEntry
} from "./lib/epub-archive";

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

const DEFAULT_INPUT_PATH = "data/bible.json";
const DEFAULT_OUTPUT_PATH = "exports/kindle/cross-canon-bible.epub";
const DEFAULT_COVER_PATH = "assets/kindle/cross-canon-bible-cover.jpg";
const EPUB_TITLE = "The Holy Bible — World English Bible";

async function run() {
  const { coverPath, inputPath, outputPath } = parseArgs(process.argv.slice(2));
  const [source, coverImage] = await Promise.all([
    readFile(inputPath, "utf8"),
    readFile(coverPath)
  ]);
  const bible = parseBibleJson(source);
  const generatedAt = new Date();
  const epub = createBibleEpub(bible, coverImage, generatedAt);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, epub);

  console.log(
    `Exported ${bible.books.length} Scripture Books to ${outputPath} `
    + `(${formatBytes(epub.byteLength)})`
  );
}

function parseArgs(args: string[]) {
  let coverPath = DEFAULT_COVER_PATH;
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

    if (argument === "--cover") {
      coverPath = requireArgValue(args, ++index, argument);
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return {
    coverPath: path.resolve(process.cwd(), coverPath),
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

function createBibleEpub(bible: Bible, coverImage: Buffer, generatedAt: Date) {
  const entries: EpubArchiveEntry[] = [
    epubTextEntry("mimetype", "application/epub+zip", "store"),
    epubTextEntry("META-INF/container.xml", createContainerDocument()),
    epubTextEntry("EPUB/package.opf", createPackageDocument(bible, generatedAt)),
    epubTextEntry("EPUB/nav.xhtml", createNavigationDocument(bible)),
    epubTextEntry("EPUB/styles/book.css", createBookStyles()),
    {
      body: coverImage,
      compression: "deflate",
      path: "EPUB/images/cover.jpg"
    },
    epubTextEntry("EPUB/text/cover.xhtml", createCoverPage()),
    epubTextEntry("EPUB/text/title.xhtml", createTitlePage())
  ];

  bible.books.forEach((book, index) => {
    entries.push(
      epubTextEntry(`EPUB/text/${bookFileName(index)}`, createBookDocument(book))
    );
  });

  return createEpubArchive(entries, generatedAt);
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
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="styles" href="styles/book.css" media-type="text/css"/>
    <item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="title" href="text/title.xhtml" media-type="application/xhtml+xml"/>
${bookManifest}
  </manifest>
  <spine>
    <itemref idref="cover"/>
    <itemref idref="title"/>
    <itemref idref="nav"/>
${bookSpine}
  </spine>
  <guide>
    <reference type="cover" title="Cover" href="text/cover.xhtml"/>
  </guide>
</package>
`;
}

function createNavigationDocument(bible: Bible) {
  const books = bible.books
    .map((book, index) => (
      `      <li><a href="text/${bookFileName(index)}">${escapeXml(book.name)}</a></li>`
    ))
    .join("\n");

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
      <li><a epub:type="cover" href="text/cover.xhtml">Cover</a></li>
      <li><a epub:type="toc" href="nav.xhtml">Contents</a></li>
      <li><a epub:type="bodymatter" href="text/book-001.xhtml">Beginning</a></li>
    </ol>
  </nav>
</body>
</html>
`;
}

function createCoverPage() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Cover</title>
  <link rel="stylesheet" type="text/css" href="../styles/book.css"/>
</head>
<body epub:type="frontmatter" class="cover-page">
  <section epub:type="cover">
    <img src="../images/cover.jpg" alt="The Holy Bible — World English Bible"/>
  </section>
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
    <p>Cover: <i>Christ Pantocrator</i>, sixth century, Saint Catherine&apos;s Monastery, Sinai. Public-domain image via Wikimedia Commons.</p>
  </section>
</body>
</html>
`;
}

function createBookDocument(book: BibleBook) {
  const chapterLinks = book.chapters
    .map((chapter) => (
      `      <li><a href="#${chapterId(book.name, chapter.number)}">${chapter.number}</a></li>`
    ))
    .join("\n");
  const chapters = book.chapters.map((chapter) => {
    const verses = chapter.verses.map((verse) => (
      `    <p id="${chapterId(book.name, chapter.number)}-verse-${verse.number}" class="verse">`
      + `${escapeXml(verse.text)}</p>`
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
  <nav class="chapter-navigation" aria-label="${escapeXml(book.name)} chapters">
    <p class="chapter-navigation-label">Chapters</p>
    <ol>
${chapterLinks}
    </ol>
  </nav>
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

.cover-page {
  background: #090704;
  margin: 0;
  padding: 0;
  text-align: center;
}

.cover-page section {
  margin: 0;
  padding: 0;
}

.cover-page img {
  display: block;
  height: 100%;
  margin: 0 auto;
  max-height: 100vh;
  max-width: 100%;
  object-fit: contain;
  width: auto;
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

.contents {
  list-style-type: none;
  margin: 0;
  padding: 0;
}

.contents li {
  margin: 0.2em 0;
}

.chapter-navigation {
  margin: 0 auto 1.25em;
  text-align: center;
}

.chapter-navigation-label {
  font-style: italic;
  margin: 0 0 0.4em;
}

.chapter-navigation ol {
  list-style-type: none;
  margin: 0;
  padding: 0;
}

.chapter-navigation li {
  display: inline;
  line-height: 1.8;
  margin: 0 0.35em;
}
`;
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
