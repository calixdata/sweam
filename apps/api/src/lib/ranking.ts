/**
 * Sweam's glass-box discovery ranking.
 *
 * The core promise of the platform is equal visibility: a brand-new creator
 * and an established one compete on the same, published terms. Three ideas
 * make that real:
 *
 *  1. Quality is measured per viewer, not in absolute volume. We use a
 *     Bayesian-smoothed completion rate (did people who started actually
 *     finish?) blended with a like rate, so 30 devoted viewers can outrank
 *     3,000 indifferent ones.
 *
 *  2. An exploration bonus in the spirit of UCB1 (Auer et al., 2002)
 *     guarantees low-exposure titles get impressions. The bonus grows with
 *     total catalog activity and shrinks as a title accumulates impressions,
 *     so nothing can stay buried forever and nothing keeps the bonus once it
 *     has had a fair audition.
 *
 *  3. A freshness term with a short half-life gives new releases a window,
 *     without letting recency dominate quality.
 *
 * Everything here is pure and deterministic (time is a parameter), which is
 * what lets us unit-test the fairness claims instead of just asserting them.
 */

export interface TitleSignals {
  /** Epoch milliseconds of first publish. */
  publishedAtMs: number;
  /** Times this title has been shown in a discovery surface. */
  impressions: number;
  /** Times playback started. */
  plays: number;
  /** Times playback reached >= 90% of duration. */
  completes: number;
  likes: number;
}

export interface RankWeights {
  quality: number;
  exploration: number;
  freshness: number;
}

export interface RankedScore {
  /** Weighted sum in [0, 1]. */
  score: number;
  /** The dominant component, in plain language, surfaced to viewers. */
  reason: string;
  parts: {
    quality: number;
    exploration: number;
    freshness: number;
  };
}

export const DEFAULT_WEIGHTS: RankWeights = { quality: 0.55, exploration: 0.3, freshness: 0.15 };

/**
 * Bayesian prior for completion: pretend every title starts with 8 phantom
 * plays at a 35% completion rate. Small samples get pulled toward the prior
 * instead of letting 2-for-2 look like a 100% finish rate.
 */
const PRIOR_PLAYS = 8;
const PRIOR_COMPLETES = PRIOR_PLAYS * 0.35;

/** A like from 1 in 4 players saturates the like-rate component. */
const LIKE_RATE_SCALE = 4;

/** Days for the freshness term to halve. */
const FRESHNESS_HALF_LIFE_DAYS = 10;

/** Dampens the raw UCB bonus into a useful [0, 1] range. */
const EXPLORATION_DAMPING = 8;

const REASONS = {
  quality: 'Viewers finish this one',
  exploration: 'New voice getting its first audience',
  freshness: 'Fresh on Sweam',
} as const;

export function scoreTitle(
  signals: TitleSignals,
  opts: { nowMs: number; catalogImpressions: number; weights?: RankWeights },
): RankedScore {
  const w = opts.weights ?? DEFAULT_WEIGHTS;
  const plays = Math.max(0, signals.plays);
  const completes = Math.max(0, signals.completes);
  const likes = Math.max(0, signals.likes);
  const impressions = Math.max(0, signals.impressions);
  const catalogImpressions = Math.max(0, opts.catalogImpressions);

  const finishRate = (completes + PRIOR_COMPLETES) / (plays + PRIOR_PLAYS);
  const likeRate = (LIKE_RATE_SCALE * likes) / (plays + PRIOR_PLAYS);
  const quality = clamp01(0.75 * finishRate + 0.25 * likeRate);

  // UCB1-style bonus: sqrt(ln(N) / n). ln(N + e) keeps the numerator positive
  // for an empty catalog; n + 1 keeps zero-impression titles finite.
  const exploration = clamp01(
    Math.sqrt(Math.log(catalogImpressions + Math.E) / (EXPLORATION_DAMPING * (impressions + 1))),
  );

  const ageDays = Math.max(0, (opts.nowMs - signals.publishedAtMs) / 86_400_000);
  const freshness = Math.pow(0.5, ageDays / FRESHNESS_HALF_LIFE_DAYS);

  const parts = {
    quality: w.quality * quality,
    exploration: w.exploration * exploration,
    freshness: w.freshness * freshness,
  };
  const dominant = (Object.keys(parts) as (keyof typeof parts)[]).reduce((a, b) =>
    parts[b] > parts[a] ? b : a,
  );

  return {
    score: parts.quality + parts.exploration + parts.freshness,
    reason: REASONS[dominant],
    parts,
  };
}

/** Smoothed finish rate on its own, for display ("73% finish it"). */
export function smoothedFinishRate(signals: Pick<TitleSignals, 'plays' | 'completes'>): number {
  return clamp01(
    (Math.max(0, signals.completes) + PRIOR_COMPLETES) / (Math.max(0, signals.plays) + PRIOR_PLAYS),
  );
}

/** Rank a list, highest score first. Ties keep input order (stable sort). */
export function rankTitles<T>(
  items: readonly T[],
  getSignals: (item: T) => TitleSignals,
  opts: { nowMs: number; catalogImpressions: number; weights?: RankWeights },
): { item: T; ranked: RankedScore }[] {
  return items
    .map((item) => ({ item, ranked: scoreTitle(getSignals(item), opts) }))
    .sort((a, b) => b.ranked.score - a.ranked.score);
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
