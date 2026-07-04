const IDEAL_CLOSE_COSINE_SCORE = 0.8;
const EXCELLENT_MATCH_RATIO = 0.9;
const STRONG_MATCH_RATIO = 0.8;
const PLAUSIBLE_MATCH_RATIO = 0.7;

export const MATCH_STRENGTH_THRESHOLDS = {
  excellent: IDEAL_CLOSE_COSINE_SCORE * EXCELLENT_MATCH_RATIO,
  plausible: IDEAL_CLOSE_COSINE_SCORE * PLAUSIBLE_MATCH_RATIO,
  strong: IDEAL_CLOSE_COSINE_SCORE * STRONG_MATCH_RATIO
};

export function scoreToMatchStrength(score: number | undefined) {
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return 1;
  }

  if (score >= MATCH_STRENGTH_THRESHOLDS.excellent) {
    return 4;
  }

  if (score >= MATCH_STRENGTH_THRESHOLDS.strong) {
    return 3;
  }

  if (score >= MATCH_STRENGTH_THRESHOLDS.plausible) {
    return 2;
  }

  return 1;
}

export function withCalibratedMatchStrength<T extends { score?: number }>(results: T[]) {
  return results.map((result) => ({
    ...result,
    matchStrength: scoreToMatchStrength(result.score)
  }));
}
