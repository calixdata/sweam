import type { ScoutMembership } from '@sweam/shared';
import { SCOUT_ALL_ACCESS_CENTS, SCOUT_BETA_FREE_LIMIT, SCOUT_BETA_TRIAL_DAYS } from '@sweam/shared';
import { nowIso } from './http';

/**
 * Scout membership = the scout portal + all-access to every creator's Sweam
 * Blu content, for one monthly fee. A scout never buys Blu separately.
 *
 * One `scout_all_access` row per scout is the membership. It is in good
 * standing when:
 *   - a card is on file (stripe_subscription_id set) and the Stripe webhook has
 *     not moved it off 'active' (canceled / past_due), or
 *   - no card is on file and current_period_end has not passed (the first-50
 *     free period; NULL means a complimentary membership that does not end).
 *
 * Every gate (portal, Blu playback, royalty attribution) reads the same
 * predicate so the rule cannot drift between surfaces.
 */

/** SQLite's current time in the same ISO shape nowIso() produces, for comparisons inside SQL. */
export const SQL_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** SQL predicate: the `scout_all_access` row aliased `alias` is in good standing. */
export function membershipActiveSql(alias = 'saa'): string {
  return (
    `(${alias}.status = 'active' AND (${alias}.stripe_subscription_id IS NOT NULL` +
    ` OR ${alias}.current_period_end IS NULL OR ${alias}.current_period_end > ${SQL_NOW}))`
  );
}

export interface MembershipRow {
  status: 'active' | 'canceled' | 'past_due' | null;
  current_period_end: string | null;
  trial_end: string | null;
  stripe_subscription_id: string | null;
  beta_free: number;
}

/** Pure description of a membership row at `now` (null status = no row yet). */
export function describeMembership(row: MembershipRow, now: string): ScoutMembership {
  const hasCard = Boolean(row.stripe_subscription_id);
  const periodEnd = row.current_period_end;
  const freeUntil = row.trial_end;
  const active =
    row.status === 'active' && (hasCard || periodEnd === null || periodEnd > now);
  const reason: ScoutMembership['reason'] = active
    ? null
    : row.status === null
      ? 'none'
      : row.status === 'past_due'
        ? 'past_due'
        : row.status === 'canceled'
          ? 'canceled'
          : 'ended';
  return {
    active,
    reason,
    freeUntil,
    inFreePeriod: freeUntil !== null && freeUntil > now,
    currentPeriodEnd: periodEnd,
    hasCard,
    betaFree: row.beta_free === 1,
    priceCents: SCOUT_ALL_ACCESS_CENTS,
  };
}

/** The membership of an APPROVED scout, or null when the account is not an approved scout. */
export async function loadScoutMembership(
  db: D1Database,
  userId: string,
): Promise<ScoutMembership | null> {
  const row = await db
    .prepare(
      `SELECT sp.status AS scout_status, sp.beta_free,
         saa.status, saa.current_period_end, saa.trial_end, saa.stripe_subscription_id
       FROM scout_profiles sp
       LEFT JOIN scout_all_access saa ON saa.user_id = sp.user_id
       WHERE sp.user_id = ?`,
    )
    .bind(userId)
    .first<MembershipRow & { scout_status: 'pending' | 'approved' | 'rejected' }>();
  if (!row || row.scout_status !== 'approved') return null;
  return describeMembership(row, nowIso());
}

/**
 * First-50 trial seats still open. A seat is claimed permanently (beta_free = 1)
 * when a free membership actually starts, so abandoned applications and demo
 * scouts never consume one, and a scout who later lapses does not free theirs up.
 */
export async function betaSeatsLeft(db: D1Database): Promise<number> {
  const claimed = await db
    .prepare('SELECT COUNT(*) AS n FROM scout_profiles WHERE beta_free = 1')
    .first<{ n: number }>();
  return Math.max(0, SCOUT_BETA_FREE_LIMIT - (claimed?.n ?? 0));
}

/** One free period per account: anyone who has ever held a membership is not eligible again. */
export async function trialEligible(db: D1Database, userId: string): Promise<boolean> {
  const prior = await db
    .prepare('SELECT 1 AS x FROM scout_all_access WHERE user_id = ?')
    .bind(userId)
    .first();
  return prior === null;
}

/** ISO timestamp `days` days after `fromIso`. */
export function daysAfter(fromIso: string, days: number): string {
  return new Date(Date.parse(fromIso) + days * 86_400_000).toISOString();
}

/**
 * Start a card-free first-50 membership for an approved scout (admin approval
 * without checkout). Returns the free-period end, or null when the scout is
 * not eligible or the seats are gone, in which case access needs a card.
 */
export async function grantFreeMembership(db: D1Database, userId: string): Promise<string | null> {
  const [seatsLeft, eligible] = await Promise.all([betaSeatsLeft(db), trialEligible(db, userId)]);
  if (seatsLeft <= 0 || !eligible) return null;
  const now = nowIso();
  const freeUntil = daysAfter(now, SCOUT_BETA_TRIAL_DAYS);
  await db.batch([
    db
      .prepare(
        `INSERT INTO scout_all_access (user_id, status, current_period_end, created_at, trial_end)
         VALUES (?, 'active', ?, ?, ?)`,
      )
      .bind(userId, freeUntil, now, freeUntil),
    db.prepare('UPDATE scout_profiles SET beta_free = 1 WHERE user_id = ?').bind(userId),
  ]);
  return freeUntil;
}
