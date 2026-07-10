import assert from "node:assert/strict";
import test from "node:test";

import {
  createSearchRequestHandler,
  isSearchSourcePassageId,
  parseSearchMatchCount,
  type SearchRequestAdapter,
  validateSearchQuestion
} from "./search-request.server";

const unusedSearch = async () => {
  throw new Error("Unexpected search adapter call.");
};

function createSearchAdapter(
  overrides: Partial<SearchRequestAdapter> = {}
): SearchRequestAdapter {
  return {
    getEarlyChristianAuthors: async () => [],
    getIndexedScriptureBooks: async () => ["Genesis", "John"],
    searchEarlyChristianSimilarFromEarlyChristian: unusedSearch,
    searchEarlyChristianSimilarFromScripture: unusedSearch,
    searchEarlyChristianTheme: unusedSearch,
    searchScriptureSimilarFromEarlyChristian: unusedSearch,
    searchScriptureSimilarFromScripture: unusedSearch,
    searchScriptureTheme: unusedSearch,
    ...overrides
  };
}

test("Search Request preserves a Scripture reader theme search", async () => {
  const calls: unknown[] = [];
  const handler = createSearchRequestHandler(createSearchAdapter({
    searchScriptureTheme: async (question, limit, books) => {
      calls.push({ books, limit, question });
      return [{
        id: "passage-1",
        reference: "Genesis 1:1",
        score: 0.8,
        type: "paragraph" as const
      }];
    }
  }));
  const formData = new FormData();
  formData.set("question", "  hope  ");
  formData.set("matchCount", "20");
  formData.append("books", "Genesis");
  formData.append("books", "Mark");

  const response = await handler(formData, "scripture");

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{
    books: ["Genesis"],
    limit: 20,
    question: "hope"
  }]);
  assert.deepEqual(await response.json(), {
    books: ["Genesis"],
    canon: "protestant",
    earlyChristianAuthors: [],
    matchCount: 20,
    mode: "theme",
    question: "hope",
    results: [{
      id: "passage-1",
      matchStrength: 4,
      reference: "Genesis 1:1",
      score: 0.8,
      type: "paragraph"
    }],
    targetCorpus: "scripture"
  });
});

test("Search Request preserves a Scripture reader Early Christian theme search", async () => {
  const calls: unknown[] = [];
  const result = {
    author: "Augustine",
    chapterId: "confessions-1",
    chapterReference: "Confessions 1",
    date: "397",
    highlightPassage: {
      id: "confessions-1:1",
      rangeLabel: "1",
      reference: "Confessions 1.1",
      text: "You have made us for yourself.",
      verseEnd: 1,
      verseStart: 1
    },
    matchStrength: 4,
    score: 0.8,
    source: "ccel",
    title: "Confessions"
  };
  const handler = createSearchRequestHandler(createSearchAdapter({
    getEarlyChristianAuthors: async () => ["Augustine"],
    searchEarlyChristianTheme: async (question, limit, authors) => {
      calls.push({ authors, limit, question });
      return [result];
    }
  }));
  const formData = new FormData();
  formData.set("intent", "theme-early-christian");
  formData.set("question", "  restless heart  ");
  formData.set("matchCount", "15");
  formData.append("earlyChristianAuthors", "Augustine");

  const response = await handler(formData, "scripture");

  assert.deepEqual(calls, [{
    authors: ["Augustine"],
    limit: 15,
    question: "restless heart"
  }]);
  assert.deepEqual(await response.json(), {
    earlyChristianAuthors: ["Augustine"],
    earlyChristianResults: [result],
    matchCount: 15,
    mode: "theme-early-christian",
    question: "restless heart",
    targetCorpus: "early-christian"
  });
});

test("Search Request preserves a Scripture reader similar Scripture search", async () => {
  const sourcePassageId = "a".repeat(24);
  const calls: unknown[] = [];
  const handler = createSearchRequestHandler(createSearchAdapter({
    searchScriptureSimilarFromScripture: async (source, limit, books) => {
      calls.push({ books, limit, source });
      return {
        results: [{
          id: "passage-2",
          reference: "John 1:1",
          score: 0.72,
          type: "paragraph"
        }],
        source: {
          id: sourcePassageId,
          reference: "Genesis 1:1"
        }
      };
    }
  }));
  const formData = new FormData();
  formData.set("intent", "similar-passage");
  formData.set("sourcePassageId", sourcePassageId);

  const response = await handler(formData, "scripture");

  assert.deepEqual(calls, [{
    books: ["Genesis", "John"],
    limit: 10,
    source: sourcePassageId
  }]);
  assert.deepEqual(await response.json(), {
    books: [],
    canon: "protestant",
    earlyChristianAuthors: [],
    matchCount: 10,
    mode: "similar",
    results: [{
      id: "passage-2",
      matchStrength: 3,
      reference: "John 1:1",
      score: 0.72,
      type: "paragraph"
    }],
    similarSource: {
      id: sourcePassageId,
      reference: "Genesis 1:1"
    },
    targetCorpus: "scripture"
  });
});

test("Search Request preserves a Scripture reader similar Early Christian search", async () => {
  const sourcePassageId = "b".repeat(24);
  const result = {
    author: "Irenaeus",
    chapterId: "against-heresies-1",
    chapterReference: "Against Heresies 1",
    date: "180",
    highlightPassage: {
      id: "against-heresies-1:1",
      rangeLabel: "1",
      reference: "Against Heresies 1.1",
      text: "The Church, though dispersed throughout the whole world.",
      verseEnd: 1,
      verseStart: 1
    },
    matchStrength: 3,
    score: 0.68,
    source: "ccel",
    title: "Against Heresies"
  };
  const handler = createSearchRequestHandler(createSearchAdapter({
    searchEarlyChristianSimilarFromScripture: async () => ({
      results: [result],
      source: {
        id: sourcePassageId,
        reference: "John 17:21"
      }
    })
  }));
  const formData = new FormData();
  formData.set("intent", "similar-early-christian");
  formData.set("sourcePassageId", sourcePassageId);

  const response = await handler(formData, "scripture");

  assert.deepEqual(await response.json(), {
    books: [],
    canon: "protestant",
    earlyChristianAuthors: [],
    earlyChristianResults: [result],
    matchCount: 10,
    mode: "similar-early-christian",
    similarSource: {
      id: sourcePassageId,
      reference: "John 17:21"
    },
    targetCorpus: "early-christian"
  });
});

test("Search Request preserves an Early Christian reader theme search", async () => {
  const calls: unknown[] = [];
  const result = {
    author: "Athanasius",
    chapterId: "incarnation-1",
    chapterReference: "On the Incarnation 1",
    date: "318",
    highlightPassage: {
      id: "incarnation-1:1",
      rangeLabel: "1",
      reference: "On the Incarnation 1.1",
      text: "The Word of the Father is above all.",
      verseEnd: 1,
      verseStart: 1
    },
    matchStrength: 4,
    score: 0.8,
    source: "ccel",
    title: "On the Incarnation"
  };
  const handler = createSearchRequestHandler(createSearchAdapter({
    getEarlyChristianAuthors: async () => ["Athanasius"],
    searchEarlyChristianTheme: async (question, limit, authors) => {
      calls.push({ authors, limit, question });
      return [result];
    }
  }));
  const formData = new FormData();
  formData.set("question", "  the Word  ");
  formData.append("authors", "Athanasius");

  const response = await handler(formData, "fathers");

  assert.deepEqual(calls, [{
    authors: ["Athanasius"],
    limit: 10,
    question: "the Word"
  }]);
  assert.deepEqual(await response.json(), {
    authors: ["Athanasius"],
    matchCount: 10,
    mode: "theme",
    question: "the Word",
    results: [result],
    targetCorpus: "early-christian"
  });
});

test("Search Request preserves an Early Christian reader similar search", async () => {
  const sourcePassageId = "confessions-1:1";
  const source = {
    id: sourcePassageId,
    reference: "Confessions 1.1",
    text: "You have made us for yourself."
  };
  const handler = createSearchRequestHandler(createSearchAdapter({
    searchEarlyChristianSimilarFromEarlyChristian: async () => ({
      results: [],
      source
    })
  }));
  const formData = new FormData();
  formData.set("intent", "similar-passage");
  formData.set("sourcePassageId", sourcePassageId);

  const response = await handler(formData, "fathers");

  assert.deepEqual(await response.json(), {
    authors: [],
    matchCount: 10,
    mode: "similar",
    results: [],
    similarSource: source,
    targetCorpus: "early-christian"
  });
});

test("Search Request preserves an Early Christian reader Scripture theme search", async () => {
  const calls: unknown[] = [];
  const handler = createSearchRequestHandler(createSearchAdapter({
    searchScriptureTheme: async (question, limit, books) => {
      calls.push({ books, limit, question });
      return [{
        id: "tobit-1",
        reference: "Tobit 1:1",
        score: 0.8,
        type: "paragraph"
      }];
    }
  }));
  const formData = new FormData();
  formData.set("intent", "theme-scripture");
  formData.set("canon", "catholic");
  formData.set("question", "  almsgiving  ");
  formData.append("books", "Tobit");
  formData.append("books", "3 Maccabees");

  const response = await handler(formData, "fathers");

  assert.deepEqual(calls, [{
    books: ["Tobit"],
    limit: 10,
    question: "almsgiving"
  }]);
  assert.deepEqual(await response.json(), {
    books: ["Tobit"],
    canon: "catholic",
    matchCount: 10,
    mode: "theme-scripture",
    question: "almsgiving",
    scriptureResults: [{
      id: "tobit-1",
      matchStrength: 4,
      reference: "Tobit 1:1",
      score: 0.8,
      type: "paragraph"
    }],
    targetCorpus: "scripture"
  });
});

test("Search Request preserves an Early Christian reader similar Scripture search", async () => {
  const sourcePassageId = "incarnation-1:1";
  const source = {
    id: sourcePassageId,
    reference: "On the Incarnation 1.1",
    text: "The Word of the Father is above all."
  };
  const handler = createSearchRequestHandler(createSearchAdapter({
    searchScriptureSimilarFromEarlyChristian: async () => ({
      results: [{
        id: "john-1",
        reference: "John 1:1",
        score: 0.8,
        type: "paragraph"
      }],
      source
    })
  }));
  const formData = new FormData();
  formData.set("intent", "similar-scripture");
  formData.set("sourcePassageId", sourcePassageId);
  formData.append("books", "John");

  const response = await handler(formData, "fathers");

  assert.deepEqual(await response.json(), {
    books: ["John"],
    canon: "protestant",
    matchCount: 10,
    mode: "similar-scripture",
    scriptureResults: [{
      id: "john-1",
      matchStrength: 4,
      reference: "John 1:1",
      score: 0.8,
      type: "paragraph"
    }],
    similarScriptureSource: source,
    targetCorpus: "scripture"
  });
});

test("parseSearchMatchCount accepts valid match counts", () => {
  assert.deepEqual(parseSearchMatchCount("20"), { matchCount: 20 });
});

test("parseSearchMatchCount rejects out-of-range counts", () => {
  assert.deepEqual(parseSearchMatchCount("41"), {
    error: "Choose between 5 and 40 matches.",
    status: 400
  });
});

test("validateSearchQuestion enforces length limits", () => {
  assert.deepEqual(validateSearchQuestion("hope"), { question: "hope" });
  assert.deepEqual(validateSearchQuestion("no"), {
    error: "Enter a longer question.",
    status: 400
  });
  assert.deepEqual(validateSearchQuestion("x".repeat(501)), {
    error: "Keep the question under 500 characters.",
    status: 400
  });
});

test("isSearchSourcePassageId accepts indexed passage ids", () => {
  assert.equal(isSearchSourcePassageId("a".repeat(24)), true);
  assert.equal(isSearchSourcePassageId("not-a-passage"), false);
});
