import assert from "node:assert/strict";
import test from "node:test";
import { createRustSearchAdapter } from "../../lib/r-cross-cannon.server";
import { createSearchRequestHandler } from "./search-request.server";

const bibleSource = "a".repeat(24);
const fathersSource = "anf09:xii.iv.ii:1-3";
const scriptureResult = { id: "b".repeat(24), reference: "John 1:1-5", type: "paragraph", score: 0.75, highlightVerse: 3 };
const fathersResult = { author: "Clement of Rome", chapterId: "anf09:xii.iv.iii", chapterReference: "First Clement 2", date: "AD 96", title: "First Clement", source: "anf09", score: 0.7,
  highlightPassage: { id: "ecw:" + "c".repeat(24), reference: "First Clement 2:4-6", text: "The indexed passage text.", rangeLabel: "4-6", verseStart: 4, verseEnd: 6 } };

for (const reader of ["scripture", "fathers", "classics"] as const) {
  for (const target of ["scripture", "early-christian", "christian-classics"] as const) {
    for (const similar of [false, true]) {
      test(`Rust web adapter preserves ${reader} → ${target} ${similar ? "similar" : "theme"}`, async () => {
        const selectedSource = reader === "scripture" ? bibleSource : reader === "classics" ? "classics:imitation:book-1.1:1-3" : fathersSource;
        const author = target === "christian-classics" ? "Matthew Henry and continuators" : "Clement of Rome";
        const result = target === "christian-classics" ? {...fathersResult,author,chapterId:"classics:henry:Matt.5"} : fathersResult;
        const requests: Array<Record<string, unknown>> = [];
        const fetcher: typeof fetch = async (input, options) => {
          assert.ok(String(input).startsWith("http://127.0.0.1:3006/r/api/"));
          if (String(input).endsWith("/books")) return Response.json({ books: [
            { id: "John", title: "John", corpus: "scripture", author: null },
            { id: "anf09:xii.iv", title: "First Clement", corpus: "early-christian", author: "Clement of Rome" },
            { id: "classics:henry", title: "Commentary on the Whole Bible", corpus: "christian-classics", author: "Matthew Henry and continuators" }
          ] });
          const body = JSON.parse(String(options?.body)); requests.push(body);
          return Response.json({ results: [target === "scripture" ? scriptureResult : result], source: similar ? {
            id: reader === "scripture" ? bibleSource : "ecw:" + "d".repeat(24), reference: "Selected passage", ...(reader !== "scripture" ? { text: "Selected original text" } : {})
          } : null });
        };
        const handler = createSearchRequestHandler(createRustSearchAdapter(fetcher, () => "http://127.0.0.1:3006/r/api"));
        const form = new FormData();
        const mode = similar ? "similar" : "theme";
        form.set("intent", reader === "scripture" ? (target === "scripture" ? (similar ? "similar-passage" : "theme") : `${mode}-${target === "christian-classics" ? "classics" : "early-christian"}`) : (target !== "scripture" ? (similar ? "similar-passage" : "theme") : `${mode}-scripture`));
        form.set("targetCorpus", target);
        form.set("matchCount", "10"); form.set("canon", "catholic");
        if (similar) form.set("sourcePassageId", selectedSource);
        else form.set("question", "  hope and comfort  ");
        if (target === "scripture") form.append("books", "John");
        if (target !== "scripture") form.append(reader === "scripture" ? "earlyChristianAuthors" : "authors", author);
        const response = reader === "scripture" ? await handler(form, "scripture") : await handler(form, reader);
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.targetCorpus, target);
        assert.deepEqual(requests, [{ ...(similar ? { sourceId: selectedSource } : { query: "hope and comfort" }), limit: 10,
          ...(target === "scripture" ? { books: ["John"] } : { authors: [author] }), corpus: target, mode: "semantic", canon: "orthodox", web: true }]);
        const results = target === "scripture"
          ? (reader === "scripture" ? payload.results : "scriptureResults" in payload ? payload.scriptureResults : undefined)
          : (reader === "scripture" ? "earlyChristianResults" in payload ? payload.earlyChristianResults : undefined : payload.results);
        assert.equal(results?.[0].matchStrength, target === "scripture" ? 4 : 3);
        const first = results?.[0];
        assert.ok(first);
        if (target === "scripture") assert.equal("highlightVerse" in first ? first.highlightVerse : undefined, 3);
        else assert.deepEqual("highlightPassage" in first ? first.highlightPassage : undefined, fathersResult.highlightPassage);
      });
    }
  }
}

test("Rust outage returns a usable web error while local catalog still supports reading", async () => {
  const adapter = createRustSearchAdapter(async () => { throw new Error("ECONNREFUSED"); });
  assert.ok((await adapter.getIndexedScriptureBooks()).includes("Genesis"));
  const handler = createSearchRequestHandler(adapter);
  const form = new FormData(); form.set("question", "fear and comfort");
  const response = await handler(form);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error ?? "", /temporarily unavailable/);
});

test("Rust throttling and invalid upstream results never become successful empty searches", async () => {
  for (const [status, payload, expected] of [[429, { error: "Try again shortly" }, 429], [200, { results: [{}] }, 502]] as const) {
    const adapter = createRustSearchAdapter(async input => String(input).endsWith("/books")
      ? Response.json({ books: [{ id: "John", title: "John", corpus: "scripture", author: null }] })
      : Response.json(payload, { status }));
    const form = new FormData(); form.set("question", "hope");
    const response = await createSearchRequestHandler(adapter)(form);
    assert.equal(response.status, expected);
    if (expected === 429) assert.equal((await response.json()).retryAfterSeconds, 60);
  }
});
