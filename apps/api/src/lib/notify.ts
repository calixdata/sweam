import type { NotificationKind } from '@sweam/shared';
import { CONTENT_KIND_LABELS } from '@sweam/shared';
import type { ContentKind } from '@sweam/shared';
import { nowIso } from './http';
import { parseJsonArray } from './mappers';
import { sendPushToFollowers, sendPushToUser } from './fcm';

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
  // Best-effort device push on top of the durable in-app notification.
  try {
    await sendPushToUser(db, userId, 'Sweam', body, link);
  } catch {
    /* push failures never break the write */
  }
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
  try {
    await sendPushToFollowers(db, creatorId, 'Sweam', body, link);
  } catch {
    /* best-effort */
  }
}

/**
 * Alert approved scouts, once per title, when a title first becomes published
 * AND scoutable. Each scout can turn these off and narrow them to the genres and
 * content kinds they scout for (empty = all). The `scouts_notified_at` guard
 * means re-publishing or re-toggling scoutable never re-pings. Small scale: a JS
 * filter plus a write per matching scout; this becomes a queued job at large
 * scout counts (noted in ARCHITECTURE.md alongside notifyFollowers).
 */
export async function notifyScoutsOfTitle(db: D1Database, titleId: string): Promise<void> {
  const title = await db
    .prepare(
      `SELECT id, name, genre, kind, published, scoutable, scouts_notified_at
       FROM titles WHERE id = ?`,
    )
    .bind(titleId)
    .first<{
      id: string;
      name: string;
      genre: string;
      kind: ContentKind;
      published: number;
      scoutable: number;
      scouts_notified_at: string | null;
    }>();
  if (!title || title.published !== 1 || title.scoutable !== 1 || title.scouts_notified_at) return;

  const { results } = await db
    .prepare(
      "SELECT user_id, notify_genres, notify_kinds FROM scout_profiles WHERE status = 'approved' AND notify_enabled = 1",
    )
    .all<{ user_id: string; notify_genres: string | null; notify_kinds: string | null }>();

  const kindLabel = CONTENT_KIND_LABELS[title.kind] ?? title.kind;
  const body = `New to scout: "${title.name}" — ${kindLabel}, ${title.genre}.`;
  const link = `/scout/t/${title.id}`;

  for (const scout of results) {
    const genres = parseJsonArray(scout.notify_genres);
    const kinds = parseJsonArray(scout.notify_kinds);
    const genreOk = genres.length === 0 || genres.includes(title.genre);
    const kindOk = kinds.length === 0 || kinds.includes(title.kind);
    if (genreOk && kindOk) {
      await notify(db, scout.user_id, 'scout_content', body, link);
    }
  }
  await db
    .prepare('UPDATE titles SET scouts_notified_at = ? WHERE id = ?')
    .bind(nowIso(), title.id)
    .run();
}
