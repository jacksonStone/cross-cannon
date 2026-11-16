import { Link, useFetcher } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { loader } from "~/routes/api.classic-commentary";
import type { ChapterPassage } from "~/features/passage-reader/chapter-index";
import type { ChapterAsset } from "~/features/early-christian-reader/types";
import { parsePassageLocation } from "~/features/passage-reader/chapter-index";
import { loadPreviewJson } from "~/features/early-christian-preview/preview-cache";
import { renderReaderPassageText } from "~/features/early-christian-reader/reader-passages";
import { relatedCommentaryPassages } from "./commentary-passages";
import { ReaderPassageArticle } from "~/features/reader-ui/ReaderControls";
import { buildEarlyChristianReaderUrl } from "~/features/reader-navigation/reader-links";

export function PassageCommentary({
  passage,
  onClose,
}: {
  passage: ChapterPassage;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fetcher = useFetcher<typeof loader>();
  const [selectedWork, setSelectedWork] = useState("classics:henry");
  const [asset, setAsset] = useState<ChapterAsset | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const location = parsePassageLocation(passage.reference);
  const verseStart = passage.verses[0]?.number ?? 1;
  const verseEnd = passage.verses.at(-1)?.number ?? verseStart;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (location)
      fetcher.load(
        `/api/classic-commentary?book=${encodeURIComponent(
          location.book
        )}&chapter=${location.chapter}&verseStart=${verseStart}&verseEnd=${verseEnd}`
      );
  }, [location?.book, location?.chapter, verseStart, verseEnd]);
  const works = (fetcher.data?.works ?? []).filter(
    (work): work is NonNullable<typeof work> => Boolean(work)
  );
  const active = works.find((work) => work.id === selectedWork) ?? works[0];
  useEffect(() => {
    if (!active || !fetcher.data) return;
    let ignore = false;
    setAsset(null);
    setError("");
    setSelected("");
    void loadPreviewJson<ChapterAsset>(
      active.chapter.assetPath,
      fetcher.data.version
    )
      .then((chapter) => {
        if (!ignore) setAsset(chapter);
      })
      .catch(() => {
        if (!ignore)
          setError(
            "This commentary could not be loaded. Try opening the work."
          );
      });
    return () => {
      ignore = true;
    };
  }, [active?.chapter.id, fetcher.data?.version]);
  const related = useMemo(() => {
    if (!asset || !location) return [];
    const start = passage.verses[0]?.number ?? 1;
    const end = passage.verses.at(-1)?.number ?? start;
    return relatedCommentaryPassages(asset, start, end);
  }, [asset, passage, location?.book, location?.chapter]);
  return (
    <dialog
      ref={dialog}
      className="classic-commentary-dialog"
      aria-labelledby="classic-commentary-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="classic-commentary-header">
        <div>
          <p className="collection-kicker">Christian Classics</p>
          <h2 id="classic-commentary-title">Commentaries on {passage.reference}</h2>
        </div>
        <button type="button" className="context-button" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="classic-commentary-columns">
        <section
          className="classic-commentary-scripture"
          aria-label="Selected Scripture"
        >
          <h3>{passage.reference}</h3>
          <p>{passage.verses.map((verse) => verse.text).join(" ")}</p>
          <small>World English Bible · Scripture</small>
        </section>
        <section
          className="classic-commentary-notes"
          aria-label="Original commentary"
        >
          {(!fetcher.data || fetcher.state !== "idle") && (
            <p role="status">Finding commentaries…</p>
          )}
          {fetcher.data && fetcher.state === "idle" && !works.length && (
            <p>
              No commentary indexed to these verses is included in the collection yet.
            </p>
          )}
          {!!works.length && (
            <>
              <label className="classic-commentary-select">
                Commentator
                <select
                  value={active?.id}
                  onChange={(event) => setSelectedWork(event.target.value)}
                >
                  {works.map((work) => (
                    <option key={work.id} value={work.id}>
                      {work.author}
                    </option>
                  ))}
                </select>
              </label>
              <div className="classic-commentary-source">
                <h3>{active?.title}</h3>
                <p>
                  {active?.tradition} · {active?.chapter.reference}
                </p>
                <small>
                  Original commentary · passages covering the selected verses
                </small>
              </div>
              {error && <p role="alert">{error}</p>}
              {!asset && !error && <p role="status">Loading commentary…</p>}
              {asset && !related.length && (
                <p>
                  No verse-specific note is available for this selection. You
                  can read the commentary on the full chapter below.
                </p>
              )}
              {related.map((item) => (
                <ReaderPassageArticle
                  key={item.key}
                  reference={item.rangeLabel}
                  isSelected={selected === item.key}
                  onToggle={() =>
                    setSelected(selected === item.key ? "" : item.key)
                  }
                  text={renderReaderPassageText(item)}
                />
              ))}
              {active && (
                <Link
                  className="classic-commentary-open"
                  to={buildEarlyChristianReaderUrl(
                    active.chapter.id,
                    related[0]?.rangeLabel
                  )}
                  reloadDocument
                >
                  Open this commentary in its chapter →
                </Link>
              )}
            </>
          )}
          <Link
            to="/christian-classics"
            reloadDocument
            className="classic-commentary-browse"
          >
            Browse Christian Classics →
          </Link>
        </section>
      </div>
    </dialog>
  );
}
