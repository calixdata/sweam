import { Hono } from 'hono';
import type { TitleDetail } from '@sweam/shared';
import type { AppEnv } from '../env';
import type { CommentRow } from '../lib/comments';
import { buildCommentTree, countVisible } from '../lib/comments';
import { fail, nowIso, parseBody } from '../lib/http';
import type { EpisodeRow, TitleRow } from '../lib/mappers';
import { TITLE_FROM, TITLE_SELECT, mapEpisode, mapTitle } from '../lib/mappers';
import { notify } from '../lib/notify';
import { RATE_LIMITS, enforceRateLimit } from '../lib/ratelimit';
import { requireUser, currentUser } from '../lib/session';
import { commentCreateSchema } from '../lib/validate';

export const titleRoutes = new Hono<AppEnv>();

/** Public title page: published titles only. Creators preview drafts in the Studio. */
titleRoutes.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  const row = await c.env.DB.prepare(
    `SELECT ${TITLE_SELECT}, COALESCE(s.likes, 0) AS likes
     ${TITLE_FROM}
     LEFT JOIN title_stats s ON s.title_id = t.id
     WHERE t.slug = ? AND t.published = 1`,
  )
    .bind(slug)
    .first<TitleRow & { likes: number }>();
  if (!row) fail(404, 'title_not_found', 'That title does not exist or is not published.');

  const { results: episodeRows } = await c.env.DB.prepare(
    `SELECT id, season, episode, name, synopsis, video_url, captions_url, duration_s
     FROM episodes WHERE title_id = ? ORDER BY season, episode`,
  )
    .bind(row.id)
    .all<EpisodeRow>();

  const user = c.get('user');
  let likedByMe = false;
  let inMyWatchlist = false;
  if (user) {
    const [liked, listed] = await c.env.DB.batch([
      c.env.DB.prepare('SELECT 1 AS x FROM likes WHERE user_id = ? AND title_id = ?').bind(user.id, row.id),
      c.env.DB.prepare('SELECT 1 AS x FROM watchlist WHERE user_id = ? AND title_id = ?').bind(
        user.id,
        row.id,
      ),
    ]);
    likedByMe = (liked?.results?.length ?? 0) > 0;
    inMyWatchlist = (listed?.results?.length ?? 0) > 0;
  }

  const payload: TitleDetail = {
    ...mapTitle(row),
    episodes: episodeRows.map(mapEpisode),
    likes: row.likes,
    likedByMe,
    inMyWatchlist,
  };
  return c.json(payload);
});

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

async function publishedTitleBySlug(
  db: D1Database,
  slug: string,
): Promise<{ id: string; creator_id: string; name: string; slug: string }> {
  const row = await db
    .prepare('SELECT id, creator_id, name, slug FROM titles WHERE slug = ? AND published = 1')
    .bind(slug)
    .first<{ id: string; creator_id: string; name: string; slug: string }>();
  if (!row) fail(404, 'title_not_found', 'That title does not exist or is not published.');
  return row;
}

const COMMENTS_QUERY = `
  SELECT co.id, co.parent_id, co.body, co.status, co.created_at,
    u.id AS author_id, u.display_name AS author_name, cp.handle AS author_handle
  FROM comments co
  JOIN users u ON u.id = co.author_id
  LEFT JOIN creator_profiles cp ON cp.user_id = co.author_id
  WHERE co.title_id = ?
  ORDER BY co.created_at
  LIMIT 500
`;

titleRoutes.get('/:slug/comments', async (c) => {
  const title = await publishedTitleBySlug(c.env.DB, c.req.param('slug'));
  const { results } = await c.env.DB.prepare(COMMENTS_QUERY).bind(title.id).all<CommentRow>();
  const comments = buildCommentTree(results, {
    titleCreatorId: title.creator_id,
    viewerId: c.get('user')?.id ?? null,
  });
  return c.json({ comments, visibleCount: countVisible(comments) });
});

titleRoutes.post('/:slug/comments', requireUser, async (c) => {
  const user = currentUser(c);
  await enforceRateLimit(c.env.DB, RATE_LIMITS.comment, user.id);
  const title = await publishedTitleBySlug(c.env.DB, c.req.param('slug'));
  const body = await parseBody(c, commentCreateSchema);

  let parentAuthorId: string | null = null;
  if (body.parentId) {
    const parent = await c.env.DB.prepare(
      `SELECT author_id FROM comments
       WHERE id = ? AND title_id = ? AND parent_id IS NULL AND status = 'visible'`,
    )
      .bind(body.parentId, title.id)
      .first<{ author_id: string }>();
    if (!parent) {
      fail(404, 'parent_not_found', 'You can only reply to a visible top-level comment on this title.');
    }
    parentAuthorId = parent.author_id;
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO comments (id, title_id, author_id, parent_id, body, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'visible', ?)`,
  )
    .bind(id, title.id, user.id, body.parentId, body.body, nowIso())
    .run();

  // The creator hears about conversation on their title; a replied-to author
  // hears about the reply. Nobody is notified about their own comment.
  if (parentAuthorId && parentAuthorId !== user.id) {
    await notify(
      c.env.DB,
      parentAuthorId,
      'comment',
      `${user.displayName} replied to your comment on ${title.name}.`,
      `/t/${title.slug}`,
    );
  }
  if (title.creator_id !== user.id && title.creator_id !== parentAuthorId) {
    await notify(
      c.env.DB,
      title.creator_id,
      'comment',
      `${user.displayName} commented on ${title.name}.`,
      `/t/${title.slug}`,
    );
  }
  return c.json({ id }, 201);
});
