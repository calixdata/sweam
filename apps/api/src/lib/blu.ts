import { nowIso } from './http';

/**
 * True when `userId` may view a creator's Sweam Blu content: the creator
 * themselves, an active Blu subscriber of that creator, or a scout with active
 * all-access. Signed-out users never have Blu access.
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
  const scout = await db
    .prepare(
      `SELECT 1 AS x FROM scout_all_access
       WHERE user_id = ? AND status = 'active'
         AND (current_period_end IS NULL OR current_period_end > ?)`,
    )
    .bind(userId, now)
    .first();
  return scout !== null;
}
