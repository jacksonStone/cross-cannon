import type { EarlyChristianSearchResult } from "~/lib/early-christian-search.server";

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
  mode?: "theme" | "similar" | "similar-early-christian";
  question?: string;
  canon?: CanonMode;
  books?: string[];
  earlyChristianResults?: EarlyChristianSearchResult[];
  matchCount?: number;
  similarSource?: {
    id: string;
    reference: string;
  };
  results?: SearchResult[];
  retryAfterSeconds?: number;
};

export type StoredFilters = {
  canon?: string;
  matchCount?: number;
  books?: string[];
};
