import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const base = process.argv[2] ?? "http://127.0.0.1:3005";
const manifest = JSON.parse(
  await readFile("scripture-cache/manifest.json", "utf8")
);
const cache = JSON.parse(
  await readFile(`scripture-cache/${manifest.version}.json`, "utf8")
);
const source: string = cache.passages.find((p: { reference: string }) =>
  p.reference.startsWith("Genesis 1:")
).id;
const response = await fetch(`${base}/?_data=routes%2F_index`, {
  method: "POST",
  body: new URLSearchParams({
    intent: "similar-passage",
    sourcePassageId: source,
    matchCount: "5",
    books: "John",
  }),
  signal: AbortSignal.timeout(30_000),
});
assert.equal(response.status, 200);
assert.equal(response.headers.get("X-Cross-Canon-Search"), "rust");
const payload = await response.json();
assert.equal(payload.results.length, 5);
assert(
  payload.results.every((r: { reference: string }) =>
    r.reference.startsWith("John ")
  )
);
console.log(
  "Web POST returned five John passages using R Cross Cannon and the existing source embedding."
);
const index = JSON.parse(
  await readFile("public/church-fathers-preview/books.json", "utf8")
);
const chapter: string = index.books.find(
  (b: { author: string }) => b.author === "Clement of Rome"
).chapters[0].id;
const crossResponse = await fetch(
  `${base}/church-fathers?_data=routes%2Fchurch-fathers`,
  {
    method: "POST",
    body: new URLSearchParams({
      intent: "similar-scripture",
      sourcePassageId: `${chapter}:1-3`,
      matchCount: "5",
      books: "John",
    }),
    signal: AbortSignal.timeout(30_000),
  }
);
assert.equal(crossResponse.status, 200);
assert.equal(crossResponse.headers.get("X-Cross-Canon-Search"), "rust");
const cross = await crossResponse.json();
assert.equal(cross.scriptureResults.length, 5);
assert(
  cross.scriptureResults.every((r: { reference: string }) =>
    r.reference.startsWith("John ")
  )
);
console.log(
  "Early Christian reader POST returned five John passages using the selected paragraph's existing vector."
);

const classicIndex = JSON.parse(
  await readFile("public/christian-classics-text/books.json", "utf8")
);
const classicChapter = classicIndex.books.find(
  (work: { id: string }) => work.id === "classics:imitation"
).chapters[0].id;
for (const [route, form, field] of [
  [
    "/?_data=routes%2F_index",
    {
      intent: "similar-classics",
      sourcePassageId: source,
      matchCount: "5",
      earlyChristianAuthors: "Thomas à Kempis",
    },
    "earlyChristianResults",
  ],
  [
    "/christian-classics/read?_data=routes%2Fchristian-classics.read",
    {
      intent: "similar-scripture",
      sourcePassageId: `${classicChapter}:1-3`,
      matchCount: "5",
      books: "John",
    },
    "scriptureResults",
  ],
] as const) {
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Cross-Canon-Search"), "rust");
  const data = await response.json();
  assert.equal(data[field].length, 5);
  assert(
    data[field].every((result: { chapterId?: string; reference?: string }) =>
      field === "earlyChristianResults"
        ? result.chapterId?.startsWith("classics:imitation:")
        : result.reference?.startsWith("John ")
    )
  );
}
console.log(
  "Scripture ↔ Classics web searches preserve corpus scope and reuse existing embeddings."
);
