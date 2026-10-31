import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const base = process.argv[2] ?? "http://127.0.0.1:3005";
const manifest = JSON.parse(await readFile("scripture-cache/manifest.json", "utf8"));
const cache = JSON.parse(await readFile(`scripture-cache/${manifest.version}.json`, "utf8"));
const source: string = cache.passages.find((p: { reference: string }) => p.reference.startsWith("Genesis 1:")).id;
const response = await fetch(`${base}/?_data=routes%2F_index`, { method: "POST", body: new URLSearchParams({ intent: "similar-passage", sourcePassageId: source, matchCount: "5", books: "John" }), signal: AbortSignal.timeout(30_000) });
assert.equal(response.status, 200);
assert.equal(response.headers.get("X-Cross-Canon-Search"), "rust");
const payload = await response.json();
assert.equal(payload.results.length, 5);
assert(payload.results.every((r: { reference: string }) => r.reference.startsWith("John ")));
console.log("Web POST returned five John passages using R Cross Cannon and the existing source embedding.");
const index = JSON.parse(await readFile("public/church-fathers-preview/books.json", "utf8"));
const chapter: string = index.books.find((b: { author: string }) => b.author === "Clement of Rome").chapters[0].id;
const crossResponse = await fetch(`${base}/church-fathers?_data=routes%2Fchurch-fathers`, {
  method: "POST", body: new URLSearchParams({ intent: "similar-scripture", sourcePassageId: `${chapter}:1-3`, matchCount: "5", books: "John" }), signal: AbortSignal.timeout(30_000)
});
assert.equal(crossResponse.status, 200);
assert.equal(crossResponse.headers.get("X-Cross-Canon-Search"), "rust");
const cross = await crossResponse.json();
assert.equal(cross.scriptureResults.length, 5);
assert(cross.scriptureResults.every((r: { reference: string }) => r.reference.startsWith("John ")));
console.log("Early Christian reader POST returned five John passages using the selected paragraph's existing vector.");
