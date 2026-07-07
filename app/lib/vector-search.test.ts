import assert from "node:assert/strict";
import test from "node:test";

import {
  cosineSimilarity,
  readEmbeddingBlob,
  readStoredEmbedding
} from "./vector-search.server";

test("readStoredEmbedding decodes ArrayBuffer embeddings", () => {
  const vector = new Float32Array([0.25, 0.5, 0.75]);
  const stored = readStoredEmbedding({ embedding: vector.buffer });

  assert.deepEqual(stored ? [...stored] : null, [0.25, 0.5, 0.75]);
});

test("readEmbeddingBlob decodes typed array views", () => {
  const buffer = new ArrayBuffer(16);
  const view = new Float32Array(buffer, 4, 2);
  view.set([0.5, 1]);
  const stored = readEmbeddingBlob(view);

  assert.deepEqual(stored ? [...stored] : null, [0.5, 1]);
});

test("readEmbeddingBlob rejects invalid byte lengths", () => {
  assert.equal(readEmbeddingBlob(new Uint8Array([1, 2, 3])), null);
});

test("cosineSimilarity scores overlapping vector dimensions", () => {
  assert.equal(cosineSimilarity([1, 2, 3], [4, 5]), 14);
});
