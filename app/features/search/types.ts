export type CanonMode = "protestant" | "catholic" | "orthodox";

export type SearchResult = {
  id: string;
  reference: string;
  type: "paragraph";
  highlightVerse?: number;
  score?: number;
  matchStrength: number;
};

export type SearchActionData = {
  error?: string;
  question?: string;
  canon?: CanonMode;
  books?: string[];
  matchCount?: number;
  results?: SearchResult[];
  retryAfterSeconds?: number;
};

export type StoredFilters = {
  canon?: string;
  matchCount?: number;
  books?: string[];
};
