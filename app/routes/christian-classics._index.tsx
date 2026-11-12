import { json, type MetaFunction } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { useEffect, useState } from "react";
import {
  CollectionLinks,
  rememberReaderCorpus,
} from "~/features/reader-switch/ReaderCorpusSwitch";
import { readWorkIndex } from "~/features/work-reader/route.server";
import { buildEarlyChristianReaderUrl } from "~/features/reader-navigation/reader-links";
import { keywordMatches } from "~/features/search/keyword-match";
import { useStoredReaderSettings } from "~/features/reader-ui/ReaderControls";
import {
  readReaderLocation,
  type ReaderLocation,
} from "~/features/reader-position/reader-position";
import { WORK_COLLECTIONS } from "~/features/work-reader/collections";

export const meta: MetaFunction = () => [
  { title: "Christian Classics | Cross Canon" },
  {
    name: "description",
    content:
      "Read classic Christian commentary and spiritual writings, with original source editions.",
  },
];
export async function loader() {
  const { bookIndex } = await readWorkIndex("classics");
  return json({
    works: bookIndex.books.map((work) => ({
      id: work.id,
      name: work.name,
      author: work.author,
      metadata: work.metadata,
      firstChapterId: work.chapters[0].id,
      chapterCount: work.chapters.length,
    })),
  });
}
export default function ChristianClassicsLibrary() {
  const { works } = useLoaderData<typeof loader>();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All works");
  const [savedLocation, setSavedLocation] = useState<ReaderLocation | null>(
    null
  );
  const savedChapter = savedLocation?.chapterKey ?? "";
  const { readerSettings } = useStoredReaderSettings();
  useEffect(() => {
    setSavedLocation(
      readReaderLocation(
        WORK_COLLECTIONS.classics.positionStorageKey,
        "classics"
      )
    );
  }, []);
  const categories = [
    "All works",
    ...new Set(
      works.flatMap((work) =>
        work.metadata.genre ? [work.metadata.genre] : []
      )
    ),
  ];
  const visible = works.filter(
    (work) =>
      (category === "All works" || work.metadata.genre === category) &&
      (!query.trim() ||
        keywordMatches(
          query,
          `${work.name} ${work.author} ${work.metadata.tradition}`
        ))
  );
  const savedWork = works.find((work) =>
    savedChapter.startsWith(`${work.id}:`)
  );
  const featured =
    savedWork ??
    works.find((work) => work.id === "classics:imitation") ??
    works[0];
  return (
    <main
      className={`reader-shell classics-library-shell reader-theme-${readerSettings.theme}`}
    >
      <div className="classics-library">
        <header className="classics-library-header">
          <Link
            to="/?reader=scripture"
            reloadDocument
            className="classics-brand"
          >
            <span aria-hidden="true">✣</span> Cross Canon
          </Link>
          <span>A library for a life of faith</span>
        </header>
        <CollectionLinks current="classics" />
        <section className="classics-library-intro">
          <p className="collection-kicker">Read across the centuries</p>
          <h1>Christian Classics</h1>
          <p>Commentary, theology, and the life of faith.</p>
        </section>
        <div className="classics-library-controls">
          <input
            type="search"
            aria-label="Find a classic by title or author"
            placeholder="Find a work or author…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div
            className="classics-category-filters"
            aria-label="Filter works by type"
          >
            {categories.map((item) => (
              <button
                type="button"
                key={item}
                aria-pressed={category === item}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        {category === "All works" && !query && (
          <Link
            reloadDocument
            className="classics-featured"
            to={buildEarlyChristianReaderUrl(
              savedWork ? savedChapter : featured.firstChapterId,
              savedWork ? savedLocation?.passageRange : undefined
            )}
            onClick={() => rememberReaderCorpus("classics")}
          >
            <span aria-hidden="true" className="classics-book-symbol">
              {featured.id === "classics:imitation" ? "I" : featured.name[0]}
              <small>
                {featured.id === "classics:imitation" ? "CHRIST" : "CLASSICS"}
              </small>
            </span>
            <span>
              <small className="collection-kicker">
                {savedWork ? "Continue reading" : "A place to begin"}
              </small>
              <strong>{featured.name}</strong>
              <span>
                {featured.author} · {featured.metadata.genre}
              </span>
              <em>{savedWork ? "Return to your place" : "Start reading"} →</em>
            </span>
          </Link>
        )}
        <div className="classics-catalog-heading">
          <h2>
            {category === "All works" ? "Explore the collection" : category}
          </h2>
          <span>
            {visible.length} {visible.length === 1 ? "work" : "works"}
          </span>
        </div>
        <div className="classics-work-list">
          {visible.map((work) => (
            <Link
              reloadDocument
              className="classics-work-row"
              key={work.id}
              to={buildEarlyChristianReaderUrl(work.firstChapterId)}
              onClick={() => rememberReaderCorpus("classics")}
            >
              <span className="classics-work-index" aria-hidden="true">
                {String(works.indexOf(work) + 1).padStart(2, "0")}
              </span>
              <span className="classics-work-row-title">
                <strong>{work.name}</strong>
                <span>{work.author}</span>
              </span>
              <span className="classics-work-row-meta">
                {work.metadata.genre}
                <small>
                  {work.metadata.tradition} ·{" "}
                  {work.chapterCount.toLocaleString()} chapters
                </small>
              </span>
              <span aria-hidden="true">↗</span>
            </Link>
          ))}
        </div>
        {!visible.length && (
          <p className="classics-library-empty" role="status">
            No works match these filters. Try another author or title.
          </p>
        )}
        <p className="classics-library-editions">
          Historical English editions. Source and translation details are
          available inside each work.
        </p>
      </div>
    </main>
  );
}
