import { Hono } from 'hono';
import type { CreatorPublicPage } from '@sweam/shared';
import type { AppEnv } from '../env';
import { fail, nowIso } from '../lib/http';
import type { TitleRow } from '../lib/mappers';
import { TITLE_FROM, TITLE_SELECT, mapTitle } from '../lib/mappers';
import { notify } from '../lib/notify';
import { requireUser, currentUser } from '../lib/session';

/**
 * Public profile pages and the follow relationship. Every account has a
 * profile at its @username (a creator's handle equals its username), so a
 * username found in search always opens; only creators have published titles.
 */
export const creatorRoutes = new Hono<AppEnv>();

interface CreatorRow {
  user_id: string;
  handle: string;
  bio: string;
  verified: number;
  display_name: string;
  avatar_url: string | null;
  is_creator: number;
}

async function creatorByHandle(db: D1Database, handle: string): Promise<CreatorRow> {
  const row = await db
    .prepare(
      `SELECT u.id AS user_id, COALESCE(cp.handle, u.username) AS handle,
         COALESCE(cp.bio, '') AS bio, COALESCE(cp.verified, 0) AS verified,
         u.display_name, u.avatar_url, (cp.user_id IS NOT NULL) AS is_creator
       FROM users u
       LEFT JOIN creator_profiles cp ON cp.user_id = u.id
       WHERE (cp.handle = ? OR u.username = ? COLLATE NOCASE)
         AND u.email_verified = 1
         AND (cp.user_id IS NOT NULL OR u.is_demo = 0)
       ORDER BY (cp.handle = ?) DESC
       LIMIT 1`,
    )
    .bind(handle, handle, handle)
    .first<CreatorRow>();
  if (!row) fail(404, 'creator_not_found', 'No account with that username.');
  return row;
}

creatorRoutes.get('/:handle', async (c) => {
  const creator = await creatorByHandle(c.env.DB, c.req.param('handle'));
  const viewer = c.get('user');

  const [followerCount, followedByMe, titlesResult] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM follows WHERE creator_id = ?')
      .bind(creator.user_id)
      .first<{ n: number }>()
      .then((row) => row?.n ?? 0),
    viewer
      ? c.env.DB.prepare('SELECT 1 AS x FROM follows WHERE follower_id = ? AND creator_id = ?')
          .bind(viewer.id, creator.user_id)
          .first()
          .then((hit) => hit !== null)
      : Promise.resolve(false),
    c.env.DB.prepare(
      `SELECT ${TITLE_SELECT}
       ${TITLE_FROM}
       WHERE t.creator_id = ? AND t.published = 1
       ORDER BY t.published_at DESC
       LIMIT 60`,
    )
      .bind(creator.user_id)
      .all<TitleRow>(),
  ]);

  const payload: CreatorPublicPage = {
    handle: creator.handle,
    displayName: creator.display_name,
    avatarUrl: creator.avatar_url,
    bio: creator.bio,
    verified: creator.verified === 1,
    isCreator: creator.is_creator === 1,
    followerCount,
    followedByMe,
    titles: titlesResult.results.map(mapTitle),
  };
  return c.json(payload);
});

creatorRoutes.put('/:handle/follow', requireUser, async (c) => {
  const user = currentUser(c);
  const creator = await creatorByHandle(c.env.DB, c.req.param('handle'));
  if (creator.user_id === user.id) {
    fail(400, 'self_follow', 'You cannot follow yourself.');
  }
  const result = await c.env.DB.prepare(
    'INSERT OR IGNORE INTO follows (follower_id, creator_id, created_at) VALUES (?, ?, ?)',
  )
    .bind(user.id, creator.user_id, nowIso())
    .run();
  if (result.meta.changes > 0) {
    await notify(
      c.env.DB,
      creator.user_id,
      'follow',
      `${user.displayName} started following you.`,
      `/c/${creator.handle}`,
    );
  }
  return c.json({ followedByMe: true });
});

creatorRoutes.delete('/:handle/follow', requireUser, async (c) => {
  const user = currentUser(c);
  const creator = await creatorByHandle(c.env.DB, c.req.param('handle'));
  await c.env.DB.prepare('DELETE FROM follows WHERE follower_id = ? AND creator_id = ?')
    .bind(user.id, creator.user_id)
    .run();
  return c.json({ followedByMe: false });
});
