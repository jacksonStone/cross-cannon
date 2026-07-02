export type WindowRange = {
  endIndex: number;
  startIndex: number;
};

export function emptyWindowRange(): WindowRange {
  return {
    endIndex: -1,
    startIndex: 0
  };
}

export function getCenteredWindowRange({
  after,
  before,
  count,
  index
}: {
  after: number;
  before: number;
  count: number;
  index: number;
}): WindowRange {
  if (count <= 0) {
    return emptyWindowRange();
  }

  const safeIndex = index >= 0 ? index : 0;

  return {
    endIndex: Math.min(count - 1, safeIndex + after),
    startIndex: Math.max(0, safeIndex - before)
  };
}

export function rangeContainsIndex(range: WindowRange, index: number) {
  return range.endIndex >= range.startIndex
    && index >= range.startIndex
    && index <= range.endIndex;
}

export function expandWindowStart(
  range: WindowRange,
  expandCount: number
): WindowRange {
  if (range.startIndex <= 0) {
    return range;
  }

  const startIndex = Math.max(0, range.startIndex - expandCount);

  return startIndex === range.startIndex
    ? range
    : {
      ...range,
      startIndex
    };
}

export function expandWindowEnd(
  range: WindowRange,
  count: number,
  expandCount: number
): WindowRange {
  if (range.endIndex >= count - 1) {
    return range;
  }

  const endIndex = Math.min(count - 1, range.endIndex + expandCount);

  return endIndex === range.endIndex
    ? range
    : {
      ...range,
      endIndex
    };
}
