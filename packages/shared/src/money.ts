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

// ---------------------------------------------------------------------------
// Sweam Blu Fund
// ---------------------------------------------------------------------------

/**
 * The Sweam Blu Fund is the ad-funded creator payout program (it replaces the
 * flat ad-revenue share). Its bar is higher than basic monetization: a real
 * audience, real views, a clean recent record, and a verified adult. The 18+
 * check needs a date of birth on file AND an explicit attestation.
 */
export const BLU_FUND_THRESHOLDS = {
  minFollowers: 500,
  minViews: 10_000,
  /** No account/content violations (strikes or takedowns) within this window. */
  violationWindowDays: 90,
  minAgeYears: 18,
} as const;

/**
 * Total platform users at or above which Sweam opens Blu (paid) content to
 * every creator. Below it, only Blu-Fund-eligible creators may paywall content,
 * because the audience is not yet large enough to support paid-only creators.
 */
export const BLU_OPEN_USER_THRESHOLD = 10_000;

export interface BluFundStats {
  followers: number;
  /** Lifetime plays across the creator's published titles. */
  views: number;
  /** Strikes + takedowns within the violation window. */
  recentViolations: number;
  /** A date of birth is on file, it is >= 18, AND an 18+ attestation is recorded. */
  ageVerified18: boolean;
}

export interface BluFundEligibility {
  eligible: boolean;
  followers: EligibilityCheck;
  views: EligibilityCheck;
  noRecentViolations: { met: boolean; violations: number; windowDays: number };
  ageVerified: boolean;
}

export function evaluateBluFundEligibility(stats: BluFundStats): BluFundEligibility {
  const followers: EligibilityCheck = {
    required: BLU_FUND_THRESHOLDS.minFollowers,
    actual: Math.max(0, stats.followers),
    met: stats.followers >= BLU_FUND_THRESHOLDS.minFollowers,
  };
  const views: EligibilityCheck = {
    required: BLU_FUND_THRESHOLDS.minViews,
    actual: Math.max(0, stats.views),
    met: stats.views >= BLU_FUND_THRESHOLDS.minViews,
  };
  const noRecentViolations = {
    met: stats.recentViolations === 0,
    violations: Math.max(0, stats.recentViolations),
    windowDays: BLU_FUND_THRESHOLDS.violationWindowDays,
  };
  const ageVerified = stats.ageVerified18;
  return {
    eligible: followers.met && views.met && noRecentViolations.met && ageVerified,
    followers,
    views,
    noRecentViolations,
    ageVerified,
  };
}

/** Whole years between an ISO date (YYYY-MM-DD) and now, or null if unparseable. */
export function ageInYears(dob: string | null | undefined, now: Date = new Date()): number | null {
  if (!dob) return null;
  const d = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age -= 1;
  return age;
}

/** The viewer-facing Blu-offer gate: may this creator put content behind the paywall? */
export interface BluOfferGate {
  canOfferBlu: boolean;
  /** True once the platform has crossed BLU_OPEN_USER_THRESHOLD (Blu open to all). */
  platformOpen: boolean;
  eligible: boolean;
  /** An admin is allowed to offer Blu for testing even without meeting the bar. */
  adminBypass: boolean;
  /** An official account (Sweam's own, or a flagship creator) has the bar waived. */
  officialBypass?: boolean;
}

/**
 * The Sweam Blu Fund distribution. Each month the creator share of ad revenue
 * (CREATOR_REVENUE_SHARE of the gross) forms a pool split across Fund-eligible
 * creators by their share of watch-time on free (ad-supported) content. Each
 * creator's effective rate is reported as revenue per 1,000 views (RPM).
 */
export interface BluFundAllocation {
  creatorId: string;
  handle: string;
  watchSeconds: number;
  views: number;
  amountMillicents: number;
  status: 'pending' | 'paid' | 'failed';
}

export interface BluFundRun {
  id: string;
  periodStart: string;
  periodEnd: string;
  grossMillicents: number;
  poolMillicents: number;
  eligibleCreators: number;
  totalWatchSeconds: number;
  status: string;
  createdAt: string;
  allocations: BluFundAllocation[];
}

/** One monthly Blu Fund payout, for the creator's Studio view. */
export interface CreatorFundPayout {
  periodStart: string;
  periodEnd: string;
  watchSeconds: number;
  views: number;
  amountMillicents: number;
  status: string;
}

/** Effective revenue per 1,000 views (RPM), in millicents; 0 when no views. */
export function rpmMillicents(amountMillicents: number, views: number): number {
  return views > 0 ? Math.round(amountMillicents / (views / 1000)) : 0;
}

/** The Studio Blu Fund payload: eligibility, the offer gate, and the creator's settings. */
export interface BluFundStatus {
  eligibility: BluFundEligibility;
  platformOpen: boolean;
  canOfferBlu: boolean;
  adminBypass: boolean;
  /** Official account: eligibility requirements are waived. */
  officialBypass?: boolean;
  /** The Free/Blu default applied to new uploads. */
  contentDefault: 'free' | 'blu';
  dob: string | null;
  attested: boolean;
}
