import { Hono } from 'hono';
import type { ContentKind, FeedItem } from '@sweam/shared';
import type { AppEnv } from '../env';
import { audienceSql, loadAudiencePref } from '../lib/audience';
import { notBlockedBy } from '../lib/blocks';
import { requireUser, currentUser } from '../lib/session';

/**
 * The vertical, swipe-up feed for the mobile app: published titles, newest
 * first, each paired with its first episode's playable URL and live engagement
 * counts, so a client can autoplay and show like/comment state in one request.
 * Watching is gated, so this requires a signed-in account.
 */
export const feedRoutes = new Hono<AppEnv>();

feedRoutes.use('*', requireUser);

interface FeedRow {
  title_id: string;
  slug: string;
  name: string;
  kind: ContentKind;
  synopsis: string;
  creator_name: string;
  creator_avatar: string | null;
  creator_verified: number | null;
  creator_handle: string;
  poster_url: string | null;
  episode_id: string;
  video_url: string;
  published_at: string | null;
  views: number;
  likes: number;
  comment_count: number;
  liked_by_me: number;
  is_blu: number;
  promoted_by: string | null;
  media_type: 'video' | 'image' | null;
}

const PAGE = 20;
/** How many active promotions to pin at the top of the first feed page. */
const MAX_PINNED_PROMOS = 10;

/** The columns + joins every feed row needs (one playable episode per title). */
const FEED_SELECT = `
  SELECT t.id AS title_id, t.slug, t.name, t.kind, t.synopsis,
    u.display_name AS creator_name, u.avatar_url AS creator_avatar, u.verified AS creator_verified,
    cp.handle AS creator_handle, t.poster_url,
    t.is_blu AS is_blu, t.promoted_by AS promoted_by,
    e.id AS episode_id, e.video_url, e.media_type, t.published_at,
    COALESCE(s.plays, 0) AS views, COALESCE(s.likes, 0) AS likes,
    (SELECT COUNT(*) FROM comments co WHERE co.title_id = t.id AND co.status = 'visible') AS comment_count,
    (SELECT COUNT(*) FROM likes l WHERE l.title_id = t.id AND l.user_id = ?1) AS liked_by_me
  FROM titles t
  JOIN users u ON u.id = t.creator_id
  JOIN creator_profiles cp ON cp.user_id = t.creator_id
  LEFT JOIN title_stats s ON s.title_id = t.id
  JOIN episodes e ON e.id = (
    SELECT id FROM episodes WHERE title_id = t.id
      AND (release_at IS NULL OR release_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ORDER BY season, episode LIMIT 1
  )
`;

function toFeedItem(row: FeedRow): FeedItem {
  return {
    titleId: row.title_id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    synopsis: row.synopsis,
    creator: {
      handle: row.creator_handle,
      displayName: row.creator_name,
      avatarUrl: row.creator_avatar,
      verified: row.creator_verified === 1,
    },
    episodeId: row.episode_id,
    videoUrl: row.video_url,
    posterUrl: row.poster_url,
    views: row.views,
    likes: row.likes,
    commentCount: row.comment_count,
    likedByMe: row.liked_by_me > 0,
    isBlu: row.is_blu === 1,
    promotedBy: row.promoted_by,
    mediaType: row.media_type === 'image' ? 'image' : 'video',
  };
}

feedRoutes.get('/', async (c) => {
  const user = currentUser(c);
  // Keyset pagination on published_at: pass the last item's `nextCursor` as ?before=.
  const before = c.req.query('before') ?? '';
  // ?following=1 narrows the feed to clips from creators the viewer follows.
  const following = c.req.query('following') === '1' ? 1 : 0;
  // The viewer's audience preference (women-only / men-only For You).
  const aud = audienceSql(await loadAudiencePref(c.env.DB, user.id), 'u');

  // Promotion boost: pin active promotions at the top of the first page. They are
  // excluded from the chronological stream below (promoted_at IS NULL), so they
  // show once and never repeat as the viewer scrolls.
  let promoted: FeedRow[] = [];
  if (before === '') {
    const res = await c.env.DB.prepare(
      `${FEED_SELECT}
       WHERE t.published = 1 AND t.is_blu = 0 AND t.promoted_at IS NOT NULL
         AND ${notBlockedBy('?1', 't.creator_id')}${aud}
         AND (?2 = 0 OR EXISTS (
           SELECT 1 FROM follows f WHERE f.follower_id = ?1 AND f.creator_id = t.creator_id
         ))
       ORDER BY t.promoted_at DESC
       LIMIT ${MAX_PINNED_PROMOS}`,
    )
      .bind(user.id, following)
      .all<FeedRow>();
    promoted = res.results;
  }

  const rows = await c.env.DB.prepare(
    `${FEED_SELECT}
     WHERE t.published = 1 AND t.is_blu = 0 AND t.promoted_at IS NULL AND (?2 = '' OR t.published_at < ?2)
       AND ${notBlockedBy('?1', 't.creator_id')}${aud}
       AND (?3 = 0 OR EXISTS (
         SELECT 1 FROM follows f WHERE f.follower_id = ?1 AND f.creator_id = t.creator_id
       ))
     ORDER BY t.published_at DESC
     LIMIT ${PAGE}`,
  )
    .bind(user.id, before, following)
    .all<FeedRow>();

  const items: FeedItem[] = [...promoted, ...rows.results].map(toFeedItem);

  // The cursor tracks only the chronological stream, so paging never re-shows a
  // pinned promotion.
  const last = rows.results.at(-1);
  const nextCursor = rows.results.length === PAGE && last ? last.published_at : null;
  return c.json({ items, nextCursor });
});
