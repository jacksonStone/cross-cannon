import { useEffect, useMemo, useRef, useState } from "react";

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";

import { ensureDatabase, getDb } from "~/lib/db.server";
import { getClientIp, rateLimit } from "~/lib/rate-limit.server";
import { searchScripture } from "~/lib/search.server";

type BrowserPassage = {
  id: string;
  reference: string;
  text: string;
  type: "paragraph";
  verses: Array<{
    number: number;
    text: string;
  }>;
};

type ActionData = {
  error?: string;
  question?: string;
  books?: string[];
  matchCount?: number;
  results?: Array<{
    id: string;
    reference: string;
    type: "paragraph";
    highlightVerse?: number;
    score?: number;
    matchStrength: number;
  }>;
  retryAfterSeconds?: number;
};

const TRANSLATION_ABBREVIATION = "WEB";
const SEARCH_EXAMPLES = [
  "Hope after death",
  "greed and money problems",
  "anxiety",
  "laughing when times are hard",
  "always learning",
  "the beauty of nature"
];
const CANONICAL_BOOKS = [
  "Genesis",
  "Exodus",
  "Leviticus",
  "Numbers",
  "Deuteronomy",
  "Joshua",
  "Judges",
  "Ruth",
  "1 Samuel",
  "2 Samuel",
  "1 Kings",
  "2 Kings",
  "1 Chronicles",
  "2 Chronicles",
  "Ezra",
  "Nehemiah",
  "Esther",
  "Job",
  "Psalms",
  "Proverbs",
  "Ecclesiastes",
  "Song of Songs",
  "Isaiah",
  "Jeremiah",
  "Lamentations",
  "Ezekiel",
  "Daniel",
  "Hosea",
  "Joel",
  "Amos",
  "Obadiah",
  "Jonah",
  "Micah",
  "Nahum",
  "Habakkuk",
  "Zephaniah",
  "Haggai",
  "Zechariah",
  "Malachi",
  "Matthew",
  "Mark",
  "Luke",
  "John",
  "Acts",
  "Romans",
  "1 Corinthians",
  "2 Corinthians",
  "Galatians",
  "Ephesians",
  "Philippians",
  "Colossians",
  "1 Thessalonians",
  "2 Thessalonians",
  "1 Timothy",
  "2 Timothy",
  "Titus",
  "Philemon",
  "Hebrews",
  "James",
  "1 Peter",
  "2 Peter",
  "1 John",
  "2 John",
  "3 John",
  "Jude",
  "Revelation"
];
const CANONICAL_BOOK_ORDER = new Map(
  CANONICAL_BOOKS.map((book, index) => [book, index])
);

export async function loader({}: LoaderFunctionArgs) {
  await ensureDatabase();

  const response = await getDb().execute(`
    SELECT id, reference, text, result_type
    FROM passages
    WHERE text <> ''
    ORDER BY book, chapter, verse_start IS NULL, verse_start
  `);
  const booksResponse = await getDb().execute(`
    SELECT book
    FROM passages
    GROUP BY book
    ORDER BY MIN(rowid)
  `);
  const versesResponse = await getDb().execute(`
    SELECT paragraph_id, verse, text
    FROM paragraph_verses
    ORDER BY book, chapter, verse
  `);
  const versesByParagraph = new Map<string, BrowserPassage["verses"]>();

  for (const row of versesResponse.rows) {
    const paragraphId = String(row.paragraph_id);
    const verses = versesByParagraph.get(paragraphId) ?? [];
    verses.push({
      number: Number(row.verse),
      text: String(row.text)
    });
    versesByParagraph.set(paragraphId, verses);
  }

  return json({
    passages: response.rows.map((row) => ({
      id: String(row.id),
      reference: String(row.reference),
      text: String(row.text),
      type: "paragraph",
      verses: versesByParagraph.get(String(row.id)) ?? []
    })) satisfies BrowserPassage[],
    books: sortCanonicalBooks(booksResponse.rows.map((row) => String(row.book)))
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const ip = getClientIp(request);
  const limit = rateLimit(ip);

  if (!limit.allowed) {
    return json<ActionData>(
      {
        error: "Rate limit reached. Try again in a moment.",
        retryAfterSeconds: limit.retryAfterSeconds
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(limit.retryAfterSeconds)
        }
      }
    );
  }

  const formData = await request.formData();
  const question = String(formData.get("question") ?? "").trim();
  const selectedBooks = formData
    .getAll("books")
    .map((value) => String(value).trim())
    .filter(Boolean);
  const matchCount = Number(formData.get("matchCount") ?? 10);

  if (question.length < 3) {
    return json<ActionData>(
      { error: "Enter a longer question." },
      { status: 400 }
    );
  }

  if (question.length > 500) {
    return json<ActionData>(
      { error: "Keep the question under 500 characters." },
      { status: 400 }
    );
  }

  if (!Number.isInteger(matchCount) || matchCount < 5 || matchCount > 20) {
    return json<ActionData>(
      { error: "Choose between 5 and 20 matches." },
      { status: 400 }
    );
  }

  const booksResponse = await getDb().execute("SELECT book FROM passages GROUP BY book");
  const indexedBooks = new Set(booksResponse.rows.map((row) => String(row.book)));
  const books = Array.from(new Set(selectedBooks)).filter((book) => indexedBooks.has(book));

  if (selectedBooks.length > 0 && books.length === 0) {
    return json<ActionData>(
      { error: "Choose at least one indexed book." },
      { status: 400 }
    );
  }

  const results = withMatchStrength(await searchScripture(question, matchCount, books));
  return json<ActionData>({
    question,
    books,
    matchCount,
    results
  });
}

function sortCanonicalBooks(books: string[]) {
  return [...books].sort((left, right) => {
    const leftOrder = CANONICAL_BOOK_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = CANONICAL_BOOK_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return left.localeCompare(right);
  });
}

export default function Index() {
  const { books, passages } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submittingRef = useRef(false);
  const [exampleIndex, setExampleIndex] = useState(0);
  const isSearching = navigation.state === "submitting";
  const isSearchingAllBooks =
    isSearching && (navigation.formData?.getAll("books").length ?? 0) === 0;
  const passageMap = useMemo(
    () => new Map(passages.map((passage) => [passage.id, passage])),
    [passages]
  );

  useEffect(() => {
    if (navigation.state === "idle") {
      submittingRef.current = false;
    }
  }, [navigation.state]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setExampleIndex((index) => (index + 1) % SEARCH_EXAMPLES.length);
    }, 2800);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <main className="page-shell">
      <header className="site-header">
        <div>
          <p className="eyebrow">Cross Canon</p>
          <h1>Search Scripture by theme.</h1>
        </div>
      </header>

      <section
        className={`search-band${isSearching ? " is-searching" : ""}`}
        aria-busy={isSearching}
        aria-label="Scripture search"
      >
        <Form
          method="post"
          className="search-form"
          onSubmit={(event) => {
            if (submittingRef.current) {
              event.preventDefault();
              return;
            }

            submittingRef.current = true;
          }}
        >
          <label htmlFor="question">Search for passages about...</label>
          <div className="search-row">
            <textarea
              id="question"
              name="question"
              rows={4}
              minLength={3}
              maxLength={500}
              required
              disabled={isSearching}
              placeholder={SEARCH_EXAMPLES[exampleIndex]}
              defaultValue={actionData?.question ?? ""}
            />
            <div className="search-controls">
              <fieldset className="book-picker" disabled={isSearching}>
                <legend>Books</legend>
                <p className="book-picker-hint">Leave blank to search all indexed books.</p>
                <div className="book-options">
                  {books.map((book) => (
                    <label className="book-option" key={book}>
                      <input
                        type="checkbox"
                        name="books"
                        value={book}
                        defaultChecked={actionData?.books?.includes(book) ?? false}
                      />
                      {book}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="field-control">
                <label htmlFor="matchCount">Matches</label>
                <input
                  id="matchCount"
                  name="matchCount"
                  type="number"
                  min={5}
                  max={20}
                  step={1}
                  disabled={isSearching}
                  defaultValue={actionData?.matchCount ?? 5}
                />
              </div>
              <button className="search-button" type="submit" disabled={isSearching}>
                {isSearching ? (
                  <>
                    <span className="button-spinner" aria-hidden="true" />
                    Searching
                  </>
                ) : (
                  "Search"
                )}
              </button>
              {isSearching ? (
                <p className="search-status" role="status">
                  {isSearchingAllBooks
                    ? "Searching all indexed books. Results can take about 15 seconds..."
                    : "Searching selected books. Results can take a couple seconds..."}
                </p>
              ) : null}
            </div>
          </div>
        </Form>
      </section>

      {actionData?.error ? (
        <p className="notice" role="alert">
          {actionData.error}
          {actionData.retryAfterSeconds
            ? ` ${actionData.retryAfterSeconds} seconds remaining.`
            : ""}
        </p>
      ) : null}

      <section className="results" aria-live="polite">
        {actionData?.results?.length ? (
          actionData.results.map((result, index) => {
            const passage = passageMap.get(result.id);

            return (
              <article
                className={`scripture-result match-level-${result.matchStrength}`}
                key={`${result.id}-${index}`}
              >
                <div className="result-meta">
                  <span>{passage?.reference ?? result.reference}</span>
                  <span title="World English Bible">{TRANSLATION_ABBREVIATION}</span>
                  <span
                    className="match-dots"
                    aria-label={`${result.matchStrength} of 4 match strength`}
                    title={`${result.matchStrength} of 4 match strength`}
                  >
                    {[1, 2, 3, 4].map((level) => (
                      <span
                        aria-hidden="true"
                        className={level <= result.matchStrength ? "is-active" : undefined}
                        key={level}
                      />
                    ))}
                  </span>
                </div>
                {passage?.verses.length ? (
                  <p>
                    {passage.verses.map((verse, verseIndex) => (
                      <span
                        className={
                          result.highlightVerse === verse.number
                            ? "verse-highlight"
                            : undefined
                        }
                        key={verse.number}
                      >
                        {verse.text}
                        {verseIndex < passage.verses.length - 1 ? " " : ""}
                      </span>
                    ))}
                  </p>
                ) : (
                  <p>{passage?.text ?? "Passage text is unavailable in the browser index."}</p>
                )}
              </article>
            );
          })
        ) : (
          <div className="empty-state">
            <p>Scripture results will appear here.</p>
          </div>
        )}
      </section>
    </main>
  );
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
