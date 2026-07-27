import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildModernizedTextParts } from "../app/features/early-christian-reader/modernized-text";
import {
  createEpubArchive,
  epubTextEntry,
  type EpubArchiveEntry
} from "./lib/epub-archive";

type BookIndex = {
  books: Array<{
    chapters: Array<{
      assetPath: string;
      chapter: number;
      id: string;
      title: string;
    }>;
    id: string;
    name: string;
  }>;
};

type Chapter = {
  chapter: number;
  id: string;
  title: string;
  verses: Array<{
    modernizedText?: string;
    text: string;
    verse: number;
  }>;
};

const WORK_ID = "anf09:xii.iv";
const DEFAULT_BOOK_INDEX_PATH = "public/church-fathers-preview/books.json";
const DEFAULT_COVER_PATH = "assets/kindle/first-clement-cover.jpg";
const DEFAULT_OUTPUT_PATH =
  "exports/kindle/The First Epistle of Clement to the Corinthians.epub";
const EPUB_TITLE = "The First Epistle of Clement to the Corinthians";
const EPUB_CREATOR = "Clement of Rome";
const CONTENTS_COLUMNS = 5;

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const [bookIndexSource, coverImage] = await Promise.all([
    readFile(options.bookIndexPath, "utf8"),
    readFile(options.coverPath)
  ]);
  const bookIndex = JSON.parse(bookIndexSource) as BookIndex;
  const work = bookIndex.books.find((book) => book.id === WORK_ID);

  if (!work) {
    throw new Error(`Could not find work ${WORK_ID}.`);
  }

  const chapters = await Promise.all(work.chapters.map(async (summary) => (
    JSON.parse(
      await readFile(path.join("public", summary.assetPath.slice(1)), "utf8")
    ) as Chapter
  )));

  chapters.sort((left, right) => left.chapter - right.chapter);

  for (const chapter of chapters) {
    if (chapter.verses.some((verse) => !verse.modernizedText?.trim())) {
      throw new Error(`${chapter.id} contains a passage without modernized text.`);
    }
  }

  const generatedAt = new Date();
  const epub = createFirstClementEpub(chapters, coverImage, generatedAt);

  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, epub);

  console.log(
    `Exported ${chapters.length} chapters and `
    + `${chapters.reduce((sum, chapter) => sum + chapter.verses.length, 0)} passages `
    + `to ${options.outputPath} (${formatBytes(epub.byteLength)})`
  );
}

function parseArgs(args: string[]) {
  let bookIndexPath = DEFAULT_BOOK_INDEX_PATH;
  let coverPath = DEFAULT_COVER_PATH;
  let outputPath = DEFAULT_OUTPUT_PATH;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];

    if (argument === "--book-index" && value) {
      bookIndexPath = value;
      index += 1;
      continue;
    }
    if (argument === "--cover" && value) {
      coverPath = value;
      index += 1;
      continue;
    }
    if (argument === "--output" && value) {
      outputPath = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${argument}`);
  }

  return { bookIndexPath, coverPath, outputPath };
}

function createFirstClementEpub(
  chapters: Chapter[],
  coverImage: Buffer,
  generatedAt: Date
) {
  const entries: EpubArchiveEntry[] = [
    epubTextEntry("mimetype", "application/epub+zip", "store"),
    epubTextEntry("META-INF/container.xml", createContainerDocument()),
    epubTextEntry("EPUB/package.opf", createPackageDocument(chapters, generatedAt)),
    epubTextEntry("EPUB/nav.xhtml", createNavigationDocument(chapters)),
    epubTextEntry("EPUB/styles/book.css", createBookStyles()),
    {
      body: coverImage,
      compression: "deflate",
      path: "EPUB/images/cover.jpg"
    },
    epubTextEntry("EPUB/text/cover.xhtml", createCoverPage()),
    epubTextEntry("EPUB/text/title.xhtml", createTitlePage()),
    epubTextEntry("EPUB/text/contents.xhtml", createContentsDocument(chapters))
  ];

  chapters.forEach((chapter, index) => {
    entries.push(
      epubTextEntry(
        `EPUB/text/${chapterFileName(index)}`,
        createChapterDocument(chapter)
      )
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

function createPackageDocument(chapters: Chapter[], generatedAt: Date) {
  const chapterManifest = chapters.map((_, index) => (
    `    <item id="chapter-${padNumber(index + 1)}" href="text/${chapterFileName(index)}" media-type="application/xhtml+xml"/>`
  )).join("\n");
  const chapterSpine = chapters.map((_, index) => (
    `    <itemref idref="chapter-${padNumber(index + 1)}"/>`
  )).join("\n");
  const modified = generatedAt.toISOString().replace(/\.\d{3}Z$/, "Z");

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:first-clement:modernized-edition</dc:identifier>
    <dc:title>${escapeXml(EPUB_TITLE)}</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>${escapeXml(EPUB_CREATOR)}</dc:creator>
    <dc:rights>Public Domain</dc:rights>
    <meta property="dcterms:modified">${modified}</meta>
    <meta property="rendition:layout">reflowable</meta>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="styles" href="styles/book.css" media-type="text/css"/>
    <item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="title" href="text/title.xhtml" media-type="application/xhtml+xml"/>
    <item id="contents" href="text/contents.xhtml" media-type="application/xhtml+xml"/>
${chapterManifest}
  </manifest>
  <spine>
    <itemref idref="cover"/>
    <itemref idref="title"/>
    <itemref idref="contents"/>
${chapterSpine}
  </spine>
  <guide>
    <reference type="cover" title="Cover" href="text/cover.xhtml"/>
    <reference type="toc" title="Contents" href="text/contents.xhtml"/>
    <reference type="text" title="Beginning" href="text/chapter-001.xhtml"/>
  </guide>
</package>
`;
}

function createNavigationDocument(chapters: Chapter[]) {
  const chapterLinks = chapters.map((chapter, index) => (
    `      <li><a href="text/${chapterFileName(index)}">Chapter ${chapter.chapter}: ${escapeXml(chapter.title)}</a></li>`
  )).join("\n");

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
    <ol>
      <li><a href="text/contents.xhtml">Contents</a></li>
${chapterLinks}
    </ol>
  </nav>
  <nav epub:type="landmarks" hidden="hidden">
    <ol>
      <li><a epub:type="cover" href="text/cover.xhtml">Cover</a></li>
      <li><a epub:type="toc" href="text/contents.xhtml">Contents</a></li>
      <li><a epub:type="bodymatter" href="text/chapter-001.xhtml">Beginning</a></li>
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
    <img src="../images/cover.jpg" alt="The First Epistle of Clement to the Corinthians"/>
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
    <h1>${escapeXml(EPUB_TITLE)}</h1>
    <p class="subtitle">${escapeXml(EPUB_CREATOR)}</p>
    <p>A modernized public-domain edition</p>
  </section>
  <section class="source-note">
    <h2>About this edition</h2>
    <p>Source text from the <i>Ante-Nicene Fathers</i> via the Christian Classics Ethereal Library.</p>
    <p>Words marked with a fine dotted underline differ from the original public-domain translation.</p>
  </section>
</body>
</html>
`;
}

function createContentsDocument(chapters: Chapter[]) {
  const rows = groupIntoRows(chapters, CONTENTS_COLUMNS)
    .map((row, rowIndex) => (
      `        <tr>\n${row.map((chapter, columnIndex) => {
        const chapterIndex = rowIndex * CONTENTS_COLUMNS + columnIndex;
        return `          <td><a href="${chapterFileName(chapterIndex)}">${chapter.chapter}</a></td>`;
      }).join("\n")}\n        </tr>`
    ))
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Contents</title>
  <link rel="stylesheet" type="text/css" href="../styles/book.css"/>
</head>
<body epub:type="frontmatter" class="contents-page">
  <section epub:type="toc" id="contents">
    <h1 class="contents-title">Contents</h1>
    <p class="contents-label">Chapters</p>
    <table class="chapter-grid">
      <tbody>
${rows}
      </tbody>
    </table>
  </section>
</body>
</html>
`;
}

function createChapterDocument(chapter: Chapter) {
  const passages = chapter.verses.map((verse) => {
    const modernizedText = verse.modernizedText?.trim();

    if (!modernizedText) {
      throw new Error(`${chapter.id}:${verse.verse} has no modernized text.`);
    }

    const text = buildModernizedTextParts(verse.text, modernizedText)
      .map((part) => (
        part.changed
          ? `<span class="modernized-change">${escapeXml(part.text)}</span>`
          : escapeXml(part.text)
      ))
      .join("");

    return `  <p id="passage-${verse.verse}" class="passage">${text}</p>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Chapter ${chapter.chapter}: ${escapeXml(chapter.title)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/book.css"/>
</head>
<body epub:type="bodymatter">
  <section epub:type="chapter" id="chapter-${chapter.chapter}">
    <p class="chapter-home"><a href="contents.xhtml">Contents</a></p>
    <h1>Chapter ${chapter.chapter}</h1>
    <h2 class="chapter-title">${escapeXml(chapter.title)}</h2>
${passages}
  </section>
</body>
</html>
`;
}

function createBookStyles() {
  return `body {
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
  font-size: 1.7em;
  margin: 0 0 0.7em;
  text-align: center;
}

h2 {
  font-size: 1.05em;
  font-style: italic;
  font-weight: normal;
  margin: 0 0 1.5em;
  text-align: center;
}

.title-page {
  margin-top: 25%;
  text-align: center;
}

.title-page h1 {
  break-before: auto;
}

.subtitle {
  font-size: 1.2em;
  font-style: italic;
}

.source-note {
  break-before: page;
}

.passage {
  margin: 0 0 0.8em;
  orphans: 2;
  widows: 2;
}

.modernized-change {
  border-bottom: 0.06em dotted;
}

.chapter-home {
  font-size: 0.85em;
  margin: 0 0 1em;
  text-align: center;
}

.contents-page {
  margin: 3%;
}

.contents-title {
  font-size: 18pt;
  margin-bottom: 5pt;
}

.contents-label {
  font-style: italic;
  margin: 0 0 5pt;
  text-align: center;
}

.chapter-grid {
  border-collapse: collapse;
  break-inside: avoid;
  font-size: 11pt;
  margin: 0;
  page-break-inside: avoid;
  table-layout: fixed;
  width: 100%;
}

.chapter-grid td {
  padding: 3pt 0;
  text-align: center;
}
`;
}

function groupIntoRows<Item>(items: Item[], columnCount: number) {
  return Array.from(
    { length: Math.ceil(items.length / columnCount) },
    (_, rowIndex) => items.slice(
      rowIndex * columnCount,
      (rowIndex + 1) * columnCount
    )
  );
}

function chapterFileName(index: number) {
  return `chapter-${padNumber(index + 1)}.xhtml`;
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

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

await run();
