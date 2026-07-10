import { Link } from "@remix-run/react";

import { ReaderCorpusSwitch } from "~/features/reader-switch/ReaderCorpusSwitch";

export function EarlyChristianOfflineState({
  kind,
  readerTheme,
}: {
  kind: "empty" | "unavailable";
  readerTheme: string;
}) {
  return (
    <main className={`reader-shell reader-theme-${readerTheme}`}>
      <section className="reader-empty" role="status">
        <p>
          {kind === "empty"
            ? "No Early Christian works are available offline."
            : "This work isn’t available offline."}
        </p>
        {kind === "unavailable" ? (
          <Link className="context-button" reloadDocument to="/church-fathers">
            Open downloaded works
          </Link>
        ) : null}
        <ReaderCorpusSwitch current="fathers" />
      </section>
    </main>
  );
}
