import {
  romanNumeralToNumber,
  type AlignmentPolicy
} from "../lib/audio-alignment";

export const confessionsAlignmentPolicy: AlignmentPolicy = {
  alignmentScope: "track",
  matching: {
    defaultMinConfidence: 0.72,
    preference: "marker-first",
    subsequentMinConfidence: 0.6,
    useEndNeedle: true,
    warnOnSkipped: "always"
  },
  name: "Confessions",
  parseChapterLocation(chapterId) {
    const match = chapterId.match(
      /^npnf101:vi\.([IVXLCDM]+)(?:_1)?\.([IVXLCDM]+)$/
    );

    if (!match) {
      return null;
    }

    return {
      book: romanNumeralToNumber(match[1]),
      chapter: romanNumeralToNumber(match[2])
    };
  },
  workId: "npnf101:vi"
};
