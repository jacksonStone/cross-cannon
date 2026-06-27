import { json } from "@remix-run/node";

import { ensureDatabase, getDb } from "~/lib/db.server";
import { searchScripture } from "~/lib/search.server";

import { BOOKS_BY_CANON, DEFAULT_MATCH_COUNT, parseCanonMode, sortCanonicalBooks } from "./canons";
import type { SearchActionData } from "./types";

export async function getIndexedBooks() {
  await ensureDatabase();

  const booksResponse = await getDb().execute(`
    SELECT book
    FROM passages
    GROUP BY book
    ORDER BY MIN(rowid)
  `);

  return sortCanonicalBooks(booksResponse.rows.map((row) => String(row.book)));
}

export async function handleSearchRequest(formData: FormData) {
  const question = String(formData.get("question") ?? "").trim();
  const canon = parseCanonMode(String(formData.get("canon") ?? ""));
  const selectedBooks = formData
    .getAll("books")
    .map((value) => String(value).trim())
    .filter(Boolean);
  const matchCount = Number(formData.get("matchCount") ?? DEFAULT_MATCH_COUNT);

  if (question.length < 3) {
    return json<SearchActionData>(
      { error: "Enter a longer question." },
      { status: 400 }
    );
  }

  if (question.length > 500) {
    return json<SearchActionData>(
      { error: "Keep the question under 500 characters." },
      { status: 400 }
    );
  }

  if (!Number.isInteger(matchCount) || matchCount < 5 || matchCount > 40) {
    return json<SearchActionData>(
      { error: "Choose between 5 and 40 matches." },
      { status: 400 }
    );
  }

  const booksResponse = await getDb().execute("SELECT book FROM passages GROUP BY book");
  const indexedBooks = new Set(booksResponse.rows.map((row) => String(row.book)));
  const canonBooks = BOOKS_BY_CANON[canon];
  const books = Array.from(new Set(selectedBooks)).filter(
    (book) => indexedBooks.has(book) && canonBooks.has(book)
  );

  if (selectedBooks.length > 0 && books.length === 0) {
    return json<SearchActionData>(
      { error: "Choose at least one indexed book in the selected canon." },
      { status: 400 }
    );
  }

  const searchBooks = books.length > 0
    ? books
    : Array.from(canonBooks).filter((book) => indexedBooks.has(book));
  const results = withMatchStrength(await searchScripture(question, matchCount, searchBooks));

  return json<SearchActionData>({
    question,
    canon,
    books,
    matchCount,
    results
  });
}

function withMatchStrength<T extends { score?: number }>(results: T[]) {
  const scores = results
    .map((result) => result.score)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  const min = scores.length ? Math.min(...scores) : null;
  const max = scores.length ? Math.max(...scores) : null;
  const spread = min !== null && max !== null ? max - min : 0;
  const denominator = Math.max(results.length - 1, 1);

  return results.map((result, index) => {
    let matchStrength = Math.max(1, 4 - Math.floor((index / denominator) * 4));

    if (typeof result.score === "number" && Number.isFinite(result.score)) {
      matchStrength = spread > 0
        ? 1 + Math.round(((result.score - (min ?? result.score)) / spread) * 3)
        : 4;
    }

    return {
      ...result,
      matchStrength: Math.max(1, Math.min(4, matchStrength))
    };
  });
}
