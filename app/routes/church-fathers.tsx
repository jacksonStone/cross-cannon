import { useEffect, useMemo, useState } from "react";

import type { MetaFunction } from "@remix-run/node";

const MANIFEST_URL = "/church-fathers-preview/manifest.json";
const STATUS_FILTERS = ["all", "orthodox", "noncanonical"] as const;

type WorkClassification = {
  bucket: string;
  canonicalStatus: string;
  contentKind: string;
  cautionReason: string;
  doctrinalStatus: string;
  labels: string[];
  severity: number;
};

type SourceMetadata = {
  id: string;
  provider: string;
  sourceUrl: string;
  title: string;
};

type WorkMetadata = {
  author: string | null;
  authorshipDateRange: string | null;
  ccel: {
    id: string;
    sourceUrl: string;
    title: string;
  };
  source: SourceMetadata;
};

type ChapterSummary = {
  assetPath: string;
  chapter: number;
  id: string;
  title: string;
  verseCount: number;
};

type BookSummary = {
  author: string | null;
  book: string;
  chapters: ChapterSummary[];
  classification: WorkClassification;
  id: string;
  metadata: WorkMetadata;
  name: string;
};

type BookIndex = {
  books: BookSummary[];
  generatedAt: string;
  source: string;
};

type PreviewManifest = {
  bookCount: number;
  bookIndexPath: string;
  chapterCount: number;
  classificationCounts: Record<string, number>;
  contentKindCounts: Record<string, number>;
  generatedAt: string;
  source: string;
};

type ChapterAsset = {
  author: string | null;
  book: string;
  chapter: number;
  classification: WorkClassification;
  id: string;
  lineage: string[];
  metadata: WorkMetadata;
  originalBook: string | null;
  sourceVolumeId: string;
  title: string;
  source: {
    id: string;
    sourceUrl: string;
    title: string;
  };
  verses: Array<{
    book: string;
    chapter: number;
    verse: number;
    text: string;
  }>;
};

type Selection = {
  bookId: string;
  chapterId: string;
};

type StatusFilter = (typeof STATUS_FILTERS)[number];

export const meta: MetaFunction = () => [
  { title: "Church Fathers Preview | Cross Canon" },
  {
    name: "description",
    content: "Preview parsed public-domain Church Fathers texts."
  }
];

export default function ChurchFathersPreview() {
  const [manifest, setManifest] = useState<PreviewManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [bookIndex, setBookIndex] = useState<BookIndex | null>(null);
  const [bookIndexError, setBookIndexError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(readInitialSelection());
  const [chapter, setChapter] = useState<ChapterAsset | null>(null);
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [bookQuery, setBookQuery] = useState("");
  const [chapterQuery, setChapterQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showJson, setShowJson] = useState(false);

  useEffect(() => {
    let ignore = false;

    fetch(MANIFEST_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load manifest: ${response.status}`);
        }

        return response.json() as Promise<PreviewManifest>;
      })
      .then((loadedManifest) => {
        if (!ignore) {
          setManifest(loadedManifest);
        }
      })
      .catch((error: unknown) => {
        if (!ignore) {
          setManifestError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!manifest) {
      return;
    }

    let ignore = false;
    setBookIndex(null);
    setBookIndexError(null);

    fetch(manifest.bookIndexPath)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load book index: ${response.status}`);
        }

        return response.json() as Promise<BookIndex>;
      })
      .then((loadedIndex) => {
        if (!ignore) {
          setBookIndex(loadedIndex);
        }
      })
      .catch((error: unknown) => {
        if (!ignore) {
          setBookIndexError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      ignore = true;
    };
  }, [manifest?.bookIndexPath]);

  const selectedBook = useMemo(
    () => findById(bookIndex?.books ?? [], selection.bookId) ?? bookIndex?.books[0],
    [bookIndex?.books, selection.bookId]
  );
  const selectedChapter = useMemo(
    () => findById(selectedBook?.chapters ?? [], selection.chapterId) ?? selectedBook?.chapters[0],
    [selectedBook?.chapters, selection.chapterId]
  );
  const filteredBooks = useMemo(
    () => (bookIndex?.books ?? []).filter((book) => {
      const matchesStatus = statusFilter === "all" || book.classification.doctrinalStatus === statusFilter;
      return matchesStatus && bookMatchesQuery(book, bookQuery);
    }),
    [bookIndex?.books, bookQuery, statusFilter]
  );
  const filteredChapters = useMemo(
    () => (selectedBook?.chapters ?? []).filter((chapterOption) => chapterMatchesQuery(chapterOption, chapterQuery)),
    [chapterQuery, selectedBook?.chapters]
  );
  const previousChapter = useMemo(
    () => previousChapterFromBook(selectedBook, selectedChapter),
    [selectedBook, selectedChapter]
  );
  const nextChapter = useMemo(
    () => nextChapterFromBook(selectedBook, selectedChapter),
    [selectedBook, selectedChapter]
  );

  useEffect(() => {
    if (!selectedChapter) {
      setChapter(null);
      return;
    }

    let ignore = false;
    setChapter(null);
    setChapterError(null);

    fetch(selectedChapter.assetPath)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load chapter: ${response.status}`);
        }

        return response.json() as Promise<ChapterAsset>;
      })
      .then((loadedChapter) => {
        if (!ignore) {
          setChapter(loadedChapter);
        }
      })
      .catch((error: unknown) => {
        if (!ignore) {
          setChapterError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      ignore = true;
    };
  }, [selectedChapter?.assetPath]);

  function updateSelection(nextSelection: Selection) {
    setShowJson(false);
    setSelection(nextSelection);
    const params = new URLSearchParams();
    if (nextSelection.bookId) {
      params.set("book", nextSelection.bookId);
    }
    if (nextSelection.chapterId) {
      params.set("chapter", nextSelection.chapterId);
    }
    window.history.replaceState(null, "", `/church-fathers?${params.toString()}`);
  }

  function openChapter(chapterOption: ChapterSummary) {
    if (!selectedBook) {
      return;
    }

    updateSelection({
      bookId: selectedBook.id,
      chapterId: chapterOption.id
    });
  }

  function openBook(book: BookSummary) {
    const nextChapter = book.chapters[0];

    if (nextChapter) {
      setChapterQuery("");
      updateSelection({
        bookId: book.id,
        chapterId: nextChapter.id
      });
    }
  }

  function openRandomChapter() {
    const books = filteredBooks.length ? filteredBooks : bookIndex?.books ?? [];
    const book = books[Math.floor(Math.random() * books.length)];
    const randomChapter = book?.chapters[Math.floor(Math.random() * book.chapters.length)];

    if (book && randomChapter) {
      updateSelection({
        bookId: book.id,
        chapterId: randomChapter.id
      });
    }
  }

  if (manifestError || bookIndexError) {
    return (
      <main className="fathers-preview">
        <section className="fathers-error" role="alert">
          <h1>Church Fathers preview unavailable</h1>
          <p>{manifestError ?? bookIndexError}</p>
          <p>Run `npm run build:church-fathers-preview` to generate static assets.</p>
        </section>
      </main>
    );
  }

  if (!manifest || !bookIndex || !selectedBook || !selectedChapter) {
    return (
      <main className="fathers-preview">
        <section className="fathers-loading" aria-busy="true">
          <h1>Loading Church Fathers preview</h1>
        </section>
      </main>
    );
  }

  return (
    <main className="fathers-preview">
      <header className="fathers-preview-header">
        <div>
          <p className="eyebrow">Preview</p>
          <h1>Church Fathers playground</h1>
          <div className="fathers-stat-row" aria-label="Corpus summary">
            <span>{formatCount(manifest.bookCount)} works</span>
            <span>{formatCount(manifest.chapterCount)} chapters</span>
            <span>{formatGeneratedAt(manifest.generatedAt)}</span>
            <span>{manifest.source}</span>
          </div>
        </div>
        <a className="context-button" href={selectedBook.metadata.source.sourceUrl}>
          Source XML
        </a>
      </header>

      <section className="fathers-picker" aria-label="Church Fathers controls">
        <form
          className="fathers-picker-form fathers-picker-form-flat"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            updateSelection({
              bookId: String(formData.get("book")),
              chapterId: String(formData.get("chapter"))
            });
          }}
        >
          <label>
            <span>Status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            >
              {STATUS_FILTERS.map((status) => (
                <option key={status} value={status}>
                  {status === "all" ? "All included" : status}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Work</span>
            <select
              name="book"
              value={selectedBook.id}
              onChange={(event) => {
                const nextBook = findById(bookIndex.books, event.target.value);

                if (nextBook) {
                  openBook(nextBook);
                }
              }}
            >
              {bookIndex.books.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.name}{book.author ? ` - ${book.author}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Chapter</span>
            <select name="chapter" value={selectedChapter.id} onChange={(event) => {
              updateSelection({
                bookId: selectedBook.id,
                chapterId: event.target.value
              });
            }}>
              {selectedBook.chapters.map((chapterOption) => (
                <option key={chapterOption.id} value={chapterOption.id}>
                  {chapterLabel(chapterOption)}
                </option>
              ))}
            </select>
          </label>
          <button className="context-button" type="submit">
            Open
          </button>
        </form>
        <div className="fathers-search-row">
          <label>
            <span>Works</span>
            <input
              placeholder="Augustine, Clement, homilies..."
              type="search"
              value={bookQuery}
              onChange={(event) => setBookQuery(event.target.value)}
            />
          </label>
          <label>
            <span>Chapters</span>
            <input
              placeholder="Trinity, resurrection, repentance..."
              type="search"
              value={chapterQuery}
              onChange={(event) => setChapterQuery(event.target.value)}
            />
          </label>
          <button className="context-button" onClick={openRandomChapter} type="button">
            Random
          </button>
        </div>
      </section>

      <div className="fathers-preview-layout">
        <aside className="fathers-sidebar" aria-label="Church Fathers work navigation">
          <section>
            <h2>Works</h2>
            <p className="fathers-sidebar-meta">
              {filteredBooks.length} of {bookIndex.books.length} works
            </p>
            <ol className="fathers-work-list">
              {filteredBooks.map((book) => (
                <li key={book.id}>
                  <button
                    className={book.id === selectedBook.id ? "is-active" : undefined}
                    onClick={() => openBook(book)}
                    type="button"
                  >
                    <span>{book.name}</span>
                    <small>
                      {book.author ? `${book.author} - ` : ""}
                      {book.metadata.authorshipDateRange ? `${book.metadata.authorshipDateRange} - ` : ""}
                      {book.classification.doctrinalStatus} - {book.chapters.length} chapters
                    </small>
                  </button>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h2>Chapters</h2>
            <p className="fathers-sidebar-meta">
              {filteredChapters.length} of {selectedBook.chapters.length} chapters
            </p>
            <ol className="fathers-chapter-list">
              {filteredChapters.map((chapterOption) => (
                <li key={chapterOption.id}>
                  <button
                    className={chapterOption.id === selectedChapter.id ? "is-active" : undefined}
                    onClick={() => openChapter(chapterOption)}
                    type="button"
                  >
                    <span>{chapterOption.chapter}. {chapterOption.title}</span>
                    <small>{chapterOption.verseCount} sentences</small>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        </aside>

        <article className="fathers-reader">
          {chapterError ? (
            <section className="fathers-error" role="alert">
              <h2>Chapter unavailable</h2>
              <p>{chapterError}</p>
            </section>
          ) : !chapter ? (
            <section className="fathers-loading" aria-busy="true">
              <h2>Loading chapter</h2>
            </section>
          ) : (
            <>
              <header>
                <p className="eyebrow">{chapter.metadata.source.provider}</p>
                <h2>{chapter.book}</h2>
                <ClassificationNotice classification={chapter.classification} />
                <dl className="fathers-metadata">
                  {chapter.metadata.author ? (
                    <>
                      <dt>Author</dt>
                      <dd>{chapter.metadata.author}</dd>
                    </>
                  ) : null}
                  {chapter.metadata.authorshipDateRange ? (
                    <>
                      <dt>Date hint</dt>
                      <dd>{chapter.metadata.authorshipDateRange}</dd>
                    </>
                  ) : null}
                  <dt>Source</dt>
                  <dd>
                    <a href={chapter.metadata.ccel.sourceUrl}>
                      {chapter.metadata.ccel.id.toUpperCase()} - {chapter.metadata.ccel.title}
                    </a>
                  </dd>
                </dl>
                {chapter.originalBook ? (
                  <p className="fathers-book-label">{chapter.originalBook}</p>
                ) : null}
                <h3>{chapter.chapter}. {chapter.title}</h3>
                <div className="fathers-reader-actions" aria-label="Reader actions">
                  <button
                    className="context-button"
                    disabled={!previousChapter}
                    onClick={() => previousChapter ? openChapter(previousChapter) : undefined}
                    type="button"
                  >
                    Previous
                  </button>
                  <button
                    className="context-button"
                    disabled={!nextChapter}
                    onClick={() => nextChapter ? openChapter(nextChapter) : undefined}
                    type="button"
                  >
                    Next
                  </button>
                  <button
                    className="context-button"
                    onClick={() => setShowJson((current) => !current)}
                    type="button"
                  >
                    JSON
                  </button>
                  <a className="context-button" href={selectedChapter.assetPath}>
                    Raw asset
                  </a>
                </div>
              </header>

              {showJson ? (
                <pre className="fathers-json-preview">
                  {JSON.stringify(chapter, null, 2)}
                </pre>
              ) : (
                <ol className="fathers-verses">
                  {chapter.verses.map((verse) => (
                    <li key={verse.verse}>
                      <span className="fathers-verse-number">{verse.verse}</span>
                      <span>{verse.text}</span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </article>
      </div>
    </main>
  );
}

function ClassificationNotice({ classification }: { classification: WorkClassification }) {
  return (
    <section className={`fathers-classification ${statusClass(classification.doctrinalStatus)}`}>
      <div className="fathers-classification-header">
        <span>{classification.bucket}</span>
        <span>{classification.canonicalStatus}</span>
      </div>
      <p>{classification.cautionReason}</p>
      <div className="fathers-labels" aria-label="Classification labels">
        {classification.labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </section>
  );
}

function readInitialSelection(): Selection {
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);

  return {
    bookId: params.get("book") ?? params.get("work") ?? "",
    chapterId: params.get("chapter") ?? ""
  };
}

function findById<T extends { id: string }>(items: T[], id: string | null) {
  return id ? items.find((item) => item.id === id) : undefined;
}

function chapterLabel(chapter: ChapterSummary) {
  return `${chapter.chapter}. ${chapter.title}`;
}

function bookMatchesQuery(book: BookSummary, query: string) {
  const normalizedQuery = normalizeQuery(query);

  if (!normalizedQuery) {
    return true;
  }

  return normalizeQuery([
    book.author,
    book.name,
    book.book,
    book.metadata.authorshipDateRange,
    book.metadata.source.id,
    book.metadata.source.title,
    book.classification.bucket,
    book.classification.doctrinalStatus
  ].filter(Boolean).join(" ")).includes(normalizedQuery);
}

function chapterMatchesQuery(chapter: ChapterSummary, query: string) {
  const normalizedQuery = normalizeQuery(query);

  if (!normalizedQuery) {
    return true;
  }

  return normalizeQuery(chapter.title).includes(normalizedQuery);
}

function previousChapterFromBook(book: BookSummary | undefined, chapter: ChapterSummary | undefined) {
  if (!book || !chapter) {
    return undefined;
  }

  const currentIndex = book.chapters.findIndex((chapterOption) => chapterOption.id === chapter.id);
  return currentIndex > 0 ? book.chapters[currentIndex - 1] : undefined;
}

function nextChapterFromBook(book: BookSummary | undefined, chapter: ChapterSummary | undefined) {
  if (!book || !chapter) {
    return undefined;
  }

  const currentIndex = book.chapters.findIndex((chapterOption) => chapterOption.id === chapter.id);
  return currentIndex >= 0 ? book.chapters[currentIndex + 1] : undefined;
}

function normalizeQuery(value: string) {
  return value.trim().toLowerCase();
}

function formatCount(value: number) {
  return value.toLocaleString();
}

function formatGeneratedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function statusClass(status: string) {
  return `is-${status.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
}
