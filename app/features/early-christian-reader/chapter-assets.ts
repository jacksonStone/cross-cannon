import {
  getCachedPreviewJsonEntries,
  loadPreviewJson
} from "~/features/early-christian-preview/preview-cache";

import type {
  ChapterAsset,
  ChapterAssetLoadResult,
  ChapterEntry,
  EarlyChristianAudio
} from "./types";

export function getCachedChapterAssets(version: string) {
  const chapters = new Map<string, ChapterAsset>();

  for (const asset of getCachedPreviewJsonEntries<ChapterAsset>(
    version,
    "/church-fathers-preview/chapters/"
  )) {
    chapters.set(asset.id, asset);
  }

  return chapters;
}

export async function loadChapterAssets(
  entries: ChapterEntry[],
  previewAssetVersion: string,
  concurrency: number
) {
  const results: ChapterAssetLoadResult[] = [];
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, entries.length));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < entries.length) {
      const entry = entries[nextIndex];
      nextIndex += 1;
      results.push(await loadChapterAsset(entry, previewAssetVersion));
    }
  }));

  return results;
}

export function distanceFromActiveChapter(
  entry: ChapterEntry,
  activeChapterIndex: number | undefined
) {
  return typeof activeChapterIndex === "number"
    ? Math.abs(entry.index - activeChapterIndex)
    : entry.index;
}

export function normalizeEarlyChristianAudio(
  audio: EarlyChristianAudio | undefined
): EarlyChristianAudio | null {
  if (!audio?.url || !audio.label) {
    return null;
  }

  return {
    confidence: audio.confidence,
    endSeconds: audio.endSeconds,
    label: audio.label,
    startSeconds: Number.isFinite(audio.startSeconds) ? audio.startSeconds : 0,
    url: audio.url
  };
}

async function loadChapterAsset(
  entry: ChapterEntry,
  previewAssetVersion: string
): Promise<ChapterAssetLoadResult> {
  try {
    return {
      asset: await loadPreviewJson<ChapterAsset>(
        entry.chapter.assetPath,
        previewAssetVersion
      ),
      entry
    };
  } catch (error: unknown) {
    return {
      entry,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
