// Compare the production legacy implementation with the Rust HTTP adapter.
// Reads existing artifacts only. Theme samples make new query-embedding requests.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { BOOKS_BY_CANON } from "../app/features/search/canons";
import { createRustSearchAdapter } from "../app/lib/r-cross-cannon.server";
import { getDb } from "../app/lib/db.server";
import { getEarlyChristianDb, getEarlyChristianEmbeddingSource, searchEarlyChristianWorks, searchSimilarEarlyChristianFromScripture, searchSimilarEarlyChristianPassages } from "../app/lib/early-christian-search.server";
import { searchScripture, searchScriptureByEmbedding, searchSimilarScripture } from "../app/lib/search.server";

assert.equal(process.env.NODE_ENV, "production", "Use NODE_ENV=production to disable DB maintenance.");
assert.notEqual(process.env.CROSS_CANNON_UPDATE_DB, "1", "This benchmark must not update artifacts.");
const output = process.env.BENCHMARK_OUTPUT ?? ".scratch/web-rust-search/runtime";
const repetitions = Number(process.env.BENCHMARK_SAMPLES ?? 7);
assert(Number.isInteger(repetitions) && repetitions >= 3 && repetitions <= 30);
const rust = createRustSearchAdapter();
const manifest = JSON.parse(await readFile("scripture-cache/manifest.json", "utf8"));
const scripture = JSON.parse(await readFile(`scripture-cache/${manifest.version}.json`, "utf8"));
const bibleId: string = scripture.passages.find((p: { reference: string }) => p.reference.startsWith("Genesis 1:")).id;
const sourceRows = await getEarlyChristianDb().execute("SELECT p.id FROM passages p JOIN early_christian_passage_metadata pm ON pm.passage_id=p.id JOIN early_christian_works w ON w.id=pm.work_id WHERE w.author='Clement of Rome' AND p.embedding IS NOT NULL ORDER BY p.reference LIMIT 1");
const earlyId = String(sourceRows.rows[0].id);
const books = [...BOOKS_BY_CANON.protestant];
type Result = { id?: string; reference?: string; chapterId?: string; chapterReference?: string; score?: number; highlightVerse?: number; highlightPassage?: { id: string; reference: string } };
type Run = () => Promise<Result[]>;
const required = <T>(value: T | null): T => { assert(value, "Missing source/results"); return value; };
const cases: { name: string; legacy: Run; rust: Run; paid?: boolean }[] = [
  { name: "Scripture → Scripture, Protestant canon", legacy: async () => required(await searchSimilarScripture(bibleId, 10, books)).results,
    rust: async () => required(await rust.searchScriptureSimilarFromScripture(bibleId, 10, books)).results },
  { name: "Scripture → Scripture, John only", legacy: async () => required(await searchSimilarScripture(bibleId, 10, ["John"])).results,
    rust: async () => required(await rust.searchScriptureSimilarFromScripture(bibleId, 10, ["John"])).results },
  { name: "Scripture → Early Christian, all authors", legacy: async () => required(await searchSimilarEarlyChristianFromScripture(bibleId, 10)).results,
    rust: async () => required(await rust.searchEarlyChristianSimilarFromScripture(bibleId, 10, [])).results },
  { name: "Early Christian → Scripture", legacy: async () => { const source = required(await getEarlyChristianEmbeddingSource(earlyId)); return searchScriptureByEmbedding(source.embedding, 10, books); },
    rust: async () => required(await rust.searchScriptureSimilarFromEarlyChristian(earlyId, 10, books)).results },
  { name: "Early Christian → Early Christian, Clement of Rome", legacy: async () => required(await searchSimilarEarlyChristianPassages(earlyId, 10, ["Clement of Rome"])).results,
    rust: async () => required(await rust.searchEarlyChristianSimilarFromEarlyChristian(earlyId, 10, ["Clement of Rome"])).results }
];
if (process.env.BENCHMARK_THEMES === "1") cases.push(
  { name: "Theme Scripture: fear and comfort", paid: true, legacy: () => searchScripture("fear and comfort", 10, books), rust: () => rust.searchScriptureTheme("fear and comfort", 10, books) },
  { name: "Theme Early Christian: fear and comfort", paid: true, legacy: () => searchEarlyChristianWorks("fear and comfort", 10), rust: () => rust.searchEarlyChristianTheme("fear and comfort", 10, []) }
);
const percentile = (samples: number[], fraction: number) => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * fraction) - 1];
const stats = (samples: number[]) => ({ medianMs: percentile(samples, .5), p95Ms: percentile(samples, .95), minMs: Math.min(...samples), samples });
const key = (r: Result) => r.chapterId ?? r.id;
const rows = [];
try {
  for (const test of cases) {
    const first: Record<string, number> = {};
    const samples = { legacy: [] as number[], rust: [] as number[] };
    const results = { legacy: [] as Result[], rust: [] as Result[] };
    const count = test.paid ? 3 : repetitions;
    // First request per case is reported separately, then excluded from warm samples.
    for (let i = -1; i < count; i++) {
      for (const backend of i % 2 === 0 ? ["rust", "legacy"] as const : ["legacy", "rust"] as const) {
        const start = performance.now();
        results[backend] = await test[backend]();
        const elapsed = performance.now() - start;
        if (backend === "rust") assert.equal(results[backend].length, 10, `${test.name}: Rust must return ten results`);
        if (i < 0) first[backend] = elapsed;
        else samples[backend].push(elapsed);
      }
    }
    const legacy = stats(samples.legacy), native = stats(samples.rust);
    const keys = new Set(results.legacy.map(key));
    const overlap = results.rust.filter(r => keys.has(key(r))).length;
    const row = { name: test.name, paid: Boolean(test.paid), firstRequestMs: first, legacy, rust: native,
      legacyCount: results.legacy.length, rustCount: results.rust.length,
      speedup: results.legacy.length === 10 ? legacy.medianMs / native.medianMs : null, top10Overlap: overlap,
      sameOrder: results.legacy.length === results.rust.length && results.rust.every((r, i) => key(r) === key(results.legacy[i])),
      results };
    rows.push(row);
    console.log(`${test.name}: legacy ${legacy.medianMs.toFixed(1)} ms (${row.legacyCount} results), Rust ${native.medianMs.toFixed(1)} ms; ${row.speedup?.toFixed(2) ?? "invalid baseline"}×; overlap ${overlap}/10`);
  }
  const report = { date: new Date().toISOString(), platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0].model, node: process.version,
    cacheVersion: manifest.version, bibleId, earlyId,
    method: "Sequential alternating backends; one first request per case excluded, then warm samples. Legacy in-process libSQL + JS; Rust release process via loopback HTTP including response validation. Same existing vectors, ten results, identical filters. p95 is nearest-rank; three theme samples are descriptive, not a reliable tail estimate. Theme time includes live OpenAI query embedding. No artifact regeneration.", rows };
  await mkdir(output.slice(0, output.lastIndexOf("/")), { recursive: true });
  await writeFile(`${output}.json`, JSON.stringify(report, null, 2) + "\n");
  await writeFile(`${output}.md`, `# Search runtime comparison\n\n${report.date} · ${report.platform} · ${report.cpu} · Node ${report.node}\n\n${report.method}\n\n| Search | Legacy median / p95 (count) | Rust median / p95 | Median ratio | Top 10 overlap |\n|---|---:|---:|---:|---:|\n` + rows.map(r => `| ${r.name} | ${r.legacy.medianMs.toFixed(1)} / ${r.legacy.p95Ms.toFixed(1)} ms (${r.legacyCount}) | ${r.rust.medianMs.toFixed(1)} / ${r.rust.p95Ms.toFixed(1)} ms | ${r.speedup === null ? "invalid baseline" : r.speedup.toFixed(2) + "×"} | ${r.top10Overlap}/10 |`).join("\n") + `\n\nAn incomplete legacy result set is an invalid speed baseline, not a faster search. Rust scores the stored Scripture/chapter vectors exactly; legacy broad searches use an approximate libSQL index. Both refine Early Christian chapters to their best stored paragraph. Ranking differences and selected paragraph IDs are recorded in [runtime JSON](${output.split("/").pop()}.json). No UI rendering time is included.\n`);
} finally {
  getDb().close();
  getEarlyChristianDb().close();
}
