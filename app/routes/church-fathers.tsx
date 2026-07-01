import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";

import {
  searchEarlyChristianWorks,
  searchSimilarEarlyChristianPassages,
  type EarlyChristianSearchResult,
  type EarlyChristianSimilarSource
} from "~/lib/early-christian-search.server";
import { getClientIp, rateLimit } from "~/lib/rate-limit.server";
import { useModalScrollLock } from "~/lib/use-modal-scroll-lock";

const MANIFEST_URL = "/church-fathers-preview/manifest.json";
const PREVIEW_ASSET_VERSION = "early-christian-preview-20260701b";
const READER_POSITION_STORAGE_KEY = "cross-cannon:church-fathers-position:v1";
const READER_SETTINGS_STORAGE_KEY = "cross-cannon:reader-settings:v1";
const READER_THEMES = ["paper", "sepia", "dark", "contrast"] as const;
const CHAPTER_WINDOW_BEFORE = 5;
const CHAPTER_WINDOW_AFTER = 10;
const HEADER_SCROLL_OFFSET = 118;
const READING_ANCHOR_RATIO = 0.38;
const SEARCH_EXAMPLES = [
  "repentance and mercy",
  "the resurrection of the body",
  "patience in suffering",
  "the unity of the church",
  "the incarnation",
  "prayer and fasting"
];

type ReaderTheme = typeof READER_THEMES[number];

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

type ChapterEntry = {
  book: BookSummary;
  chapter: ChapterSummary;
  index: number;
};

type ReaderPassage = {
  key: string;
  rangeLabel: string;
  reference: string;
  text: string;
  verseEnd: number;
  verseStart: number;
};

type ChurchFathersActionData = {
  error?: string;
  matchCount?: number;
  mode?: "theme" | "similar";
  question?: string;
  results?: EarlyChristianSearchResult[];
  retryAfterSeconds?: number;
  similarSource?: EarlyChristianSimilarSource;
};

export const meta: MetaFunction = () => [
  { title: "Early Christian Reader | Cross Canon" },
  {
    name: "description",
    content: "Read and search early Christian works in chapter context."
  }
];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);

  return json({
    initialChapterId: url.searchParams.get("chapter") ?? "",
    initialPassageRange: url.searchParams.get("passage") ?? "",
    manifestUrl: MANIFEST_URL,
    previewAssetVersion: PREVIEW_ASSET_VERSION
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const ip = getClientIp(request);
  const limit = rateLimit(ip);

  if (!limit.allowed) {
    return json<ChurchFathersActionData>(
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
  const intent = String(formData.get("intent") ?? "theme");
  const matchCount = parseMatchCount(formData);

  if ("response" in matchCount) {
    return matchCount.response;
  }

  if (intent === "similar-passage") {
    const sourcePassageId = String(formData.get("sourcePassageId") ?? "").trim();
    const similar = await searchSimilarEarlyChristianPassages(sourcePassageId, matchCount.value);

    if (!similar) {
      return json<ChurchFathersActionData>(
        { error: "Choose an indexed passage to search from." },
        { status: 400 }
      );
    }

    return json<ChurchFathersActionData>({
      matchCount: matchCount.value,
      mode: "similar",
      results: similar.results,
      similarSource: similar.source
    });
  }

  const question = String(formData.get("question") ?? "").trim();

  if (question.length < 3) {
    return json<ChurchFathersActionData>(
      { error: "Enter a longer question." },
      { status: 400 }
    );
  }

  if (question.length > 500) {
    return json<ChurchFathersActionData>(
      { error: "Keep the question under 500 characters." },
      { status: 400 }
    );
  }

  return json<ChurchFathersActionData>({
    matchCount: matchCount.value,
    mode: "theme",
    question,
    results: await searchEarlyChristianWorks(question, matchCount.value)
  });
}

export default function ChurchFathersReaderRoute() {
  const {
    initialChapterId,
    initialPassageRange,
    manifestUrl,
    previewAssetVersion
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [manifest, setManifest] = useState<PreviewManifest | null>(null);
  const [bookIndex, setBookIndex] = useState<BookIndex | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedChapters, setLoadedChapters] = useState<Map<string, ChapterAsset>>(() => new Map());
  const [activeChapterId, setActiveChapterId] = useState(initialChapterId);
  const [selectedPassage, setSelectedPassage] = useState(initialPassageRange);
  const [focusedPassageKey, setFocusedPassageKey] = useState<string | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>("paper");
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [isJumpOpen, setIsJumpOpen] = useState(false);
  const [exampleIndex, setExampleIndex] = useState(0);
  const hasScrolledToSelectionRef = useRef(false);
  const lastReportedChapterIdRef = useRef("");

  useModalScrollLock(isSearchOpen || isJumpOpen);

  const chapters = useMemo(() => flattenChapters(bookIndex), [bookIndex]);
  const chapterById = useMemo(
    () => new Map(chapters.map((entry) => [entry.chapter.id, entry])),
    [chapters]
  );
  const activeEntry = activeChapterId ? chapterById.get(activeChapterId) : undefined;
  const activeIndex = activeEntry?.index ?? 0;
  const renderedEntries = useMemo(
    () => chapters.slice(
      Math.max(0, activeIndex - CHAPTER_WINDOW_BEFORE),
      Math.min(chapters.length, activeIndex + CHAPTER_WINDOW_AFTER + 1)
    ),
    [activeIndex, chapters]
  );
  const isReady = Boolean(bookIndex && activeEntry);
  const focusedPassage = focusedPassageKey
    ? findLoadedPassage(loadedChapters, focusedPassageKey)
    : null;
  const isSearching = navigation.state === "submitting";

  useEffect(() => {
    setReaderTheme(readSavedReaderTheme());
  }, []);

  useEffect(() => {
    let ignore = false;

    fetch(versionedPreviewUrl(manifestUrl, previewAssetVersion), { cache: "no-store" })
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
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      ignore = true;
    };
  }, [manifestUrl, previewAssetVersion]);

  useEffect(() => {
    if (!manifest) {
      return;
    }

    let ignore = false;

    fetch(versionedPreviewUrl(manifest.bookIndexPath, previewAssetVersion), { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load work index: ${response.status}`);
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
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      ignore = true;
    };
  }, [manifest?.bookIndexPath, previewAssetVersion]);

  useEffect(() => {
    if (!bookIndex) {
      return;
    }

    if (activeChapterId && chapterById.has(activeChapterId)) {
      return;
    }

    const rememberedChapterId = window.localStorage.getItem(READER_POSITION_STORAGE_KEY);
    const rememberedChapter = rememberedChapterId ? chapterById.get(rememberedChapterId) : undefined;
    const nextChapterId = rememberedChapter?.chapter.id ?? chapters[0]?.chapter.id ?? "";

    if (!nextChapterId) {
      return;
    }

    setActiveChapterId(nextChapterId);
    setSelectedPassage("");
    hasScrolledToSelectionRef.current = false;
    updateUrl(nextChapterId, "");
  }, [activeChapterId, bookIndex, chapterById, chapters]);

  useEffect(() => {
    if (!bookIndex || renderedEntries.length === 0) {
      return;
    }

    let ignore = false;
    const missingEntries = renderedEntries.filter((entry) => !loadedChapters.has(entry.chapter.id));

    if (missingEntries.length === 0) {
      return;
    }

    Promise.all(
      missingEntries.map((entry) => fetch(
        versionedPreviewUrl(entry.chapter.assetPath, previewAssetVersion),
        { cache: "no-store" }
      )
        .then((response) => {
          if (!response.ok) {
            return null;
          }

          return response.json() as Promise<ChapterAsset>;
        }))
    )
      .then((assets) => {
        if (ignore) {
          return;
        }

        setLoadedChapters((current) => {
          const next = new Map(current);

          for (const asset of assets) {
            if (asset) {
              next.set(asset.id, asset);
            }
          }

          return next;
        });
      })
      .catch((error: unknown) => {
        if (!ignore) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      ignore = true;
    };
  }, [bookIndex, loadedChapters, renderedEntries]);

  useEffect(() => {
    if (!isSearchOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSearchOpen(false);
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isSearchOpen]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    let frame = 0;

    const updateLocation = () => {
      frame = 0;
      const chapterElements = [
        ...document.querySelectorAll<HTMLElement>(".ec-reader-chapter")
      ];
      const currentChapter = findElementAtReadingAnchor(chapterElements);
      const chapterId = currentChapter?.dataset.chapterId;

      if (chapterId && chapterId !== lastReportedChapterIdRef.current) {
        lastReportedChapterIdRef.current = chapterId;
        window.localStorage.setItem(READER_POSITION_STORAGE_KEY, chapterId);
        setActiveChapterId(chapterId);
        updateUrl(chapterId, selectedPassage);
      }
    };

    const scheduleUpdate = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(updateLocation);
      }
    };

    window.addEventListener("scroll", scheduleUpdate, { passive: true });

    return () => {
      window.removeEventListener("scroll", scheduleUpdate);

      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [isReady, selectedPassage]);

  useEffect(() => {
    if (!activeChapterId || hasScrolledToSelectionRef.current) {
      return;
    }

    const target = selectedPassage
      ? document.querySelector<HTMLElement>(`[data-passage-range="${cssEscape(selectedPassage)}"]`)
      : document.querySelector<HTMLElement>(`[data-chapter-id="${cssEscape(activeChapterId)}"]`);

    if (!target) {
      return;
    }

    hasScrolledToSelectionRef.current = true;
    window.scrollTo({
      behavior: "auto",
      left: 0,
      top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - HEADER_SCROLL_OFFSET)
    });
  }, [activeChapterId, loadedChapters, selectedPassage]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setExampleIndex((index) => (index + 1) % SEARCH_EXAMPLES.length);
    }, 2800);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (
      navigation.state === "submitting"
      && navigation.formData?.get("intent") === "similar-passage"
    ) {
      setFocusedPassageKey(String(navigation.formData.get("sourcePassageId") ?? ""));
      setIsSearchOpen(true);
    }
  }, [navigation.formData, navigation.state]);

  useEffect(() => {
    if (actionData?.mode === "similar" && actionData.similarSource) {
      setFocusedPassageKey(actionData.similarSource.id);
      setIsSearchOpen(true);
      return;
    }

    if (actionData?.mode === "theme") {
      setFocusedPassageKey(null);
      setIsSearchOpen(true);
    }
  }, [actionData?.mode, actionData?.similarSource?.id]);

  const openChapter = useCallback((chapterId: string, passageRange = "") => {
    if (!chapterById.has(chapterId)) {
      return;
    }

    hasScrolledToSelectionRef.current = false;
    setActiveChapterId(chapterId);
    setSelectedPassage(passageRange);
    window.localStorage.setItem(READER_POSITION_STORAGE_KEY, chapterId);
    updateUrl(chapterId, passageRange);
  }, [chapterById]);

  const openResult = useCallback((result: EarlyChristianSearchResult) => {
    const passageRange = rangeFromResult(result);

    openChapter(result.chapterId, passageRange);
    setIsSearchOpen(false);
  }, [openChapter]);

  if (loadError) {
    return (
      <main className={`reader-shell reader-theme-${readerTheme}`}>
        <section className="reader-empty" role="alert">
          <p>Early Christian reader unavailable: {loadError}</p>
        </section>
      </main>
    );
  }

  if (!bookIndex || !activeEntry) {
    return (
      <main className={`reader-shell reader-theme-${readerTheme}`}>
        <section
          aria-busy="true"
          aria-labelledby="reader-loading-title"
          className={`reader-page reader-theme-${readerTheme} reader-loading`}
          style={readerStyle()}
        >
          <header className="reader-header reader-loading-header">
            <div className="reader-header-title">
              <h1 id="reader-loading-title">Loading Early Christian Reader</h1>
            </div>
            <div className="reader-loading-meter" aria-hidden="true">
              <span />
            </div>
          </header>
        </section>
      </main>
    );
  }

  return (
    <main className={`reader-shell reader-theme-${readerTheme}`}>
      <section
        aria-labelledby="reader-title"
        className={`reader-page reader-theme-${readerTheme}`}
        style={readerStyle()}
      >
        <header className="reader-header">
          <div className="reader-header-title">
            <p className="eyebrow">Early Christian Works</p>
            <h1 id="reader-title">
              {activeEntry.book.name} {activeEntry.chapter.chapter}
            </h1>
          </div>
          {!isToolsOpen ? (
            <button
              aria-expanded={false}
              aria-label="Open reader tools"
              className="context-button reader-icon-button reader-tools-trigger"
              onClick={() => setIsToolsOpen(true)}
              title="Open reader tools"
              type="button"
            >
              ⋮
            </button>
          ) : (
            <div className="reader-header-actions">
              <button
                aria-label="Close reader tools"
                className="context-button reader-icon-button reader-tools-close"
                onClick={() => {
                  setIsToolsOpen(false);
                  setIsJumpOpen(false);
                }}
                title="Close reader tools"
                type="button"
              >
                ×
              </button>
              <button
                aria-label="Search"
                className="context-button reader-icon-button"
                onClick={() => {
                  setIsToolsOpen(false);
                  setIsSearchOpen(true);
                }}
                title="Search"
                type="button"
              >
                🔍
              </button>
              <section className="passage-jump-launcher is-inline" aria-label="Jump">
                <button
                  className="context-button"
                  onClick={() => {
                    setIsToolsOpen(false);
                    setIsJumpOpen(true);
                  }}
                  type="button"
                >
                  Jump
                </button>
              </section>
            </div>
          )}
        </header>

        <div className="reader-passages">
          {renderedEntries.map((entry) => {
            const chapter = loadedChapters.get(entry.chapter.id);

            return (
              <section
                className="reader-chapter ec-reader-chapter"
                data-chapter-id={entry.chapter.id}
                key={entry.chapter.id}
              >
                <h2 className="reader-chapter-heading">
                  {entry.book.name} {entry.chapter.chapter}
                  <span>{entry.book.author ?? entry.book.metadata.source.id.toUpperCase()}</span>
                </h2>
                {chapter ? (
                  <>
                    <p className="ec-chapter-title">{chapter.title}</p>
                    <div className="reader-chapter-passages">
                      {groupChapterPassages(chapter).map((passage) => {
                        const isSelected = selectedPassage === passage.rangeLabel;

                        return (
                          <article
                            className={[
                              "reader-passage",
                              isSelected ? "is-selected" : ""
                            ].filter(Boolean).join(" ")}
                            data-passage-key={passage.key}
                            data-passage-range={passage.rangeLabel}
                            key={passage.key}
                          >
                            <button
                              aria-expanded={isSelected}
                              className="reader-passage-button"
                              onClick={() => {
                                const nextRange = isSelected ? "" : passage.rangeLabel;
                                setSelectedPassage(nextRange);
                                updateUrl(chapter.id, nextRange);
                              }}
                              type="button"
                            >
                              <span className="reader-passage-reference">
                                {passage.rangeLabel}
                              </span>
                              <span className="reader-passage-text">
                                <span
                                  className={isSelected ? "reader-verse verse-highlight" : "reader-verse"}
                                >
                                  {passage.text}
                                </span>
                              </span>
                            </button>
                            {isSelected ? (
                              <div className="reader-passage-actions">
                                <Form method="post">
                                  <input type="hidden" name="intent" value="similar-passage" />
                                  <input type="hidden" name="sourcePassageId" value={passage.key} />
                                  <button
                                    className="context-button"
                                    disabled={isSearching}
                                    type="submit"
                                  >
                                    {isSearching ? "Finding similar" : "Similar passages"}
                                  </button>
                                </Form>
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="reader-loading-lines" aria-hidden="true">
                    <span className="reader-loading-line is-wide" />
                    <span className="reader-loading-line" />
                    <span className="reader-loading-line is-medium" />
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </section>

      {isSearchOpen ? (
        <div
          className={`search-modal-backdrop reader-theme-${readerTheme}`}
          onClick={(event) => {
            event.stopPropagation();

            if (event.target === event.currentTarget) {
              setIsSearchOpen(false);
            }
          }}
        >
          <section
            aria-labelledby="search-modal-title"
            aria-modal="true"
            className="search-modal"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="search-modal-header">
              <div>
                <p className="eyebrow">Search</p>
                <h2 id="search-modal-title">Find chapters</h2>
              </div>
              <button
                className="filter-modal-close"
                onClick={() => setIsSearchOpen(false)}
                type="button"
              >
                Close
              </button>
            </header>

            <div className="search-modal-body">
              <section
                aria-busy={isSearching}
                aria-label="Early Christian search"
                className={`search-band${isSearching ? " is-searching" : ""}`}
              >
                <Form method="post" className="search-form">
                  {focusedPassageKey ? (
                    <>
                      <input type="hidden" name="intent" value="similar-passage" />
                      <input type="hidden" name="sourcePassageId" value={focusedPassageKey} />
                    </>
                  ) : null}
                  <input type="hidden" name="matchCount" value={actionData?.matchCount ?? 10} />
                  {!focusedPassageKey ? (
                    <label htmlFor="question">Search early Christian works for...</label>
                  ) : null}
                  <div className="search-row">
                    <div className="search-primary">
                      {focusedPassageKey ? (
                        <div className="focused-passage">
                          <button
                            aria-label="Clear similar passage"
                            className="focused-passage-clear"
                            disabled={isSearching}
                            onClick={() => setFocusedPassageKey(null)}
                            type="button"
                          >
                            &times;
                          </button>
                          <h2>
                            {actionData?.similarSource?.reference
                              ?? focusedPassage?.reference
                              ?? "Selected passage"}
                          </h2>
                          <p>
                            {actionData?.similarSource?.text
                              ?? focusedPassage?.text
                              ?? "Passage text is loading."}
                          </p>
                        </div>
                      ) : (
                        <textarea
                          defaultValue={actionData?.question ?? ""}
                          disabled={isSearching}
                          id="question"
                          maxLength={500}
                          minLength={3}
                          name="question"
                          placeholder={SEARCH_EXAMPLES[exampleIndex]}
                          required
                          rows={4}
                        />
                      )}
                    </div>
                    <div className="search-actions">
                      <button
                        className="search-button"
                        disabled={isSearching || !isReady}
                        type="submit"
                      >
                        {isSearching ? (
                          <>
                            <span className="button-spinner" aria-hidden="true" />
                            Searching
                          </>
                        ) : focusedPassageKey ? (
                          "Find similar"
                        ) : (
                          "Search"
                        )}
                      </button>
                      {isSearching ? (
                        <p className="search-status" role="status">
                          Searching early Christian works...
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

              <EarlyChristianSearchResults
                isSearching={isSearching}
                onOpenResult={openResult}
                results={actionData?.results}
              />
            </div>
          </section>
        </div>
      ) : null}

      {isJumpOpen ? (
        <ChapterJump
          activeChapterId={activeEntry.chapter.id}
          chapters={chapters}
          onClose={() => setIsJumpOpen(false)}
          onJump={(chapterId) => {
            setIsJumpOpen(false);
            openChapter(chapterId);
          }}
        />
      ) : null}
    </main>
  );
}

function EarlyChristianSearchResults({
  isSearching,
  onOpenResult,
  results
}: {
  isSearching: boolean;
  onOpenResult: (result: EarlyChristianSearchResult) => void;
  results?: EarlyChristianSearchResult[];
}) {
  const [selectedResult, setSelectedResult] = useState("");

  useEffect(() => {
    setSelectedResult("");
  }, [results]);

  return (
    <section className="results ec-results" aria-live="polite">
      {results?.length ? (
        results.map((result, index) => {
          const isSelected = selectedResult === result.chapterId;

          return (
            <article
              className={[
                "scripture-result",
                `match-level-${result.matchStrength}`,
                isSelected ? "is-selected" : ""
              ].filter(Boolean).join(" ")}
              key={`${result.chapterId}-${index}`}
            >
              <button
                aria-expanded={isSelected}
                className="scripture-result-button"
                onClick={() => setSelectedResult(isSelected ? "" : result.chapterId)}
                type="button"
              >
                <span className="result-meta">
                  <span>{result.chapterReference}</span>
                  <span>{result.author ?? result.source.toUpperCase()}</span>
                  <span
                    aria-label={`${result.matchStrength} of 4 match strength`}
                    className="match-dots"
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
                </span>
                <span className="scripture-result-text">
                  {result.highlightPassage.rangeLabel ? (
                    <>
                      <span className="result-range-label">
                        {result.highlightPassage.rangeLabel}.
                      </span>{" "}
                    </>
                  ) : null}
                  {result.highlightPassage.text}
                </span>
              </button>
              {isSelected ? (
                <div className="result-actions">
                  <button
                    className="context-button"
                    onClick={() => onOpenResult(result)}
                    type="button"
                  >
                    Jump to
                  </button>
                  <Form method="post">
                    <input type="hidden" name="intent" value="similar-passage" />
                    <input
                      type="hidden"
                      name="sourcePassageId"
                      value={result.highlightPassage.id}
                    />
                    <button
                      className="context-button"
                      disabled={isSearching}
                      type="submit"
                    >
                      {isSearching ? "Finding similar" : "Similar passages"}
                    </button>
                  </Form>
                </div>
              ) : null}
            </article>
          );
        })
      ) : (
        <div className="empty-state">
          <p>Early Christian results will appear here.</p>
        </div>
      )}
    </section>
  );
}

function ChapterJump({
  activeChapterId,
  chapters,
  onClose,
  onJump
}: {
  activeChapterId: string;
  chapters: ChapterEntry[];
  onClose: () => void;
  onJump: (chapterId: string) => void;
}) {
  const activeEntry = chapters.find((entry) => entry.chapter.id === activeChapterId)
    ?? chapters[0];
  const [selectedBookId, setSelectedBookId] = useState(activeEntry?.book.id ?? "");
  const selectedBook = chapters.find((entry) => entry.book.id === selectedBookId)?.book
    ?? activeEntry?.book;
  const bookChapters = selectedBook
    ? chapters.filter((entry) => entry.book.id === selectedBook.id)
    : [];

  useEffect(() => {
    if (activeEntry?.book.id) {
      setSelectedBookId(activeEntry.book.id);
    }
  }, [activeEntry?.book.id]);

  return (
    <div
      className="passage-jump-backdrop"
      onClick={(event) => {
        event.stopPropagation();

        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby="passage-jump-title"
        aria-modal="true"
        className="passage-jump-modal ec-jump-modal"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="passage-jump-modal-header">
          <div>
            <p className="eyebrow">Jump</p>
            <h2 id="passage-jump-title">Choose a work</h2>
          </div>
          <button className="filter-modal-close" onClick={onClose} type="button">
            Close
          </button>
        </header>

        <div className="passage-jump-modal-body">
          <label className="passage-jump-book">
            <span>Work</span>
            <select
              value={selectedBook?.id ?? ""}
              onChange={(event) => setSelectedBookId(event.target.value)}
            >
              {dedupeBooks(chapters).map((book) => (
                <option key={book.id} value={book.id}>
                  {book.name}
                </option>
              ))}
            </select>
          </label>

          <div className="passage-jump-group" aria-label="Chapter">
            <span>Chapter</span>
            <div className="passage-jump-options">
              {bookChapters.map((entry) => (
                <button
                  className={entry.chapter.id === activeChapterId ? "is-selected" : undefined}
                  key={entry.chapter.id}
                  onClick={() => onJump(entry.chapter.id)}
                  title={entry.chapter.title}
                  type="button"
                >
                  {entry.chapter.chapter}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function flattenChapters(bookIndex: BookIndex | null): ChapterEntry[] {
  if (!bookIndex) {
    return [];
  }

  const entries: ChapterEntry[] = [];

  for (const book of bookIndex.books) {
    for (const chapter of book.chapters) {
      entries.push({
        book,
        chapter,
        index: entries.length
      });
    }
  }

  return entries;
}

function groupChapterPassages(chapter: ChapterAsset): ReaderPassage[] {
  const passages: ReaderPassage[] = [];
  let current: ChapterAsset["verses"] = [];

  for (const verse of chapter.verses) {
    current.push(verse);

    if (current.length >= 3) {
      passages.push(buildReaderPassage(chapter, current));
      current = [];
    }
  }

  if (current.length > 0) {
    if (passages.length > 0 && current.length < 3) {
      const previous = passages.pop();
      const previousVerses = previous
        ? chapter.verses.filter((verse) => (
          verse.verse >= previous.verseStart && verse.verse <= previous.verseEnd
        ))
        : [];
      passages.push(buildReaderPassage(chapter, [...previousVerses, ...current]));
    } else {
      passages.push(buildReaderPassage(chapter, current));
    }
  }

  return passages;
}

function buildReaderPassage(chapter: ChapterAsset, verses: ChapterAsset["verses"]): ReaderPassage {
  const first = verses[0];
  const last = verses[verses.length - 1];
  const rangeLabel = last.verse === first.verse
    ? String(first.verse)
    : `${first.verse}-${last.verse}`;

  return {
    key: `${chapter.id}:${first.verse}-${last.verse}`,
    rangeLabel,
    reference: `${chapter.book} ${chapter.chapter}:${rangeLabel}`,
    text: verses.map((verse) => verse.text.trim()).join(" "),
    verseEnd: last.verse,
    verseStart: first.verse
  };
}

function findLoadedPassage(chapters: Map<string, ChapterAsset>, key: string) {
  const rangeMatch = key.match(/^(.+):(\d+)-(\d+)$/);

  if (!rangeMatch) {
    return null;
  }

  const [, chapterId, verseStart, verseEnd] = rangeMatch;
  const chapter = chapters.get(chapterId);

  if (!chapter) {
    return null;
  }

  return groupChapterPassages(chapter).find((passage) => (
    passage.verseStart === Number(verseStart) && passage.verseEnd === Number(verseEnd)
  )) ?? null;
}

function findElementAtReadingAnchor(elements: HTMLElement[]) {
  if (elements.length === 0) {
    return null;
  }

  const anchorY = Math.max(220, window.innerHeight * READING_ANCHOR_RATIO);
  let bestElement = elements[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const element of elements) {
    const rect = element.getBoundingClientRect();

    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      continue;
    }

    const distance = Math.abs(rect.top - anchorY);

    if (distance < bestDistance) {
      bestElement = element;
      bestDistance = distance;
    }
  }

  return bestElement;
}

function rangeFromResult(result: EarlyChristianSearchResult) {
  const start = result.highlightPassage.verseStart;
  const end = result.highlightPassage.verseEnd;

  if (!start) {
    return "";
  }

  return end && end !== start ? `${start}-${end}` : String(start);
}

function updateUrl(chapterId: string, passageRange = "") {
  const params = new URLSearchParams();

  if (chapterId) {
    params.set("chapter", chapterId);
  }

  if (passageRange) {
    params.set("passage", passageRange);
  }

  window.history.replaceState(null, "", `/church-fathers?${params.toString()}`);
}

function dedupeBooks(chapters: ChapterEntry[]) {
  const seen = new Set<string>();
  const books: BookSummary[] = [];

  for (const entry of chapters) {
    if (seen.has(entry.book.id)) {
      continue;
    }

    seen.add(entry.book.id);
    books.push(entry.book);
  }

  return books;
}

function parseMatchCount(formData: FormData):
  | { value: number }
  | { response: ReturnType<typeof json<ChurchFathersActionData>> } {
  const matchCount = Number(formData.get("matchCount") ?? 10);

  if (!Number.isInteger(matchCount) || matchCount < 5 || matchCount > 40) {
    return {
      response: json<ChurchFathersActionData>(
        { error: "Choose between 5 and 40 matches." },
        { status: 400 }
      )
    };
  }

  return { value: matchCount };
}

function versionedPreviewUrl(path: string, version: string) {
  const separator = path.includes("?") ? "&" : "?";

  return `${path}${separator}v=${encodeURIComponent(version)}`;
}

function readSavedReaderTheme(): ReaderTheme {
  if (typeof window === "undefined") {
    return "paper";
  }

  try {
    const savedSettings = window.localStorage.getItem(READER_SETTINGS_STORAGE_KEY);

    if (!savedSettings) {
      return "paper";
    }

    const parsedSettings = JSON.parse(savedSettings) as { theme?: unknown };
    return isReaderTheme(parsedSettings.theme) ? parsedSettings.theme : "paper";
  } catch {
    return "paper";
  }
}

function isReaderTheme(value: unknown): value is ReaderTheme {
  return typeof value === "string" && READER_THEMES.includes(value as ReaderTheme);
}

function readerStyle() {
  return {
    "--reader-content-width": "820px",
    "--reader-font-scale": 1,
    "--reader-line-height": 1.72
  } as CSSProperties;
}

function cssEscape(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}
