import { useEffect, useState } from "react";
import { loadPreviewJson } from "../early-christian-preview/preview-cache";
import type { BookIndex, PreviewManifest } from "../early-christian-reader/types";
import type { ReaderLocation } from "../reader-position/reader-position";
import { WORK_COLLECTIONS } from "../work-reader/collections";
import type { Progress } from "./progress";

export function useProgressLabels(progress: Progress) {
  const [labels, setLabels] = useState<Record<string, string>>({});
  const hasFathers = Boolean(progress.fathers);
  const hasClassics = Boolean(progress.classics);
  useEffect(() => {
    let disposed = false;
    for (const id of ["fathers", "classics"] as const) {
      if (!(id === "fathers" ? hasFathers : hasClassics)) continue;
      const collection = WORK_COLLECTIONS[id];
      void loadPreviewJson<PreviewManifest>(collection.manifestUrl, collection.assetVersion)
        .then((manifest) => loadPreviewJson<BookIndex>(manifest.bookIndexPath, collection.assetVersion))
        .then((index) => {
          if (disposed) return;
          const next: Record<string, string> = {};
          for (const book of index.books) for (const chapter of book.chapters) {
            next[chapter.id] = `${book.name} · ${chapter.reference ?? chapter.title}`;
          }
          setLabels((current) => ({ ...current, ...next }));
        }).catch(() => undefined);
    }
    return () => { disposed = true; };
  }, [hasFathers, hasClassics]);
  return (location: ReaderLocation) => location.corpus === "scripture"
    ? location.chapterKey.replaceAll("\t", " ") : labels[location.chapterKey] ?? "Saved chapter";
}
