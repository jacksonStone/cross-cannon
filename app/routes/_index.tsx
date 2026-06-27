import { useEffect, useMemo, useRef, useState } from "react";

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";

import { ensureDatabase, getDb } from "~/lib/db.server";
import { getClientIp, rateLimit } from "~/lib/rate-limit.server";
import { searchScripture } from "~/lib/search.server";
import { getScriptureCacheInfo, type BrowserPassage } from "~/lib/scripture-cache.server";

type ActionData = {
  error?: string;
  question?: string;
  canon?: CanonMode;
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
const DEFAULT_CANON: CanonMode = "protestant";
const DEFAULT_MATCH_COUNT = 10;
const FILTER_STORAGE_KEY = "cross-cannon:filters:v1";
type CanonMode = "protestant" | "catholic" | "orthodox";
type StoredFilters = {
  canon?: string;
  matchCount?: number;
  books?: string[];
};
const SEARCH_EXAMPLES = [
  "Hope after death",
  "greed and money problems",
  "anxiety",
  "laughing when times are hard",
  "always learning",
  "the beauty of nature"
];
const PROTESTANT_BOOKS = [
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
const CATHOLIC_DEUTEROCANONICAL_BOOKS = [
  "Tobit",
  "Judith",
  "Wisdom",
  "Sirach",
  "Baruch",
  "Daniel (Greek)",
  "Esther (Greek)",
  "1 Maccabees",
  "2 Maccabees"
];
const CATHOLIC_BOOKS = [
  ...PROTESTANT_BOOKS,
  ...CATHOLIC_DEUTEROCANONICAL_BOOKS
];
const ORTHODOX_ADDITIONAL_BOOKS = [
  "1 Esdras",
  "2 Esdras",
  "Prayer of Manasseh",
  "Psalm 151",
  "3 Maccabees",
  "4 Maccabees"
];
const ORTHODOX_BOOKS = [
  ...CATHOLIC_BOOKS,
  ...ORTHODOX_ADDITIONAL_BOOKS
];
const CANONICAL_BOOK_ORDER = new Map(
  [
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
    "1 Esdras",
    "2 Esdras",
    "Ezra",
    "Nehemiah",
    "Tobit",
    "Judith",
    "Esther",
    "Esther (Greek)",
    "1 Maccabees",
    "2 Maccabees",
    "3 Maccabees",
    "4 Maccabees",
    "Job",
    "Psalms",
    "Psalm 151",
    "Proverbs",
    "Ecclesiastes",
    "Song of Songs",
    "Wisdom",
    "Sirach",
    "Prayer of Manasseh",
    "Isaiah",
    "Jeremiah",
    "Lamentations",
    "Baruch",
    "Ezekiel",
    "Daniel",
    "Daniel (Greek)",
    ...PROTESTANT_BOOKS.slice(PROTESTANT_BOOKS.indexOf("Hosea"))
  ].map((book, index) => [book, index])
);
const BOOKS_BY_CANON = {
  protestant: new Set(PROTESTANT_BOOKS),
  catholic: new Set(CATHOLIC_BOOKS),
  orthodox: new Set(ORTHODOX_BOOKS)
} satisfies Record<CanonMode, Set<string>>;
const scriptureCacheLoads = new Map<string, Promise<BrowserPassage[]>>();
const scriptureCacheData = new Map<string, BrowserPassage[]>();

export async function loader({}: LoaderFunctionArgs) {
  await ensureDatabase();
  const scriptureCache = await getScriptureCacheInfo();

  const booksResponse = await getDb().execute(`
    SELECT book
    FROM passages
    GROUP BY book
    ORDER BY MIN(rowid)
  `);

  return json({
    books: sortCanonicalBooks(booksResponse.rows.map((row) => String(row.book))),
    scriptureCacheKey: scriptureCache.version,
    scriptureCacheUrl: scriptureCache.url
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
  const canon = parseCanonMode(String(formData.get("canon") ?? ""));
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

  if (!Number.isInteger(matchCount) || matchCount < 5 || matchCount > 40) {
    return json<ActionData>(
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
    return json<ActionData>(
      { error: "Choose at least one indexed book in the selected canon." },
      { status: 400 }
    );
  }

  const searchBooks = books.length > 0
    ? books
    : Array.from(canonBooks).filter((book) => indexedBooks.has(book));
  const results = withMatchStrength(await searchScripture(question, matchCount, searchBooks));
  return json<ActionData>({
    question,
    canon,
    books,
    matchCount,
    results
  });
}

function parseCanonMode(value: string): CanonMode {
  if (value === "catholic" || value === "orthodox") {
    return value;
  }

  return "protestant";
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
  const { books, scriptureCacheKey, scriptureCacheUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submittingRef = useRef(false);
  const [exampleIndex, setExampleIndex] = useState(0);
  const [canon, setCanon] = useState<CanonMode>(actionData?.canon ?? DEFAULT_CANON);
  const [matchCount, setMatchCount] = useState(actionData?.matchCount ?? DEFAULT_MATCH_COUNT);
  const [selectedBooks, setSelectedBooks] = useState<string[]>(() => actionData?.books ?? []);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [hasLoadedStoredFilters, setHasLoadedStoredFilters] = useState(false);
  const [passages, setPassages] = useState<BrowserPassage[]>([]);
  const [isScriptureReady, setIsScriptureReady] = useState(false);
  const isSearching = navigation.state === "submitting";
  const isSearchingAllBooks =
    isSearching && (navigation.formData?.getAll("books").length ?? 0) === 0;
  const passageMap = useMemo(
    () => new Map(passages.map((passage) => [passage.id, passage])),
    [passages]
  );
  const visibleBooks = useMemo(
    () => books.filter((book) => BOOKS_BY_CANON[canon].has(book)),
    [books, canon]
  );
  const selectedBooksForCanon = useMemo(
    () => selectedBooks.filter((book) => BOOKS_BY_CANON[canon].has(book)),
    [canon, selectedBooks]
  );
  const activeFilterCount = (matchCount === DEFAULT_MATCH_COUNT ? 0 : 1)
    + selectedBooksForCanon.length;

  useEffect(() => {
    if (navigation.state === "idle") {
      submittingRef.current = false;
    }
  }, [navigation.state]);

  useEffect(() => {
    if (hasLoadedStoredFilters) {
      return;
    }

    if (actionData) {
      setHasLoadedStoredFilters(true);
      return;
    }

    try {
      const rawFilters = window.localStorage.getItem(FILTER_STORAGE_KEY);

      if (!rawFilters) {
        setHasLoadedStoredFilters(true);
        return;
      }

      const parsedFilters = JSON.parse(rawFilters) as StoredFilters;
      const storedCanon = parseCanonMode(String(parsedFilters.canon ?? ""));
      const storedMatchCount = parsedFilters.matchCount;
      const indexedBooks = new Set(books);

      setCanon(storedCanon);

      if (
        typeof storedMatchCount === "number"
        && Number.isInteger(storedMatchCount)
        && storedMatchCount >= 5
        && storedMatchCount <= 40
      ) {
        setMatchCount(storedMatchCount);
      }

      if (Array.isArray(parsedFilters.books)) {
        setSelectedBooks(
          parsedFilters.books
            .map((book) => String(book))
            .filter((book) => indexedBooks.has(book) && BOOKS_BY_CANON[storedCanon].has(book))
        );
      }
    } catch {
      window.localStorage.removeItem(FILTER_STORAGE_KEY);
    } finally {
      setHasLoadedStoredFilters(true);
    }
  }, [actionData, books, hasLoadedStoredFilters]);

  useEffect(() => {
    if (!hasLoadedStoredFilters) {
      return;
    }

    const filters = {
      canon,
      matchCount,
      books: selectedBooksForCanon
    } satisfies StoredFilters;

    window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
  }, [canon, hasLoadedStoredFilters, matchCount, selectedBooksForCanon]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setExampleIndex((index) => (index + 1) % SEARCH_EXAMPLES.length);
    }, 2800);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let ignore = false;

    setIsScriptureReady(false);
    loadScriptureCache(scriptureCacheUrl)
      .then((loadedPassages) => {
        if (!ignore) {
          setPassages(loadedPassages);
          setIsScriptureReady(true);
        }
      })
      .catch(() => {
        if (!ignore) {
          setPassages([]);
          setIsScriptureReady(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [scriptureCacheUrl]);

  useEffect(() => {
    if (!isFilterModalOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFilterModalOpen(false);
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isFilterModalOpen]);

  function updateCanon(nextCanon: CanonMode) {
    setCanon(nextCanon);
    setSelectedBooks((currentBooks) =>
      currentBooks.filter((book) => BOOKS_BY_CANON[nextCanon].has(book))
    );
  }

  function toggleSelectedBook(book: string) {
    setSelectedBooks((currentBooks) =>
      currentBooks.includes(book)
        ? currentBooks.filter((selectedBook) => selectedBook !== book)
        : [...currentBooks, book]
    );
  }

  function clearFilters() {
    setMatchCount(DEFAULT_MATCH_COUNT);
    setSelectedBooks([]);
  }

  return (
    <main className="page-shell">
      <data value={scriptureCacheKey} data-scripture-cache-key hidden />
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
          <input type="hidden" name="canon" value={canon} />
          <input type="hidden" name="matchCount" value={matchCount} />
          {selectedBooksForCanon.map((book) => (
            <input key={book} type="hidden" name="books" value={book} />
          ))}
          <div className="search-row">
            <div className="search-primary">
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
            </div>
            <div className="search-actions">
              <button
                aria-expanded={isFilterModalOpen}
                aria-controls="filter-modal"
                className={`filter-toggle${activeFilterCount > 0 ? " is-active" : ""}`}
                disabled={isSearching}
                onClick={() => setIsFilterModalOpen(true)}
                type="button"
              >
                Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
              </button>
              <button
                className="search-button"
                type="submit"
                disabled={isSearching || !isScriptureReady}
              >
                {isSearching ? (
                  <>
                    <span className="button-spinner" aria-hidden="true" />
                    Searching
                  </>
                ) : !isScriptureReady ? (
                  "Loading text"
                ) : (
                  "Search"
                )}
              </button>
              {isSearching ? (
                <p className="search-status" role="status">
                  {isSearchingAllBooks
                    ? "Searching the selected canon..."
                    : "Searching selected books..."}
                </p>
              ) : !isScriptureReady ? (
                <p className="search-status" role="status">
                  Loading scripture text...
                </p>
              ) : null}
            </div>
          </div>
          {isFilterModalOpen ? (
            <div
              className="filter-modal-backdrop"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setIsFilterModalOpen(false);
                }
              }}
            >
              <section
                aria-labelledby="filter-modal-title"
                aria-modal="true"
                className="filter-modal"
                id="filter-modal"
                role="dialog"
              >
                <div className="filter-modal-header">
                  <h2 id="filter-modal-title">Filters</h2>
                  <button
                    className="filter-modal-close"
                    onClick={() => setIsFilterModalOpen(false)}
                    type="button"
                  >
                    Close
                  </button>
                </div>
                <div className="filter-modal-body">
                  <fieldset className="canon-control" disabled={isSearching}>
                    <legend>Canon</legend>
                    <select
                      aria-label="Canon"
                      onChange={(event) => updateCanon(parseCanonMode(event.currentTarget.value))}
                      value={canon}
                    >
                      <option value="protestant">Protestant</option>
                      <option value="catholic">Catholic</option>
                      <option value="orthodox">Orthodox</option>
                    </select>
                  </fieldset>
                  <fieldset className="match-control" disabled={isSearching}>
                    <legend>Matches</legend>
                    <input
                      aria-label="Matches"
                      type="number"
                      min={5}
                      max={40}
                      step={1}
                      value={matchCount}
                      onChange={(event) => setMatchCount(Number(event.currentTarget.value))}
                    />
                  </fieldset>
                  <fieldset className="book-picker" disabled={isSearching}>
                    <legend>Books</legend>
                    <p className="book-picker-hint">Leave blank to search every book in this canon.</p>
                    <div className="book-options">
                      {visibleBooks.map((book) => (
                        <label className="book-option" key={book}>
                          <input
                            type="checkbox"
                            value={book}
                            checked={selectedBooksForCanon.includes(book)}
                            onChange={() => toggleSelectedBook(book)}
                          />
                          {book}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>
                <div className="filter-modal-actions">
                  <button className="secondary-button" onClick={clearFilters} type="button">
                    Clear all
                  </button>
                  <button onClick={() => setIsFilterModalOpen(false)} type="button">
                    Done
                  </button>
                </div>
              </section>
            </div>
          ) : null}
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
                  <p>{passage?.text ?? "Passage text is loading."}</p>
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

      <footer className="source-note">
        Indexed text: Protestant, Catholic, and Orthodox canons of the World English Bible (WEB).
        Protestant search is the default.{" "}
        <a href="https://worldenglish.bible/" rel="noreferrer" target="_blank">
          Read the WEB
        </a>
        .
      </footer>
    </main>
  );
}

function loadScriptureCache(scriptureCacheUrl: string) {
  const cachedPassages = scriptureCacheData.get(scriptureCacheUrl);

  if (cachedPassages) {
    return Promise.resolve(cachedPassages);
  }

  const existingLoad = scriptureCacheLoads.get(scriptureCacheUrl);

  if (existingLoad) {
    return existingLoad;
  }

  const load = fetch(scriptureCacheUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load scripture cache: ${response.status}`);
      }

      return response.json() as Promise<{ passages: BrowserPassage[] }>;
    })
    .then((data) => {
      scriptureCacheData.set(scriptureCacheUrl, data.passages);
      return data.passages;
    })
    .catch((error) => {
      scriptureCacheLoads.delete(scriptureCacheUrl);
      throw error;
    });

  scriptureCacheLoads.set(scriptureCacheUrl, load);
  return load;
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
