/**
 * Money math for the AVOD ledger. All amounts are integer millicents
 * (1/1000 of a cent): a CPM priced in cents means one impression earns
 * exactly `cpmCents` millicents, so the ledger never touches floating point
 * except at the display edge.
 */

/** The published split: creators keep 55% of ad revenue earned on their titles. */
export const CREATOR_REVENUE_SHARE = 0.55;

/** Payouts unlock at $10.00. */
export const MIN_PAYOUT_MILLICENTS = 10 * 100 * 1000;

/** One impression's gross revenue: cpm cents-per-thousand = millicents-per-one. */
export function impressionRevenueMillicents(cpmCents: number): number {
  return Math.max(0, Math.round(cpmCents));
}

export function creatorShareMillicents(cpmCents: number): number {
  return Math.round(impressionRevenueMillicents(cpmCents) * CREATOR_REVENUE_SHARE);
}

/** Display formatting: millicents to a dollar string. */
export function formatMillicents(millicents: number): string {
  return `$${(Math.max(0, millicents) / 100_000).toFixed(2)}`;
}

/**
 * Monetization eligibility. The structure (audience + watch time + published
 * work + account standing) mirrors the published gates at YouTube, TikTok,
 * and Meta; the launch-phase values are scaled to a day-one platform and the
 * growth path is published in docs/CREATOR-PROGRAM.md. Ads still run on
 * ineligible creators' titles, but the creator share accrues only once every
 * check is met, evaluated at each serve.
 */
export const MONETIZATION_THRESHOLDS = {
  minFollowers: 5,
  /** 1,000 watch-minutes, lifetime, across the creator's published titles. */
  minWatchSeconds: 60_000,
  minPublishedTitles: 1,
} as const;

export interface CreatorMonetizationStats {
  followers: number;
  watchSeconds: number;
  publishedTitles: number;
  suspended: boolean;
}

export interface EligibilityCheck {
  required: number;
  actual: number;
  met: boolean;
}

export interface MonetizationEligibility {
  eligible: boolean;
  followers: EligibilityCheck;
  watchSeconds: EligibilityCheck;
  publishedTitles: EligibilityCheck;
  goodStanding: boolean;
}

export function evaluateMonetizationEligibility(
  stats: CreatorMonetizationStats,
): MonetizationEligibility {
  const followers: EligibilityCheck = {
    required: MONETIZATION_THRESHOLDS.minFollowers,
    actual: Math.max(0, stats.followers),
    met: stats.followers >= MONETIZATION_THRESHOLDS.minFollowers,
  };
  const watchSeconds: EligibilityCheck = {
    required: MONETIZATION_THRESHOLDS.minWatchSeconds,
    actual: Math.max(0, stats.watchSeconds),
    met: stats.watchSeconds >= MONETIZATION_THRESHOLDS.minWatchSeconds,
  };
  const publishedTitles: EligibilityCheck = {
    required: MONETIZATION_THRESHOLDS.minPublishedTitles,
    actual: Math.max(0, stats.publishedTitles),
    met: stats.publishedTitles >= MONETIZATION_THRESHOLDS.minPublishedTitles,
  };
  const goodStanding = !stats.suspended;
  return {
    eligible: followers.met && watchSeconds.met && publishedTitles.met && goodStanding,
    followers,
    watchSeconds,
    publishedTitles,
    goodStanding,
  };
}
