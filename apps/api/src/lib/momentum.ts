/**
 * Scout-portal momentum math. Like the discovery ranking, everything here is
 * pure and deterministic so the boards' behavior is testable, and the numbers
 * a scout sees can be explained in one sentence each.
 */

/**
 * Additive smoothing for week-over-week comparisons: two phantom plays on each
 * side keep a 0-to-6 launch week meaningful (ratio 4.0) instead of infinite,
 * and stop 1-to-2 from looking like a doubling breakout (ratio 1.33).
 */
const GROWTH_PRIOR = 2;

/** Smoothed ratio of recent plays to prior-window plays. Above 1 is growth. */
export function growthRatio(recentPlays: number, priorPlays: number): number {
  return (Math.max(0, recentPlays) + GROWTH_PRIOR) / (Math.max(0, priorPlays) + GROWTH_PRIOR);
}

/**
 * Fastest-growing ordering: acceleration weighted by volume. sqrt(recent)
 * stops a 2-play title with infinite-ish growth from outranking a genuinely
 * breaking-out one, while still letting small titles compete.
 */
export function breakoutScore(recentPlays: number, priorPlays: number): number {
  return Math.sqrt(Math.max(0, recentPlays)) * growthRatio(recentPlays, priorPlays);
}

export interface RetentionInput {
  maxPositionS: number;
  durationS: number;
}

export const RETENTION_POINTS = 11;

/**
 * Audience retention curve: for each checkpoint i/10 of the runtime, the
 * fraction of tracked viewers whose furthest position reached it. Point 0 is
 * 1.0 by construction (everyone started); the curve never increases.
 * Rows without a usable duration are ignored; returns [] with no valid rows.
 */
export function buildRetentionCurve(viewers: readonly RetentionInput[]): number[] {
  const valid = viewers.filter((v) => v.durationS > 0 && v.maxPositionS >= 0);
  if (valid.length === 0) return [];
  const curve: number[] = [];
  for (let i = 0; i < RETENTION_POINTS; i++) {
    const threshold = i / (RETENTION_POINTS - 1);
    const reached = valid.reduce(
      (count, v) => count + (Math.min(v.maxPositionS / v.durationS, 1) >= threshold ? 1 : 0),
      0,
    );
    curve.push(Number((reached / valid.length).toFixed(3)));
  }
  return curve;
}
