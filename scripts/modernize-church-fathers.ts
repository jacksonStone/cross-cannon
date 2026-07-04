import fs from "node:fs";
import path from "node:path";

import OpenAI from "openai";

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
  id: string;
  title: string;
  verses: Array<{
    modernizedText?: string;
    text: string;
    verse: number;
  }>;
};

type ModernizationTarget = {
  chapter: ChapterAsset;
  filePath: string;
  key: string;
  text: string;
  verse: ChapterAsset["verses"][number];
};

type ModernizationResponse = {
  passages: Array<{
    key: string;
    modernizedText: string;
  }>;
};

const DEFAULT_WORK_ID = "npnf102:iv";
const DEFAULT_MODEL = process.env.MODERNIZATION_MODEL ?? "gpt-5.4-mini";
const BOOK_INDEX_PATH = "public/church-fathers-preview/books.json";

const options = parseArgs(process.argv.slice(2));

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required to modernize church fathers passages.");
}

const bookIndex = readJson<BookIndex>(BOOK_INDEX_PATH);
const work = bookIndex.books.find((book) => book.id === options.workId);

if (!work) {
  throw new Error(`Could not find work ${options.workId} in ${BOOK_INDEX_PATH}.`);
}

const targets = collectTargets(work, options.limit, options.force);

if (targets.length === 0) {
  console.log(`No passages need modernization for ${work.name}.`);
  process.exit(0);
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const response = await client.responses.create({
  instructions: [
    "You modernize public-domain English translations of patristic texts.",
    "Preserve the author's meaning, theological claims, argumentative force, tone, and register.",
    "Stay very close to the original. Do not summarize, expand, explain, soften, or paraphrase.",
    "Modernize archaic English forms and word order when needed for contemporary readability.",
    "Do not leave archaic forms such as unto, hath, doth, giveth, resisteth, thee, thou, thy, thine, shalt, art, dost, hast, whence, thither, or hither in the output unless they are part of a proper title.",
    "Examples: unto -> to, hath -> has, doth -> does, giveth -> gives, resisteth -> resists, thee/thou/thy -> you/your where grammatically appropriate.",
    "Modernize archaic wording inside quotations too, while preserving the quoted meaning.",
    "Preserve proper names, quoted poetry line breaks, doctrinal terms, punctuation, and paragraph boundaries as much as possible.",
    "Return exactly one modernizedText string for every input key."
  ].join(" "),
  input: JSON.stringify({
    passages: targets.map((target) => ({
      key: target.key,
      text: target.text
    }))
  }),
  max_output_tokens: Math.max(1200, targets.reduce((total, target) => total + target.text.length, 0)),
  model: options.model,
  text: {
    format: {
      name: "church_fathers_modernization",
      schema: {
        additionalProperties: false,
        properties: {
          passages: {
            items: {
              additionalProperties: false,
              properties: {
                key: { type: "string" },
                modernizedText: { type: "string" }
              },
              required: ["key", "modernizedText"],
              type: "object"
            },
            type: "array"
          }
        },
        required: ["passages"],
        type: "object"
      },
      strict: true,
      type: "json_schema"
    },
    verbosity: "low"
  }
});

const output = parseModernizationResponse(response.output_text);
const outputByKey = new Map(output.passages.map((passage) => [passage.key, passage.modernizedText]));
const changedFiles = new Map<string, ChapterAsset>();

for (const target of targets) {
  const modernizedText = outputByKey.get(target.key)?.trim();

  if (!modernizedText) {
    throw new Error(`Missing modernized text for ${target.key}.`);
  }

  target.verse.modernizedText = modernizedText;
  changedFiles.set(target.filePath, target.chapter);
}

for (const [filePath, chapter] of changedFiles) {
  fs.writeFileSync(filePath, JSON.stringify(chapter, null, 0), "utf8");
}

console.log(JSON.stringify({
  changedFiles: [...changedFiles.keys()],
  count: targets.length,
  model: options.model,
  work: work.name,
  workId: work.id
}, null, 2));

function parseArgs(args: string[]) {
  let force = false;
  let limit = 10;
  let model = DEFAULT_MODEL;
  let workId = DEFAULT_WORK_ID;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--limit" && next) {
      limit = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--model" && next) {
      model = next;
      index += 1;
      continue;
    }

    if (arg === "--work" && next) {
      workId = next;
      index += 1;
      continue;
    }

    if (arg === "--force") {
      force = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("--limit must be a positive integer.");
  }

  return { force, limit, model, workId };
}

function collectTargets(work: BookIndex["books"][number], limit: number, force: boolean) {
  const targets: ModernizationTarget[] = [];

  for (const chapterSummary of work.chapters) {
    const filePath = publicAssetPath(chapterSummary.assetPath);
    const chapter = readJson<ChapterAsset>(filePath);

    for (const verse of chapter.verses) {
      if (!force && verse.modernizedText?.trim()) {
        continue;
      }

      targets.push({
        chapter,
        filePath,
        key: `${chapter.id}:${verse.verse}`,
        text: verse.text,
        verse
      });

      if (targets.length >= limit) {
        return targets;
      }
    }
  }

  return targets;
}

function publicAssetPath(assetPath: string) {
  if (!assetPath.startsWith("/")) {
    throw new Error(`Expected public asset path to start with "/": ${assetPath}`);
  }

  return path.join("public", assetPath.slice(1));
}

function parseModernizationResponse(raw: string): ModernizationResponse {
  const parsed = JSON.parse(raw) as ModernizationResponse;

  if (!Array.isArray(parsed.passages)) {
    throw new Error("Model response did not include a passages array.");
  }

  return parsed;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}
