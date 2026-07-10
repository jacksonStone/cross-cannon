import {
  romanNumeralToNumber,
  type AlignmentPolicy
} from "../lib/audio-alignment";

export const cityOfGodAlignmentPolicy: AlignmentPolicy = {
  alignmentScope: "book",
  boundaryOffsetSeconds: 2,
  matching: {
    defaultMinConfidence: 0.72,
    endFallbackConfidence: 0.9,
    preference: "text-first",
    refineTextWithNearestMarker: true,
    subsequentMinConfidence: 0.6,
    useEndNeedle: true,
    warnOnSkipped: "selected-track"
  },
  name: "City of God",
  parseChapterLocation(chapterId) {
    const bookOneMatch = chapterId.match(/^npnf102:iv\.ii\.([ivxlcdm]+)$/i);

    if (bookOneMatch) {
      return {
        book: 1,
        chapter: romanNumeralToNumber(bookOneMatch[1])
      };
    }

    const match = chapterId.match(
      /^npnf102:iv\.([IVXLCDM]+)(?:_1)?\.([0-9]+|[ivxlcdm]+)$/i
    );

    if (!match) {
      return null;
    }

    return {
      book: romanNumeralToNumber(match[1]),
      chapter: /^\d+$/.test(match[2])
        ? Number(match[2])
        : romanNumeralToNumber(match[2])
    };
  },
  workId: "npnf102:iv"
};
