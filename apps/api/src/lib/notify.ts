import type { NotificationKind } from '@sweam/shared';
import { nowIso } from './http';

/**
 * In-app notifications. Body text is rendered at write time so the
 * notifications list is a plain read with no joins, and a notification stays
 * accurate even if the thing it describes is later renamed or deleted.
 */
export async function notify(
  db: D1Database,
  userId: string,
  kind: NotificationKind,
  body: string,
  link: string | null = null,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO notifications (id, user_id, kind, body, link, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
    )
    .bind(crypto.randomUUID(), userId, kind, body, link, nowIso())
    .run();
}

/**
 * Fan a notification out to everyone following a creator, as one
 * INSERT...SELECT. Fine at current scale; at large follower counts this
 * becomes a queued job, noted in ARCHITECTURE.md.
 */
export async function notifyFollowers(
  db: D1Database,
  creatorId: string,
  kind: NotificationKind,
  body: string,
  link: string | null = null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO notifications (id, user_id, kind, body, link, read, created_at)
       SELECT lower(hex(randomblob(16))), follower_id, ?, ?, ?, 0, ?
       FROM follows WHERE creator_id = ?`,
    )
    .bind(kind, body, link, nowIso(), creatorId)
    .run();
}
