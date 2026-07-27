import fs from "node:fs";
import path from "node:path";

type BookIndex = {
  books: Array<{
    chapters: Array<{
      assetPath: string;
      id: string;
    }>;
    id: string;
    name: string;
  }>;
};

type ChapterAsset = {
  chapter: number;
  id: string;
  title: string;
  verses: Array<{
    modernizedText?: string;
    text: string;
    verse: number;
  }>;
};

type ModernizationBatch = {
  chapterEnd: number;
  chapterStart: number;
  entries: ModernizationEntry[];
  workId: string;
};

type ModernizationEntry = {
  chapterId: string;
  modernizedText: string;
  originalText: string;
  verse: number;
};

type ModernizationReview = {
  issues: Array<{
    currentModernizedText: string;
    key: string;
    proposedModernizedText: string;
  }>;
  reviewedPassages: number;
  workId: string;
};

type LoadedChapter = {
  asset: ChapterAsset;
  filePath: string;
};

const DEFAULT_BOOK_INDEX_PATH = "public/church-fathers-preview/books.json";

const options = parseArgs(process.argv.slice(2));
const bookIndex = readJson<BookIndex>(options.bookIndexPath);
const work = bookIndex.books.find((book) => book.id === options.workId);

if (!work) {
  throw new Error(`Could not find work ${options.workId} in ${options.bookIndexPath}.`);
}

const chapters = new Map<string, LoadedChapter>(
  work.chapters.map((chapter) => {
    const filePath = publicAssetPath(chapter.assetPath);
    return [chapter.id, { asset: readJson<ChapterAsset>(filePath), filePath }];
  })
);
const missingBefore = new Set<string>();

for (const { asset } of chapters.values()) {
  for (const verse of asset.verses) {
    if (!verse.modernizedText?.trim()) {
      missingBefore.add(passageKey(asset.id, verse.verse));
    }
  }
}

const passageCount = [...chapters.values()].reduce(
  (total, chapter) => total + chapter.asset.verses.length,
  0
);
const corrections = new Map<string, ModernizationReview["issues"][number]>();

for (const reviewPath of options.reviewPaths) {
  const review = readJson<ModernizationReview>(reviewPath);

  if (review.workId !== options.workId) {
    throw new Error(`${reviewPath} targets work ${review.workId}, not ${options.workId}.`);
  }
  if (review.reviewedPassages !== passageCount || !Array.isArray(review.issues)) {
    throw new Error(`${reviewPath} does not cover all ${passageCount} passages.`);
  }

  for (const issue of review.issues) {
    if (corrections.has(issue.key)) {
      throw new Error(`Duplicate reviewed correction for ${issue.key}.`);
    }
    if (!issue.currentModernizedText?.trim() || !issue.proposedModernizedText?.trim()) {
      throw new Error(`${reviewPath} has incomplete correction text for ${issue.key}.`);
    }
    corrections.set(issue.key, issue);
  }
}

const appliedCorrections = new Set<string>();
const entries = options.inputPaths.flatMap((inputPath) => {
  const batch = readJson<ModernizationBatch>(inputPath);
  validateBatch(batch, inputPath, options.workId);
  return batch.entries.map((entry) => {
    const key = passageKey(entry.chapterId, entry.verse);
    const correction = corrections.get(key);

    if (!correction) {
      return { batch, entry, inputPath };
    }
    if (entry.modernizedText.trim() !== correction.currentModernizedText.trim()) {
      throw new Error(
        `${inputPath} does not match the reviewed current text for ${key}.`
      );
    }

    appliedCorrections.add(key);
    return {
      batch,
      entry: {
        ...entry,
        modernizedText: correction.proposedModernizedText
      },
      inputPath
    };
  });
});

const unappliedCorrections = [...corrections.keys()].filter(
  (key) => !appliedCorrections.has(key)
);

if (unappliedCorrections.length > 0) {
  throw new Error(
    `Reviewed corrections do not match a batch entry: ${unappliedCorrections.join(", ")}`
  );
}

const seen = new Set<string>();
const changedFiles = new Set<string>();

for (const { batch, entry, inputPath } of entries) {
  const chapter = chapters.get(entry.chapterId);

  if (!chapter) {
    throw new Error(`${inputPath} references unknown chapter ${entry.chapterId}.`);
  }

  if (
    chapter.asset.chapter < batch.chapterStart
    || chapter.asset.chapter > batch.chapterEnd
  ) {
    throw new Error(
      `${inputPath} passage ${passageKey(entry.chapterId, entry.verse)} `
      + `falls outside its declared chapter range.`
    );
  }

  const key = passageKey(entry.chapterId, entry.verse);

  if (seen.has(key)) {
    throw new Error(`Duplicate modernization entry for ${key}.`);
  }
  seen.add(key);

  const verse = chapter.asset.verses.find((candidate) => candidate.verse === entry.verse);

  if (!verse) {
    throw new Error(`${inputPath} references unknown passage ${key}.`);
  }
  if (verse.text !== entry.originalText) {
    throw new Error(`${inputPath} originalText does not exactly match ${key}.`);
  }

  const modernizedText = entry.modernizedText.trim();

  if (!modernizedText) {
    throw new Error(`${inputPath} has empty modernizedText for ${key}.`);
  }
  if (
    verse.modernizedText?.trim()
    && verse.modernizedText.trim() !== modernizedText
    && !options.replace
  ) {
    throw new Error(`${key} already has different modernized text; use --replace to update it.`);
  }

  if (verse.modernizedText?.trim() !== modernizedText) {
    verse.modernizedText = modernizedText;
    changedFiles.add(chapter.filePath);
  }
}

const missingEntries = [...missingBefore].filter((key) => !seen.has(key));

if (missingEntries.length > 0) {
  throw new Error(
    `Modernization batches omit ${missingEntries.length} passage(s): `
    + missingEntries.slice(0, 10).join(", ")
  );
}

for (const { asset } of chapters.values()) {
  const missing = asset.verses.filter((verse) => !verse.modernizedText?.trim());

  if (missing.length > 0) {
    throw new Error(
      `${asset.id} still has ${missing.length} passage(s) without modernized text.`
    );
  }
}

for (const filePath of changedFiles) {
  const chapter = [...chapters.values()].find((candidate) => candidate.filePath === filePath);

  if (!chapter) {
    throw new Error(`Could not resolve changed chapter ${filePath}.`);
  }

  fs.writeFileSync(filePath, JSON.stringify(chapter.asset), "utf8");
}

fs.mkdirSync(path.dirname(options.auditPath), { recursive: true });
fs.writeFileSync(
  options.auditPath,
  createAuditDocument(work.name, [...chapters.values()].map(({ asset }) => asset)),
  "utf8"
);

console.log(JSON.stringify({
  auditPath: options.auditPath,
  changedFiles: changedFiles.size,
  importedEntries: entries.length,
  reviewedCorrections: corrections.size,
  work: work.name,
  workId: work.id
}, null, 2));

function parseArgs(args: string[]) {
  let auditPath = "";
  let bookIndexPath = DEFAULT_BOOK_INDEX_PATH;
  const inputPaths: string[] = [];
  let replace = false;
  const reviewPaths: string[] = [];
  let workId = "";

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];

    if (argument === "--audit" && value) {
      auditPath = value;
      index += 1;
      continue;
    }
    if (argument === "--book-index" && value) {
      bookIndexPath = value;
      index += 1;
      continue;
    }
    if (argument === "--input" && value) {
      inputPaths.push(value);
      index += 1;
      continue;
    }
    if (argument === "--replace") {
      replace = true;
      continue;
    }
    if (argument === "--review" && value) {
      reviewPaths.push(value);
      index += 1;
      continue;
    }
    if (argument === "--work" && value) {
      workId = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${argument}`);
  }

  if (!workId || inputPaths.length === 0 || !auditPath) {
    throw new Error(
      "Usage: --work <id> --input <batch.json> [--input ...] --audit <audit.md>"
    );
  }

  return { auditPath, bookIndexPath, inputPaths, replace, reviewPaths, workId };
}

function validateBatch(
  batch: ModernizationBatch,
  inputPath: string,
  expectedWorkId: string
) {
  if (batch.workId !== expectedWorkId) {
    throw new Error(`${inputPath} targets work ${batch.workId}, not ${expectedWorkId}.`);
  }
  if (
    !Number.isInteger(batch.chapterStart)
    || !Number.isInteger(batch.chapterEnd)
    || batch.chapterStart > batch.chapterEnd
    || !Array.isArray(batch.entries)
  ) {
    throw new Error(`${inputPath} is not a valid modernization batch.`);
  }
}

function createAuditDocument(workName: string, chapters: ChapterAsset[]) {
  const passageCount = chapters.reduce((total, chapter) => total + chapter.verses.length, 0);
  const lines = [
    `# ${workName} modernization audit`,
    "",
    `${passageCount} passages across ${chapters.length} chapters.`,
    "",
    "Deleted or replaced original words are struck through. Added or changed "
      + "modernized words are bold.",
    ""
  ];

  for (const chapter of chapters.sort((left, right) => left.chapter - right.chapter)) {
    lines.push(`## Chapter ${chapter.chapter}: ${chapter.title}`, "");

    for (const verse of chapter.verses) {
      const modernizedText = verse.modernizedText?.trim();

      if (!modernizedText) {
        throw new Error(`Cannot audit missing modernization for ${chapter.id}:${verse.verse}.`);
      }

      const diff = buildTwoSidedDiff(verse.text, modernizedText);
      lines.push(
        `### ${chapter.id}:${verse.verse}`,
        "",
        `Original: ${renderMarkedTokens(diff.originalTokens, diff.matchedOriginal, "del")}`,
        "",
        `Modernized: ${renderMarkedTokens(diff.modernizedTokens, diff.matchedModernized, "strong")}`,
        ""
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function buildTwoSidedDiff(original: string, modernized: string) {
  const originalTokens = tokenize(original);
  const modernizedTokens = tokenize(modernized);
  const originalContent = contentTokens(originalTokens);
  const modernizedContent = contentTokens(modernizedTokens);
  const scores = Array.from(
    { length: originalContent.length + 1 },
    () => Array(modernizedContent.length + 1).fill(0) as number[]
  );

  for (let originalIndex = 1; originalIndex <= originalContent.length; originalIndex += 1) {
    for (
      let modernizedIndex = 1;
      modernizedIndex <= modernizedContent.length;
      modernizedIndex += 1
    ) {
      scores[originalIndex][modernizedIndex] =
        originalContent[originalIndex - 1].comparable
        === modernizedContent[modernizedIndex - 1].comparable
          ? scores[originalIndex - 1][modernizedIndex - 1] + 1
          : Math.max(
            scores[originalIndex - 1][modernizedIndex],
            scores[originalIndex][modernizedIndex - 1]
          );
    }
  }

  const matchedOriginal = new Set<number>();
  const matchedModernized = new Set<number>();
  let originalIndex = originalContent.length;
  let modernizedIndex = modernizedContent.length;

  while (originalIndex > 0 && modernizedIndex > 0) {
    const originalToken = originalContent[originalIndex - 1];
    const modernizedToken = modernizedContent[modernizedIndex - 1];

    if (originalToken.comparable === modernizedToken.comparable) {
      matchedOriginal.add(originalToken.index);
      matchedModernized.add(modernizedToken.index);
      originalIndex -= 1;
      modernizedIndex -= 1;
    } else if (
      scores[originalIndex - 1][modernizedIndex]
      >= scores[originalIndex][modernizedIndex - 1]
    ) {
      originalIndex -= 1;
    } else {
      modernizedIndex -= 1;
    }
  }

  return {
    matchedModernized,
    matchedOriginal,
    modernizedTokens,
    originalTokens
  };
}

function renderMarkedTokens(
  tokens: string[],
  matchedIndexes: Set<number>,
  tag: "del" | "strong"
) {
  return tokens.map((token, index) => {
    const escaped = escapeHtml(token);
    return isWhitespace(token) || matchedIndexes.has(index)
      ? escaped
      : `<${tag}>${escaped}</${tag}>`;
  }).join("");
}

function tokenize(value: string) {
  return value.match(/\s+|\S+/g) ?? [];
}

function contentTokens(tokens: string[]) {
  return tokens
    .map((token, index) => ({ comparable: comparableToken(token), index }))
    .filter((entry) => entry.comparable);
}

function comparableToken(token: string) {
  if (isWhitespace(token)) {
    return "";
  }

  return token
    .toLocaleLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "") || token;
}

function isWhitespace(value: string) {
  return /^\s+$/.test(value);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function passageKey(chapterId: string, verse: number) {
  return `${chapterId}:${verse}`;
}

function publicAssetPath(assetPath: string) {
  if (!assetPath.startsWith("/")) {
    throw new Error(`Expected public asset path to start with "/": ${assetPath}`);
  }

  return path.join("public", assetPath.slice(1));
}

function readJson<T>(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}
