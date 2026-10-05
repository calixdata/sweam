import { nowIso } from './http';
import { membershipActiveSql } from './scoutMembership';

/**
 * True when `userId` may view a creator's Sweam Blu content: the creator
 * themselves, an active Blu subscriber of that creator, or an approved scout
 * whose membership is in good standing (scout access includes all-access to
 * Blu; scouts never pay for Blu separately). Signed-out users never have access.
 */
export async function hasBluAccess(
  db: D1Database,
  userId: string | null,
  creatorId: string,
): Promise<boolean> {
  if (!userId) return false;
  if (userId === creatorId) return true;
  const now = nowIso();
  const sub = await db
    .prepare(
      `SELECT 1 AS x FROM blu_subscriptions
       WHERE subscriber_id = ? AND creator_id = ? AND status = 'active'
         AND (current_period_end IS NULL OR current_period_end > ?)`,
    )
    .bind(userId, creatorId, now)
    .first();
  if (sub) return true;
  return isActiveScout(db, userId);
}

/** An approved scout with a membership in good standing (the same rule the portal uses). */
export async function isActiveScout(db: D1Database, userId: string): Promise<boolean> {
  const scout = await db
    .prepare(
      `SELECT 1 AS x FROM scout_profiles sp
       JOIN scout_all_access saa ON saa.user_id = sp.user_id
       WHERE sp.user_id = ? AND sp.status = 'approved' AND ${membershipActiveSql('saa')}`,
    )
    .bind(userId)
    .first();
  return scout !== null;
}
