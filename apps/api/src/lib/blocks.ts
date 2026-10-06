/**
 * User blocking. One-directional and private: the blocker stops seeing the
 * blocked account's content and comments; neither can follow the other.
 */

/**
 * SQL fragment that is true when the viewer (bound as the given placeholder)
 * has NOT blocked the user in `userColumn`. An anonymous viewer binds '' and
 * sees everything.
 */
export function notBlockedBy(viewerParam: string, userColumn: string): string {
  return `NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = ${viewerParam} AND b.blocked_id = ${userColumn})`;
}

/** True when either account has blocked the other. */
export async function blockedEitherWay(db: D1Database, a: string, b: string): Promise<boolean> {
  const hit = await db
    .prepare(
      `SELECT 1 AS x FROM blocks
       WHERE (blocker_id = ?1 AND blocked_id = ?2) OR (blocker_id = ?2 AND blocked_id = ?1)
       LIMIT 1`,
    )
    .bind(a, b)
    .first();
  return hit !== null;
}
