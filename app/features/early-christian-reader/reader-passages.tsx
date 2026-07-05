import type { ReactNode } from "react";

export type EarlyChristianReaderTextMode = "modernized" | "original";

export type EarlyChristianChapterAsset = {
  book: string;
  chapter: number;
  id: string;
  verses: Array<{
    modernizedText?: string | null;
    text: string;
    verse: number;
  }>;
};

export type EarlyChristianReaderPassage = {
  key: string;
  rangeLabel: string;
  reference: string;
  text: string;
  textParts: EarlyChristianReaderPassageTextPart[];
  verseEnd: number;
  verseStart: number;
};

type EarlyChristianReaderPassageTextPart = {
  changed: boolean;
  text: string;
};

export function groupChapterPassages(
  chapter: EarlyChristianChapterAsset,
  textMode: EarlyChristianReaderTextMode = "modernized"
): EarlyChristianReaderPassage[] {
  const passages: EarlyChristianReaderPassage[] = [];
  let current: EarlyChristianChapterAsset["verses"] = [];

  for (const verse of chapter.verses) {
    current.push(verse);

    if (current.length >= 3) {
      passages.push(buildReaderPassage(chapter, current, textMode));
      current = [];
    }
  }

  if (current.length > 0) {
    if (passages.length > 0 && current.length < 3) {
      const previous = passages.pop();
      const previousVerses = previous
        ? chapter.verses.filter((verse) => (
          verse.verse >= previous.verseStart && verse.verse <= previous.verseEnd
        ))
        : [];
      passages.push(buildReaderPassage(chapter, [...previousVerses, ...current], textMode));
    } else {
      passages.push(buildReaderPassage(chapter, current, textMode));
    }
  }

  return passages;
}

export function renderReaderPassageText(passage: EarlyChristianReaderPassage): ReactNode {
  return passage.textParts.map((part, index) => (
    part.changed ? (
      <span className="reader-modernized-change" key={`${index}-${part.text}`}>
        {part.text}
      </span>
    ) : (
      <span key={`${index}-${part.text}`}>{part.text}</span>
    )
  ));
}

export function findLoadedPassage(
  chapters: Map<string, EarlyChristianChapterAsset>,
  key: string,
  textMode: EarlyChristianReaderTextMode
) {
  const rangeMatch = key.match(/^(.+):(\d+)-(\d+)$/);

  if (!rangeMatch) {
    return null;
  }

  const [, chapterId, verseStart, verseEnd] = rangeMatch;
  const chapter = chapters.get(chapterId);

  if (!chapter) {
    return null;
  }

  return groupChapterPassages(chapter, textMode).find((passage) => (
    passage.verseStart === Number(verseStart) && passage.verseEnd === Number(verseEnd)
  )) ?? null;
}

export function isSelectedReaderPassage({
  chapterId,
  passage,
  selectedChapterId,
  selectedRange
}: {
  chapterId: string;
  passage: EarlyChristianReaderPassage;
  selectedChapterId: string;
  selectedRange: string;
}) {
  if (selectedChapterId !== chapterId || !selectedRange) {
    return false;
  }

  if (selectedRange === passage.rangeLabel) {
    return true;
  }

  const requestedRange = parsePassageRange(selectedRange);

  return requestedRange
    ? passage.verseStart <= requestedRange.start
      && passage.verseEnd >= requestedRange.end
    : false;
}

export function findPassageTargetInChapter(
  chapterElement: HTMLElement,
  selectedRange: string
) {
  const exactTarget = chapterElement.querySelector<HTMLElement>(
    `[data-passage-range="${cssEscape(selectedRange)}"]`
  );

  if (exactTarget) {
    return exactTarget;
  }

  const requestedRange = parsePassageRange(selectedRange);

  if (!requestedRange) {
    return null;
  }

  return [...chapterElement.querySelectorAll<HTMLElement>("[data-passage-start][data-passage-end]")]
    .find((element) => {
      const passageStart = Number(element.dataset.passageStart);
      const passageEnd = Number(element.dataset.passageEnd);

      return Number.isFinite(passageStart)
        && Number.isFinite(passageEnd)
        && passageStart <= requestedRange.start
        && passageEnd >= requestedRange.end;
    }) ?? null;
}

function buildReaderPassage(
  chapter: EarlyChristianChapterAsset,
  verses: EarlyChristianChapterAsset["verses"],
  textMode: EarlyChristianReaderTextMode
): EarlyChristianReaderPassage {
  const first = verses[0];
  const last = verses[verses.length - 1];
  const rangeLabel = last.verse === first.verse
    ? String(first.verse)
    : `${first.verse}-${last.verse}`;
  const textParts = buildReaderPassageTextParts(verses, textMode);

  return {
    key: `${chapter.id}:${first.verse}-${last.verse}`,
    rangeLabel,
    reference: `${chapter.book} ${chapter.chapter}:${rangeLabel}`,
    text: textParts.map((part) => part.text).join(""),
    textParts,
    verseEnd: last.verse,
    verseStart: first.verse
  };
}

function buildReaderPassageTextParts(
  verses: EarlyChristianChapterAsset["verses"],
  textMode: EarlyChristianReaderTextMode
): EarlyChristianReaderPassageTextPart[] {
  return verses.flatMap((verse, index) => {
    const verseParts = textMode === "modernized" && verse.modernizedText?.trim()
      ? buildModernizedTextParts(verse.text, verse.modernizedText)
      : [{ changed: false, text: verse.text.trim() }];

    return index === 0
      ? verseParts
      : [{ changed: false, text: " " }, ...verseParts];
  });
}

function buildModernizedTextParts(
  original: string,
  modernized: string
): EarlyChristianReaderPassageTextPart[] {
  const originalTokens = tokenizeReaderText(original);
  const modernizedTokens = tokenizeReaderText(modernized.trim());
  const originalContent = contentTokenEntries(originalTokens);
  const modernizedContent = contentTokenEntries(modernizedTokens);
  const matchedModernizedIndexes = findMatchedModernizedTokenIndexes(
    originalContent,
    modernizedContent
  );

  return modernizedTokens.map((token, index) => ({
    changed: !isWhitespaceToken(token) && !matchedModernizedIndexes.has(index),
    text: token
  }));
}

function tokenizeReaderText(value: string) {
  return value.match(/\s+|\S+/g) ?? [];
}

function contentTokenEntries(tokens: string[]) {
  return tokens
    .map((token, index) => ({
      comparable: comparableReaderToken(token),
      index
    }))
    .filter((entry) => entry.comparable);
}

function comparableReaderToken(token: string) {
  if (isWhitespaceToken(token)) {
    return "";
  }

  return token
    .toLocaleLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "") || token;
}

function isWhitespaceToken(token: string) {
  return /^\s+$/.test(token);
}

function findMatchedModernizedTokenIndexes(
  originalContent: Array<{ comparable: string; index: number }>,
  modernizedContent: Array<{ comparable: string; index: number }>
) {
  const matchedModernizedIndexes = new Set<number>();
  const scores = Array.from(
    { length: originalContent.length + 1 },
    () => Array(modernizedContent.length + 1).fill(0) as number[]
  );

  for (let originalIndex = 1; originalIndex <= originalContent.length; originalIndex += 1) {
    for (let modernizedIndex = 1; modernizedIndex <= modernizedContent.length; modernizedIndex += 1) {
      scores[originalIndex][modernizedIndex] =
        originalContent[originalIndex - 1].comparable === modernizedContent[modernizedIndex - 1].comparable
          ? scores[originalIndex - 1][modernizedIndex - 1] + 1
          : Math.max(
            scores[originalIndex - 1][modernizedIndex],
            scores[originalIndex][modernizedIndex - 1]
          );
    }
  }

  let originalIndex = originalContent.length;
  let modernizedIndex = modernizedContent.length;

  while (originalIndex > 0 && modernizedIndex > 0) {
    if (
      originalContent[originalIndex - 1].comparable
      === modernizedContent[modernizedIndex - 1].comparable
    ) {
      matchedModernizedIndexes.add(modernizedContent[modernizedIndex - 1].index);
      originalIndex -= 1;
      modernizedIndex -= 1;
      continue;
    }

    if (scores[originalIndex - 1][modernizedIndex] >= scores[originalIndex][modernizedIndex - 1]) {
      originalIndex -= 1;
    } else {
      modernizedIndex -= 1;
    }
  }

  return matchedModernizedIndexes;
}

function parsePassageRange(rangeLabel: string) {
  const match = rangeLabel.match(/^(\d+)(?:-(\d+))?$/);

  if (!match) {
    return null;
  }

  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }

  return {
    end,
    start
  };
}

function cssEscape(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}
