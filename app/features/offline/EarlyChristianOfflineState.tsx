import { Link } from "@remix-run/react";

import { ReaderCorpusSwitch } from "~/features/reader-switch/ReaderCorpusSwitch";
import {
  WORK_COLLECTIONS,
  type WorkCollectionId,
} from "~/features/work-reader/collections";

export function EarlyChristianOfflineState({
  kind,
  readerTheme,
  collectionId = "fathers",
}: {
  kind: "empty" | "unavailable";
  readerTheme: string;
  collectionId?: WorkCollectionId;
}) {
  return (
    <main className={`reader-shell reader-theme-${readerTheme}`}>
      <section className="reader-empty" role="status">
        <p>
          {kind === "empty"
            ? collectionId === "classics"
              ? "No Christian Classics are available offline."
              : "No Early Christian works are available offline."
            : "This work isn’t available offline."}
        </p>
        {kind === "unavailable" ? (
          <Link
            className="context-button"
            reloadDocument
            to={WORK_COLLECTIONS[collectionId].readerPath}
          >
            Open downloaded works
          </Link>
        ) : null}
        <ReaderCorpusSwitch current={collectionId} />
      </section>
    </main>
  );
}
