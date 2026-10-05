import { Hono } from 'hono';
import type {
  AccountSearchResult,
  ContinueWatchingItem,
  HomePayload,
  Rail,
  SearchResults,
  TitleSummary,
} from '@sweam/shared';
import { CONTENT_KINDS, GENRES } from '@sweam/shared';
import type { AppEnv } from '../env';
import { fail } from '../lib/http';
import type { TitleRow, TitleStatsRow } from '../lib/mappers';
import { TITLE_FROM, TITLE_SELECT, likeEscape, mapTitle } from '../lib/mappers';
import { DEFAULT_WEIGHTS, rankTitles } from '../lib/ranking';
import { searchQuerySchema } from '../lib/validate';

export const catalogRoutes = new Hono<AppEnv>();

type CatalogRow = TitleRow & TitleStatsRow & { featured: number };

const CATALOG_QUERY = `
  SELECT ${TITLE_SELECT},
    t.featured AS featured,
    COALESCE(s.impressions, 0) AS impressions,
    COALESCE(s.plays, 0) AS plays,
    COALESCE(s.completes, 0) AS completes,
    COALESCE(s.likes, 0) AS likes
  ${TITLE_FROM}
  LEFT JOIN title_stats s ON s.title_id = t.id
  WHERE t.published = 1
  ORDER BY t.published_at DESC
`;

const RAIL_SIZE = 12;
const SPOTLIGHT_SIZE = 10;

/**
 * Home is a single catalog read shaped into rails in code: a ranked Spotlight,
 * New This Week, then one rail per genre with published titles.
 */
catalogRoutes.get('/home', async (c) => {
  const { results } = await c.env.DB.prepare(CATALOG_QUERY).all<CatalogRow>();
  const nowMs = Date.now();
  const catalogImpressions = results.reduce((sum, row) => sum + row.impressions, 0);

  // Clips are the feed experience; the catalog rails below are longer-form only,
  // with clips gathered into their own rail.
  const longform = results.filter((row) => row.kind !== 'short');
  const clipRows = results.filter((row) => row.kind === 'short');

  const ranked = rankTitles(
    longform,
    (row) => ({
      publishedAtMs: row.published_at ? Date.parse(row.published_at) : nowMs,
      impressions: row.impressions,
      plays: row.plays,
      completes: row.completes,
      likes: row.likes,
    }),
    { nowMs, catalogImpressions, weights: DEFAULT_WEIGHTS },
  ).map((entry) => mapTitle(entry.item));

  // Editorially featured titles are pinned to the front of the spotlight so the
  // home hero shows them; the rest follow in ranked order.
  const featured = longform.filter((row) => row.featured === 1).map(mapTitle);
  const seen = new Set(featured.map((t) => t.id));
  const spotlight = [...featured, ...ranked.filter((t) => !seen.has(t.id))].slice(0, SPOTLIGHT_SIZE);

  const weekAgoIso = new Date(nowMs - 7 * 86_400_000).toISOString();
  const newThisWeek = longform
    .filter((row) => row.published_at !== null && row.published_at >= weekAgoIso)
    .slice(0, RAIL_SIZE)
    .map(mapTitle);

  const byGenre = new Map<string, TitleSummary[]>();
  for (const row of longform) {
    const rail = byGenre.get(row.genre) ?? [];
    if (rail.length < RAIL_SIZE) rail.push(mapTitle(row));
    byGenre.set(row.genre, rail);
  }

  const rails: Rail[] = [];
  const user = c.get('user');
  if (user) {
    const { results: followingRows } = await c.env.DB.prepare(
      `SELECT ${TITLE_SELECT}
       ${TITLE_FROM}
       JOIN follows f ON f.creator_id = t.creator_id
       WHERE f.follower_id = ? AND t.published = 1
       ORDER BY t.published_at DESC
       LIMIT ${RAIL_SIZE}`,
    )
      .bind(user.id)
      .all<TitleRow>();
    if (followingRows.length > 0) {
      rails.push({
        key: 'following',
        heading: 'From creators you follow',
        titles: followingRows.map(mapTitle),
      });
    }
  }
  rails.push({ key: 'spotlight', heading: 'Spotlight', titles: spotlight });
  if (newThisWeek.length > 0) {
    rails.push({ key: 'new', heading: 'New this week', titles: newThisWeek });
  }
  const clips = [...clipRows]
    .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
    .slice(0, RAIL_SIZE)
    .map(mapTitle);
  if (clips.length > 0) {
    rails.push({ key: 'clips', heading: 'Clips', titles: clips });
  }
  for (const [genre, titles] of byGenre) {
    rails.push({ key: `genre-${genre.toLowerCase()}`, heading: genre, titles });
  }

  const payload: HomePayload = {
    continueWatching: await continueWatching(c.env.DB, user?.id ?? null),
    rails: rails.filter((rail) => rail.titles.length > 0),
  };

  // Spotlight placements count as discovery impressions for the ranking loop.
  await recordImpressions(c.env.DB, spotlight.map((t) => t.id));

  return c.json(payload);
});

/** The browse grid: the published catalog filtered by genre and kind. */
catalogRoutes.get('/browse', async (c) => {
  const genre = c.req.query('genre') ?? '';
  const kind = c.req.query('kind') ?? '';
  const sort = c.req.query('sort') ?? 'new';
  if (genre && !(GENRES as readonly string[]).includes(genre)) {
    fail(400, 'bad_genre', 'Unknown genre.');
  }
  if (kind && !(CONTENT_KINDS as readonly string[]).includes(kind)) {
    fail(400, 'bad_kind', 'Unknown kind.');
  }
  if (sort !== 'new' && sort !== 'popular') fail(400, 'bad_sort', 'Sort is new or popular.');

  // Clips live in the For You feed, not the catalog — Browse is longer-form only.
  const conditions = ['t.published = 1', "t.kind != 'short'"];
  const bindings: string[] = [];
  if (genre) {
    conditions.push('t.genre = ?');
    bindings.push(genre);
  }
  if (kind) {
    conditions.push('t.kind = ?');
    bindings.push(kind);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT ${TITLE_SELECT}, COALESCE(s.plays, 0) AS plays
     ${TITLE_FROM}
     LEFT JOIN title_stats s ON s.title_id = t.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY ${sort === 'popular' ? 's.plays DESC, t.published_at DESC' : 't.published_at DESC'}
     LIMIT 60`,
  )
    .bind(...bindings)
    .all<TitleRow>();

  return c.json({ titles: results.map(mapTitle) });
});

interface AccountRow {
  username: string;
  display_name: string;
  avatar_url: string | null;
  handle: string | null;
  verified: number | null;
  follower_count: number;
  published_titles: number;
}

/**
 * Search returns accounts and titles. A username search ("@scionsaga" or
 * "scionsaga") finds the account itself, creator or not, with exact username
 * matches first; titles match on name, synopsis, or creator. Seed viewer
 * accounts and accounts that never finished sign-up are not listed.
 */
catalogRoutes.get('/search', async (c) => {
  const parsed = searchQuerySchema.safeParse({ q: c.req.query('q') ?? '' });
  if (!parsed.success) fail(400, 'validation_failed', parsed.error.issues[0]?.message ?? 'Invalid search.');
  const query = parsed.data.q;
  // A leading @ means "find this username"; it is not part of the name.
  const term = query.replace(/^@+/, '').trim();
  const pattern = `%${likeEscape(term)}%`;
  const prefix = `${likeEscape(term)}%`;

  if (term === '') return c.json({ query, accounts: [], results: [] });

  const [accountsResult, titlesResult] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT u.username, u.display_name, u.avatar_url, cp.handle, cp.verified,
         (SELECT COUNT(*) FROM follows f WHERE f.creator_id = u.id) AS follower_count,
         (SELECT COUNT(*) FROM titles t WHERE t.creator_id = u.id AND t.published = 1) AS published_titles
       FROM users u
       LEFT JOIN creator_profiles cp ON cp.user_id = u.id
       WHERE u.email_verified = 1 AND u.username IS NOT NULL
         AND (cp.user_id IS NOT NULL OR u.is_demo = 0)
         AND (u.username LIKE ? ESCAPE '\\'
              OR u.display_name LIKE ? ESCAPE '\\'
              OR cp.handle LIKE ? ESCAPE '\\')
       ORDER BY (lower(u.username) = lower(?)) DESC,
         (u.username LIKE ? ESCAPE '\\') DESC,
         follower_count DESC, u.username
       LIMIT 20`,
    ).bind(pattern, pattern, pattern, term, prefix),
    c.env.DB.prepare(
      `SELECT ${TITLE_SELECT}
       ${TITLE_FROM}
       WHERE t.published = 1
         AND (t.name LIKE ? ESCAPE '\\'
              OR t.synopsis LIKE ? ESCAPE '\\'
              OR cp.handle LIKE ? ESCAPE '\\'
              OR u.display_name LIKE ? ESCAPE '\\')
       ORDER BY t.published_at DESC
       LIMIT 25`,
    ).bind(pattern, pattern, pattern, pattern),
  ]);

  const accounts: AccountSearchResult[] = ((accountsResult?.results ?? []) as AccountRow[]).map(
    (row) => ({
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      isCreator: row.handle !== null,
      verified: row.verified === 1,
      followerCount: row.follower_count,
      publishedTitles: row.published_titles,
    }),
  );
  const results = ((titlesResult?.results ?? []) as TitleRow[]).map(mapTitle);
  const payload: SearchResults = { query, accounts, results };
  return c.json(payload);
});

async function continueWatching(db: D1Database, userId: string | null): Promise<ContinueWatchingItem[]> {
  if (!userId) return [];
  const { results } = await db
    .prepare(
      `SELECT ${TITLE_SELECT},
        e.id AS episode_id, e.name AS episode_name,
        p.position_s, p.duration_s, MAX(p.updated_at) AS updated_at
       FROM progress p
       JOIN episodes e ON e.id = p.episode_id
       JOIN titles t ON t.id = e.title_id
       JOIN users u ON u.id = t.creator_id
       JOIN creator_profiles cp ON cp.user_id = t.creator_id
       WHERE p.user_id = ? AND p.completed = 0 AND t.published = 1
       GROUP BY t.id
       ORDER BY updated_at DESC
       LIMIT 10`,
    )
    .bind(userId)
    .all<TitleRow & { episode_id: string; episode_name: string; position_s: number; duration_s: number }>();

  return results.map((row) => ({
    title: mapTitle(row),
    episodeId: row.episode_id,
    episodeName: row.episode_name,
    positionS: row.position_s,
    durationS: row.duration_s,
  }));
}

export async function recordImpressions(db: D1Database, titleIds: string[]): Promise<void> {
  if (titleIds.length === 0) return;
  const placeholders = titleIds.map(() => '?').join(', ');
  const dailyTuples = titleIds.map(() => "(?, date('now'), 1, 0, 0, 0, 0)").join(', ');
  await db.batch([
    db
      .prepare(`UPDATE title_stats SET impressions = impressions + 1 WHERE title_id IN (${placeholders})`)
      .bind(...titleIds),
    db
      .prepare(
        `INSERT INTO title_stats_daily (title_id, day, impressions, plays, completes, likes, watch_seconds)
         VALUES ${dailyTuples}
         ON CONFLICT (title_id, day) DO UPDATE SET impressions = impressions + 1`,
      )
      .bind(...titleIds),
  ]);
}
