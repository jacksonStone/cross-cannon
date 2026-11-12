export type WorkCorpus = "early-christian" | "christian-classics";
export type WorkCollectionId = "fathers" | "classics";

export const WORK_COLLECTIONS = {
  fathers: {
    id: "fathers",
    corpus: "early-christian",
    label: "Early Christian Works",
    shortLabel: "Fathers",
    readerPath: "/church-fathers",
    manifestUrl: "/church-fathers-preview/manifest.json",
    assetVersion: "early-christian-preview-20260704b",
    positionStorageKey: "cross-cannon:church-fathers-position:v1",
  },
  classics: {
    id: "classics",
    corpus: "christian-classics",
    label: "Christian Classics",
    shortLabel: "Classics",
    readerPath: "/christian-classics/read",
    manifestUrl: "/christian-classics-text/manifest.json",
    assetVersion: "christian-classics-v1",
    positionStorageKey: "cross-cannon:christian-classics-position:v1",
  },
} as const;

export function workCollectionForChapter(chapterId: string) {
  return WORK_COLLECTIONS[
    chapterId.startsWith("classics:") ? "classics" : "fathers"
  ];
}
