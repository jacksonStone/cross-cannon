import { DEFAULT_MATCH_COUNT } from "./canons";

export type SearchRequestValidationError = {
  error: string;
  status: 400;
};

export function parseSearchMatchCount(
  value: FormDataEntryValue | null,
  fallback = DEFAULT_MATCH_COUNT
): { matchCount: number } | SearchRequestValidationError {
  const matchCount = Number(value ?? fallback);

  if (!Number.isInteger(matchCount) || matchCount < 5 || matchCount > 40) {
    return {
      error: "Choose between 5 and 40 matches.",
      status: 400
    };
  }

  return { matchCount };
}

export function validateSearchQuestion(question: string):
  | { question: string }
  | SearchRequestValidationError {
  if (question.length < 3) {
    return {
      error: "Enter a longer question.",
      status: 400
    };
  }

  if (question.length > 500) {
    return {
      error: "Keep the question under 500 characters.",
      status: 400
    };
  }

  return { question };
}

export function isSearchSourcePassageId(value: string) {
  return /^[a-f0-9]{24}$/.test(value);
}
