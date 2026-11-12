import { Link } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import {
  loadPreviewJson,
  prefetchEarlyChristianPreview,
} from "~/features/early-christian-preview/preview-cache";
import type {
  BookIndex,
  BookSummary,
  PreviewManifest,
} from "~/features/early-christian-reader/types";
import { buildEarlyChristianReaderUrl } from "~/features/reader-navigation/reader-links";
import { WORK_COLLECTIONS } from "~/features/work-reader/collections";
import {
  useEscapeDismiss,
  useOutsideClickDismiss,
} from "~/lib/use-dialog-dismiss";

export const LAST_READER_STORAGE_KEY = "cross-cannon:last-reader:v1";
export type ReaderCorpus = "fathers" | "scripture" | "classics";
const COLLECTIONS = [
  {
    id: "scripture",
    label: "Scripture",
    href: "/?reader=scripture",
    mark: "✝",
  },
  {
    id: "fathers",
    label: "Early Christian Works",
    href: "/church-fathers",
    mark: "✣",
  },
  {
    id: "classics",
    label: "Christian Classics",
    href: "/christian-classics/read",
    mark: "❧",
  },
] as const;

export function CollectionLinks({ current }: { current: ReaderCorpus }) {
  return (
    <nav className="collection-links" aria-label="Reading collections">
      {COLLECTIONS.map((item) => (
        <Link
          key={item.id}
          aria-current={current === item.id ? "page" : undefined}
          reloadDocument
          to={item.href}
          onClick={() => rememberReaderCorpus(item.id)}
        >
          <span aria-hidden="true">{item.mark}</span>
          {item.label}
          {current === item.id && <span aria-hidden="true">✓</span>}
        </Link>
      ))}
    </nav>
  );
}

export function ReaderCorpusSwitch({
  current,
  inline = false,
  works,
}: {
  current: ReaderCorpus;
  inline?: boolean;
  works?: BookSummary[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loadedWorks, setLoadedWorks] = useState<BookSummary[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const currentCollection = COLLECTIONS.find(
    (collection) => collection.id === current
  )!;
  const close = () => setIsOpen(false);
  useEscapeDismiss({
    isOpen,
    onDismiss: () => {
      close();
      triggerRef.current?.focus();
    },
  });
  useOutsideClickDismiss({ isOpen, onDismiss: close, ref });
  useEffect(() => {
    if (!isOpen || works) return;
    let ignore = false;
    const collection =
      WORK_COLLECTIONS[current === "fathers" ? "fathers" : "classics"];
    void loadPreviewJson<PreviewManifest & { version?: string }>(
      collection.manifestUrl,
      collection.assetVersion
    )
      .then((manifest) =>
        loadPreviewJson<BookIndex>(
          manifest.bookIndexPath,
          manifest.version ?? collection.assetVersion
        )
      )
      .then((index) => {
        if (!ignore) setLoadedWorks(index.books);
      })
      .catch(() => undefined);
    if (current === "scripture") prefetchEarlyChristianPreview();
    return () => {
      ignore = true;
    };
  }, [isOpen, current, works]);
  const visibleWorks = (works ?? loadedWorks).filter((work) =>
    `${work.name} ${work.author ?? ""}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase())
  );
  return (
    <div
      className={`collection-menu ${inline ? "is-inline" : "is-floating"}`}
      ref={ref}
    >
      <button
        ref={triggerRef}
        type="button"
        className="collection-trigger"
        aria-label="Choose a reading collection"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span aria-hidden="true">{currentCollection.mark}</span>
        <span>{currentCollection.label}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {isOpen && (
        <section
          role="dialog"
          aria-label="Choose a reading collection"
          className="collection-popover"
        >
          <p className="collection-kicker">Your library</p>
          <CollectionLinks current={current} />
          <Link
            className="collection-browse"
            to="/christian-classics"
            reloadDocument
            onClick={close}
          >
            Browse Christian Classics →
          </Link>
          <div className="collection-find">
            <label htmlFor="collection-find-work">Find a work</label>
            <input
              id="collection-find-work"
              type="search"
              placeholder="Title or author"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="collection-work-list">
            {visibleWorks.slice(0, 16).map((work) => (
              <Link
                key={work.id}
                reloadDocument
                to={buildEarlyChristianReaderUrl(work.chapters[0]?.id ?? "")}
                onClick={() =>
                  rememberReaderCorpus(
                    work.id.startsWith("classics:") ? "classics" : "fathers"
                  )
                }
              >
                <span>{work.name}</span>
                <small>{work.author}</small>
              </Link>
            ))}
            {query && !visibleWorks.length && <p>No matching works.</p>}
          </div>
        </section>
      )}
    </div>
  );
}
export function readLastReaderCorpus(): ReaderCorpus | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(LAST_READER_STORAGE_KEY);
    return value === "fathers" || value === "scripture" || value === "classics"
      ? value
      : null;
  } catch {
    return null;
  }
}
export function rememberReaderCorpus(corpus: ReaderCorpus) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_READER_STORAGE_KEY, corpus);
  } catch {
    /* Reading still works without storage. */
  }
}
