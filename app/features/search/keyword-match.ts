export function keywordMatches(query: string, value: string) {
  const terms = normalizeKeywordText(query).split(/\s+/).filter(Boolean);

  if (terms.length === 0) {
    return true;
  }

  const normalizedValue = normalizeKeywordText(value);
  return terms.every((term) => normalizedValue.includes(term));
}

function normalizeKeywordText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
