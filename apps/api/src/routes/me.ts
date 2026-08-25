import { Hono } from 'hono';
import type { NotificationItem } from '@sweam/shared';
import type { AppEnv } from '../env';
import { fail, nowIso, parseBody } from '../lib/http';
import type { TitleRow } from '../lib/mappers';
import { TITLE_FROM, TITLE_SELECT, mapTitle } from '../lib/mappers';
import { RATE_LIMITS, enforceRateLimit } from '../lib/ratelimit';
import { requireUser, currentUser } from '../lib/session';
import { reportCreateSchema } from '../lib/validate';

/** Signed-in viewer state: watchlist, likes, reports, and notifications. */
export const meRoutes = new Hono<AppEnv>();

meRoutes.use('*', requireUser);

meRoutes.get('/watchlist', async (c) => {
  const user = currentUser(c);
  const { results } = await c.env.DB.prepare(
    `SELECT ${TITLE_SELECT}
     ${TITLE_FROM}
     JOIN watchlist w ON w.title_id = t.id
     WHERE w.user_id = ? AND t.published = 1
     ORDER BY w.added_at DESC`,
  )
    .bind(user.id)
    .all<TitleRow>();
  return c.json({ titles: results.map(mapTitle) });
});

async function assertPublishedTitle(db: D1Database, titleId: string): Promise<void> {
  const exists = await db
    .prepare('SELECT 1 AS x FROM titles WHERE id = ? AND published = 1')
    .bind(titleId)
    .first();
  if (!exists) fail(404, 'title_not_found', 'That title does not exist or is not published.');
}

meRoutes.put('/watchlist/:titleId', async (c) => {
  const user = currentUser(c);
  const titleId = c.req.param('titleId');
  await assertPublishedTitle(c.env.DB, titleId);
  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO watchlist (user_id, title_id, added_at) VALUES (?, ?, ?)',
  )
    .bind(user.id, titleId, nowIso())
    .run();
  return c.json({ inMyWatchlist: true });
});

meRoutes.delete('/watchlist/:titleId', async (c) => {
  const user = currentUser(c);
  await c.env.DB.prepare('DELETE FROM watchlist WHERE user_id = ? AND title_id = ?')
    .bind(user.id, c.req.param('titleId'))
    .run();
  return c.json({ inMyWatchlist: false });
});

meRoutes.put('/likes/:titleId', async (c) => {
  const user = currentUser(c);
  const titleId = c.req.param('titleId');
  await assertPublishedTitle(c.env.DB, titleId);
  const result = await c.env.DB.prepare(
    'INSERT OR IGNORE INTO likes (user_id, title_id, created_at) VALUES (?, ?, ?)',
  )
    .bind(user.id, titleId, nowIso())
    .run();
  // Only bump the counters when a row was actually inserted (idempotent likes).
  // Daily likes count like events and are never decremented; lifetime stats
  // stay authoritative for net totals.
  if (result.meta.changes > 0) {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE title_stats SET likes = likes + 1 WHERE title_id = ?').bind(titleId),
      c.env.DB.prepare(
        `INSERT INTO title_stats_daily (title_id, day, impressions, plays, completes, likes, watch_seconds)
         VALUES (?, date('now'), 0, 0, 0, 1, 0)
         ON CONFLICT (title_id, day) DO UPDATE SET likes = likes + 1`,
      ).bind(titleId),
    ]);
  }
  return c.json({ likedByMe: true });
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

meRoutes.post('/reports', async (c) => {
  const user = currentUser(c);
  await enforceRateLimit(c.env.DB, RATE_LIMITS.report, user.id);
  const body = await parseBody(c, reportCreateSchema);
  await assertPublishedTitle(c.env.DB, body.titleId);

  const result = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO reports (id, title_id, reporter_id, reason, note, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?)`,
  )
    .bind(crypto.randomUUID(), body.titleId, user.id, body.reason, body.note, nowIso())
    .run();
  if (result.meta.changes === 0) {
    fail(409, 'already_reported', 'You already reported this title. Our moderators will review it.');
  }
  return c.json({ reported: true }, 201);
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

interface NotificationRow {
  id: string;
  kind: NotificationItem['kind'];
  body: string;
  link: string | null;
  read: number;
  created_at: string;
}

meRoutes.get('/notifications', async (c) => {
  const user = currentUser(c);
  const { results } = await c.env.DB.prepare(
    `SELECT id, kind, body, link, read, created_at
     FROM notifications WHERE user_id = ?
     ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(user.id)
    .all<NotificationRow>();
  const notifications: NotificationItem[] = results.map((row) => ({
    id: row.id,
    kind: row.kind,
    body: row.body,
    link: row.link,
    read: row.read === 1,
    createdAt: row.created_at,
  }));
  return c.json({ notifications });
});

meRoutes.get('/notifications/unread-count', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0',
  )
    .bind(currentUser(c).id)
    .first<{ n: number }>();
  return c.json({ unread: row?.n ?? 0 });
});

meRoutes.post('/notifications/read-all', async (c) => {
  await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0')
    .bind(currentUser(c).id)
    .run();
  return c.json({ ok: true });
});

meRoutes.delete('/likes/:titleId', async (c) => {
  const user = currentUser(c);
  const titleId = c.req.param('titleId');
  const result = await c.env.DB.prepare('DELETE FROM likes WHERE user_id = ? AND title_id = ?')
    .bind(user.id, titleId)
    .run();
  if (result.meta.changes > 0) {
    await c.env.DB.prepare(
      'UPDATE title_stats SET likes = MAX(likes - 1, 0) WHERE title_id = ?',
    )
      .bind(titleId)
      .run();
  }
  return c.json({ likedByMe: false });
});
