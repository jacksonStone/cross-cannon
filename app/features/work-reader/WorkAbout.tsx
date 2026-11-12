import { useEffect, useRef, useState } from "react";
import type { BookSummary } from "~/features/early-christian-reader/types";

export function WorkAbout({ work }: { work: BookSummary }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  return (
    <div className="work-edition-context">
      <span>{work.author}</span>
      <span>
        {[work.metadata.tradition, work.metadata.genre]
          .filter(Boolean)
          .join(" · ")}
      </span>
      <button
        type="button"
        className="work-about-trigger"
        onClick={() => setOpen(true)}
      >
        About this edition ↗
      </button>
      {open && (
        <dialog
          ref={dialog}
          className="work-about-dialog"
          aria-labelledby="work-about-title"
          onCancel={() => setOpen(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <header>
            <h2 id="work-about-title">{work.name}</h2>
            <button
              type="button"
              aria-label="Close edition details"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>
          <dl>
            {[
              ["Author", work.author],
              ["Written", work.metadata.authorshipDateRange],
              ["Tradition", work.metadata.tradition],
              ["Translator", work.metadata.translator],
              ["Edition", work.metadata.edition],
              ["Rights", work.metadata.rights],
            ]
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
          <a
            href={work.metadata.source.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            View source edition ↗
          </a>
        </dialog>
      )}
    </div>
  );
}
