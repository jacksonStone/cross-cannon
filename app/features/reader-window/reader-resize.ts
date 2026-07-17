export function shouldPreserveReaderAnchorOnResize(
  previousLayoutWidth: number,
  nextLayoutWidth: number
) {
  return previousLayoutWidth !== nextLayoutWidth;
}
