import {
  getEarlyChristianEmbeddingSource,
  searchEarlyChristianPassagesByEmbedding,
  searchSimilarEarlyChristianFromScripture
} from "./early-christian-search.server";
import type { ScriptureResult } from "./db.server";
import {
  searchScriptureByEmbedding
} from "./search.server";

export async function searchFathersSimilarToScripture(
  passageId: string,
  limit = 10
) {
  return searchSimilarEarlyChristianFromScripture(passageId, limit);
}

export async function searchScriptureSimilarToFathers(
  sourceKey: string,
  limit = 10,
  books: string[] = []
): Promise<{
  results: ScriptureResult[];
  source: {
    id: string;
    reference: string;
    text: string;
  };
} | null> {
  const source = await getEarlyChristianEmbeddingSource(sourceKey);

  if (!source) {
    return null;
  }

  const results = await searchScriptureByEmbedding(source.embedding, limit, books);

  return {
    results,
    source: {
      id: source.id,
      reference: source.reference,
      text: source.text
    }
  };
}

export async function searchFathersPassagesByEmbedding(
  embedding: ArrayLike<number>,
  limit = 10
) {
  return searchEarlyChristianPassagesByEmbedding(embedding, limit);
}
