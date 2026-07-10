export function fitSingleLineText({
  availableWidth,
  baseFontSize,
  margin = 2,
  maxAttempts = 4,
  measureWidth,
  minScale = 0.28,
  setFontSize
}: {
  availableWidth: number;
  baseFontSize: number;
  margin?: number;
  maxAttempts?: number;
  measureWidth: () => number;
  minScale?: number;
  setFontSize: (fontSize: number) => void;
}) {
  let measuredWidth = measureWidth();

  if (
    !Number.isFinite(availableWidth)
    || availableWidth <= 0
    || !Number.isFinite(baseFontSize)
    || baseFontSize <= 0
    || !Number.isFinite(measuredWidth)
    || measuredWidth <= 0
  ) {
    return null;
  }

  const targetWidth = Math.max(0, availableWidth - margin);
  const minimumFontSize = baseFontSize * minScale;
  let fontSize = baseFontSize;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (measuredWidth <= targetWidth) {
      break;
    }

    const nextFontSize = Math.max(
      minimumFontSize,
      fontSize * (targetWidth / measuredWidth)
    );

    if (!Number.isFinite(nextFontSize) || nextFontSize >= fontSize) {
      break;
    }

    fontSize = nextFontSize;
    setFontSize(fontSize);
    measuredWidth = measureWidth();
  }

  return fontSize;
}
