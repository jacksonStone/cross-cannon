export type StoredEmbeddingRow = {
  embedding?: unknown;
};

export function readStoredEmbedding(row: StoredEmbeddingRow) {
  return readEmbeddingBlob(row.embedding);
}

export function readEmbeddingBlob(value: unknown) {
  if (value instanceof ArrayBuffer) {
    return value.byteLength % Float32Array.BYTES_PER_ELEMENT === 0
      ? new Float32Array(value)
      : null;
  }

  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;

    return view.byteLength % Float32Array.BYTES_PER_ELEMENT === 0
      ? new Float32Array(
        view.buffer,
        view.byteOffset,
        view.byteLength / Float32Array.BYTES_PER_ELEMENT
      )
      : null;
  }

  return null;
}

export function cosineSimilarity(left: ArrayLike<number>, right: ArrayLike<number>) {
  const length = Math.min(left.length, right.length);
  let sum = 0;

  for (let index = 0; index < length; index += 1) {
    sum += left[index] * right[index];
  }

  return sum;
}
