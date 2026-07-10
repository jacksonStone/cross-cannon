import type {
  EarlyChristianSearchResult,
  EarlyChristianSimilarSource
} from "~/lib/early-christian-search.server";

export type CanonMode = "protestant" | "catholic" | "orthodox";
export type SearchTargetCorpus = "scripture" | "early-christian";

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
  earlyChristianAuthors?: string[];
  mode?: "theme" | "theme-early-christian" | "similar" | "similar-early-christian";
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
  targetCorpus?: SearchTargetCorpus;
};

export type ChurchFathersActionData = {
  authors?: string[];
  books?: string[];
  canon?: CanonMode;
  error?: string;
  matchCount?: number;
  mode?: "theme" | "theme-scripture" | "similar" | "similar-scripture";
  question?: string;
  results?: EarlyChristianSearchResult[];
  retryAfterSeconds?: number;
  similarSource?: EarlyChristianSimilarSource;
  similarScriptureSource?: EarlyChristianSimilarSource;
  scriptureResults?: SearchResult[];
  targetCorpus?: SearchTargetCorpus;
};

export type StoredFilters = {
  canon?: string;
  matchCount?: number;
  books?: string[];
  earlyChristianAuthors?: string[];
};
