import {
  BLU_FUND_THRESHOLDS,
  BLU_OPEN_USER_THRESHOLD,
  ageInYears,
  evaluateBluFundEligibility,
} from '@sweam/shared';
import type { BluFundEligibility, BluOfferGate } from '@sweam/shared';

/**
 * Sweam Blu Fund eligibility + the paywall-offer gate, evaluated from live data.
 *
 * Eligibility (the Fund bar): >= 500 followers, >= 10,000 views (lifetime plays
 * on published titles), no strikes/takedowns in the last 90 days, and a
 * verified 18+ age (date of birth on file AND an attestation recorded).
 *
 * Offer gate: a creator may put content behind the Blu paywall only when they
 * are Fund-eligible, OR once the platform has crossed BLU_OPEN_USER_THRESHOLD,
 * after which Blu is open to everyone.
 */

function cutoffIso(days: number, nowMs = Date.now()): string {
  return new Date(nowMs - days * 86_400_000).toISOString();
}

export async function getBluFundEligibility(
  db: D1Database,
  creatorId: string,
): Promise<BluFundEligibility> {
  const cutoff = cutoffIso(BLU_FUND_THRESHOLDS.violationWindowDays);
  const [followersRow, viewsRow, strikesRow, takedownsRow, profile] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM follows WHERE creator_id = ?').bind(creatorId).first<{ n: number }>(),
    db
      .prepare(
        `SELECT COALESCE(SUM(s.plays), 0) AS n
         FROM title_stats s JOIN titles t ON t.id = s.title_id
         WHERE t.creator_id = ? AND t.published = 1`,
      )
      .bind(creatorId)
      .first<{ n: number }>(),
    db
      .prepare(
        'SELECT COUNT(*) AS n FROM strikes WHERE creator_id = ? AND revoked_at IS NULL AND created_at >= ?',
      )
      .bind(creatorId, cutoff)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM takedowns td JOIN titles t ON t.id = td.title_id
         WHERE t.creator_id = ? AND td.created_at >= ?`,
      )
      .bind(creatorId, cutoff)
      .first<{ n: number }>(),
    db
      .prepare('SELECT dob, blu_fund_attested_at FROM creator_profiles WHERE user_id = ?')
      .bind(creatorId)
      .first<{ dob: string | null; blu_fund_attested_at: string | null }>(),
  ]);

  const age = ageInYears(profile?.dob ?? null);
  const ageVerified18 =
    age != null && age >= BLU_FUND_THRESHOLDS.minAgeYears && Boolean(profile?.blu_fund_attested_at);

  return evaluateBluFundEligibility({
    followers: followersRow?.n ?? 0,
    views: viewsRow?.n ?? 0,
    recentViolations: (strikesRow?.n ?? 0) + (takedownsRow?.n ?? 0),
    ageVerified18,
  });
}

export async function platformUserCount(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getBluOfferGate(
  db: D1Database,
  creatorId: string,
  isAdmin = false,
): Promise<BluOfferGate & { eligibility: BluFundEligibility }> {
  const [eligibility, users] = await Promise.all([
    getBluFundEligibility(db, creatorId),
    platformUserCount(db),
  ]);
  const platformOpen = users >= BLU_OPEN_USER_THRESHOLD;
  // Admins may offer Blu for testing even when the bar is not met.
  const adminBypass = isAdmin && !platformOpen && !eligibility.eligible;
  return {
    canOfferBlu: platformOpen || eligibility.eligible || isAdmin,
    platformOpen,
    eligible: eligibility.eligible,
    adminBypass,
    eligibility,
  };
}

/** The 403 message when a creator may not offer Blu yet. */
export const BLU_NOT_ELIGIBLE_MESSAGE =
  `Sweam Blu is limited to eligible creators for now: at least ${BLU_FUND_THRESHOLDS.minFollowers} followers, ` +
  `${BLU_FUND_THRESHOLDS.minViews.toLocaleString()} views, no violations in the last ${BLU_FUND_THRESHOLDS.violationWindowDays} days, ` +
  `and a verified 18+ age. See Studio to check your status.`;
