export type ModernizedTextPart = {
  changed: boolean;
  text: string;
};

export function buildModernizedTextParts(
  original: string,
  modernized: string
): ModernizedTextPart[] {
  const originalTokens = tokenizeModernizedText(original);
  const modernizedTokens = tokenizeModernizedText(modernized.trim());
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

function tokenizeModernizedText(value: string) {
  return value.match(/\s+|\S+/g) ?? [];
}

function contentTokenEntries(tokens: string[]) {
  return tokens
    .map((token, index) => ({
      comparable: comparableModernizedTextToken(token),
      index
    }))
    .filter((entry) => entry.comparable);
}

function comparableModernizedTextToken(token: string) {
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
    for (
      let modernizedIndex = 1;
      modernizedIndex <= modernizedContent.length;
      modernizedIndex += 1
    ) {
      scores[originalIndex][modernizedIndex] =
        originalContent[originalIndex - 1].comparable
        === modernizedContent[modernizedIndex - 1].comparable
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

    if (
      scores[originalIndex - 1][modernizedIndex]
      >= scores[originalIndex][modernizedIndex - 1]
    ) {
      originalIndex -= 1;
    } else {
      modernizedIndex -= 1;
    }
  }

  return matchedModernizedIndexes;
}
