import { fail } from './http';

/**
 * Creator account standing. Strikes are issued by admins during moderation;
 * three active (non-revoked) strikes inside a rolling 90-day window suspend
 * publishing, uploading, and creating titles. Watching is never suspended.
 */

export const STRIKE_WINDOW_DAYS = 90;
export const SUSPENSION_STRIKES = 3;

export function strikeCutoffIso(nowMs = Date.now()): string {
  return new Date(nowMs - STRIKE_WINDOW_DAYS * 86_400_000).toISOString();
}

export async function activeStrikeCount(db: D1Database, creatorId: string): Promise<number> {
  const row = await db
    .prepare(
      'SELECT COUNT(*) AS n FROM strikes WHERE creator_id = ? AND revoked_at IS NULL AND created_at >= ?',
    )
    .bind(creatorId, strikeCutoffIso())
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function assertGoodStanding(db: D1Database, creatorId: string): Promise<void> {
  if ((await activeStrikeCount(db, creatorId)) >= SUSPENSION_STRIKES) {
    fail(
      403,
      'suspended',
      `Publishing is suspended: ${SUSPENSION_STRIKES} or more active strikes on this account. Check your notifications for details.`,
    );
  }
}
