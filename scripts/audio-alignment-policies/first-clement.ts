import {
  romanNumeralToNumber,
  type AlignmentPolicy
} from "../lib/audio-alignment";

export const firstClementAlignmentPolicy: AlignmentPolicy = {
  alignmentScope: "track",
  matching: {
    defaultMinConfidence: 0.6,
    preference: "marker-first",
    startHints: {
      2: ["now", "all", "of", "you", "were", "humble", "minded"],
      3: ["from", "this", "time", "on", "flowed", "jealousy"]
    },
    useEndNeedle: false,
    warnOnSkipped: "always"
  },
  name: "First Clement",
  parseChapterLocation(chapterId) {
    const match = chapterId.match(/^anf09:xii\.iv\.([ivxlcdm]+)$/);

    if (!match) {
      return null;
    }

    return {
      book: 1,
      chapter: romanNumeralToNumber(match[1])
    };
  },
  workId: "anf09:xii.iv"
};
