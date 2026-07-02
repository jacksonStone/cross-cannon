import { Link } from "@remix-run/react";
import { useEffect } from "react";

import { prefetchEarlyChristianPreview } from "~/features/early-christian-preview/preview-cache";

export const LAST_READER_STORAGE_KEY = "cross-cannon:last-reader:v1";

export type ReaderCorpus = "fathers" | "scripture";

type ReaderCorpusSwitchProps = {
  current: ReaderCorpus;
};

export function ReaderCorpusSwitch({ current }: ReaderCorpusSwitchProps) {
  const targetCorpus: ReaderCorpus = current === "scripture" ? "fathers" : "scripture";
  const isSwitchingToFathers = targetCorpus === "fathers";

  useEffect(() => {
    if (isSwitchingToFathers) {
      prefetchEarlyChristianPreview();
    }
  }, [isSwitchingToFathers]);

  return (
    <Link
      aria-label={isSwitchingToFathers ? "Switch to early Christian works" : "Switch to Scripture"}
      className="reader-corpus-switch"
      onClick={() => {
        if (isSwitchingToFathers) {
          prefetchEarlyChristianPreview();
        }

        rememberReaderCorpus(targetCorpus);
      }}
      prefetch="render"
      title={isSwitchingToFathers ? "Early Christian works" : "Scripture"}
      to={isSwitchingToFathers ? "/church-fathers" : "/?reader=scripture"}
    >
      {isSwitchingToFathers ? (
        <span aria-hidden="true" className="reader-corpus-switch-mark is-fathers">
          ✣
        </span>
      ) : (
        <img
          alt=""
          aria-hidden="true"
          className="reader-corpus-switch-mark is-scripture"
          src="/favicon.svg"
        />
      )}
    </Link>
  );
}

export function readLastReaderCorpus(): ReaderCorpus | null {
  if (typeof window === "undefined") {
    return null;
  }

  const value = window.localStorage.getItem(LAST_READER_STORAGE_KEY);
  return value === "fathers" || value === "scripture" ? value : null;
}

export function rememberReaderCorpus(corpus: ReaderCorpus) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(LAST_READER_STORAGE_KEY, corpus);
}
