import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { fail, nowIso } from '../lib/http';
import type { TitleRow } from '../lib/mappers';
import { TITLE_FROM, TITLE_SELECT, mapTitle } from '../lib/mappers';
import { requireUser, currentUser } from '../lib/session';

/** Signed-in viewer state: watchlist and likes. */
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
  // Only bump the counter when a row was actually inserted (idempotent likes).
  if (result.meta.changes > 0) {
    await c.env.DB.prepare('UPDATE title_stats SET likes = likes + 1 WHERE title_id = ?')
      .bind(titleId)
      .run();
  }
  return c.json({ likedByMe: true });
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
