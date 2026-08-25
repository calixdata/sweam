import { Hono } from 'hono';
import type { TitleDetail } from '@sweam/shared';
import type { AppEnv } from '../env';
import { fail } from '../lib/http';
import type { EpisodeRow, TitleRow } from '../lib/mappers';
import { TITLE_FROM, TITLE_SELECT, mapEpisode, mapTitle } from '../lib/mappers';

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
