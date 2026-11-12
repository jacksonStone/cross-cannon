import type { ChapterAsset } from "~/features/early-christian-reader/types";
import { groupChapterPassages } from "~/features/early-christian-reader/reader-passages";

export function relatedCommentaryPassages(
  chapter: ChapterAsset,
  verseStart: number,
  verseEnd: number
) {
  const verses = chapter.verses.filter(
    (verse) =>
      verse.scriptureVerseStart !== undefined &&
      verse.scriptureVerseStart <= verseEnd &&
      (verse.scriptureVerseEnd ?? verse.scriptureVerseStart) >= verseStart
  );
  return groupChapterPassages({ ...chapter, verses }, "original");
}
