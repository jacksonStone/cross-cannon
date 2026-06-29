import { performance } from "node:perf_hooks";

import { ensureDatabase, getDb } from "../app/lib/db.server";
import * as searchModule from "../app/lib/search.server";

const queries = [
  "fear and comfort",
  "wisdom for suffering",
  "the mercy of God",
  "repentance and forgiveness",
  "hope in exile",
  "pride before destruction",
  "care for the poor",
  "faith during trials"
];

const iterations = Number(process.env.BENCH_ITERATIONS ?? 24);
const warmSearches = Number(process.env.BENCH_WARM_SEARCHES ?? 4);
const limit = Number(process.env.BENCH_LIMIT ?? 10);
const shouldWarmEmbeddingCache = process.env.BENCH_WARM_CACHE === "1";

function rssMb() {
  return Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10;
}

function percentile(values: number[], p: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function roundMs(value: number) {
  return Math.round(value * 10) / 10;
}

async function timed<T>(operation: () => Promise<T>) {
  const start = performance.now();
  const result = await operation();
  return {
    result,
    ms: performance.now() - start
  };
}

async function countRows() {
  await ensureDatabase();

  const response = await getDb().execute(`
    SELECT
      (SELECT COUNT(*) FROM passages) AS passages,
      (SELECT COUNT(*) FROM paragraph_verses) AS verses
  `);
  const row = response.rows[0] ?? {};

  return {
    passages: Number(row.passages ?? 0),
    verses: Number(row.verses ?? 0)
  };
}

async function main() {
  process.env.EMBEDDING_PROVIDER ??= "mock";

  const rows = await countRows();
  const initialRss = rssMb();
  let cacheWarmMs: number | null = null;
  let cacheCount: number | null = null;

  if (shouldWarmEmbeddingCache) {
    const warmPassageEmbeddingCache = "warmPassageEmbeddingCache" in searchModule
      ? searchModule.warmPassageEmbeddingCache as (() => Promise<number>)
      : null;

    if (warmPassageEmbeddingCache) {
      const cacheWarm = await timed(() => warmPassageEmbeddingCache());
      cacheWarmMs = cacheWarm.ms;
      cacheCount = cacheWarm.result;
    }
  }

  for (let index = 0; index < warmSearches; index += 1) {
    await searchModule.searchScripture(queries[index % queries.length] ?? queries[0], limit);
  }

  const durations: number[] = [];
  let totalResults = 0;

  for (let index = 0; index < iterations; index += 1) {
    const query = queries[index % queries.length] ?? queries[0];
    const search = await timed(() => searchModule.searchScripture(query, limit));
    durations.push(search.ms);
    totalResults += search.result.length;
  }

  const mean = durations.reduce((sum, value) => sum + value, 0) / durations.length;

  console.log(JSON.stringify({
    databaseUrl: process.env.DATABASE_URL ?? "file:./storage/crosscannon.db",
    provider: process.env.EMBEDDING_PROVIDER,
    passages: rows.passages,
    verses: rows.verses,
    limit,
    iterations,
    warmSearches,
    warmEmbeddingCache: shouldWarmEmbeddingCache,
    cacheWarmMs: cacheWarmMs === null ? null : roundMs(cacheWarmMs),
    cacheCount,
    rssInitialMb: initialRss,
    rssFinalMb: rssMb(),
    totalResults,
    meanMs: roundMs(mean),
    p50Ms: roundMs(percentile(durations, 50)),
    p90Ms: roundMs(percentile(durations, 90)),
    p95Ms: roundMs(percentile(durations, 95)),
    minMs: roundMs(Math.min(...durations)),
    maxMs: roundMs(Math.max(...durations))
  }, null, 2));
}

await main();
