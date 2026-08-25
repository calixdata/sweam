import { Hono } from 'hono';
import type { ContinueWatchingItem, HomePayload, Rail, TitleSummary } from '@sweam/shared';
import type { AppEnv } from '../env';
import { fail } from '../lib/http';
import type { TitleRow, TitleStatsRow } from '../lib/mappers';
import { TITLE_FROM, TITLE_SELECT, likeEscape, mapTitle } from '../lib/mappers';
import { DEFAULT_WEIGHTS, rankTitles } from '../lib/ranking';
import { searchQuerySchema } from '../lib/validate';

export const catalogRoutes = new Hono<AppEnv>();

type CatalogRow = TitleRow & TitleStatsRow;

const CATALOG_QUERY = `
  SELECT ${TITLE_SELECT},
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

  const spotlight = rankTitles(
    results,
    (row) => ({
      publishedAtMs: row.published_at ? Date.parse(row.published_at) : nowMs,
      impressions: row.impressions,
      plays: row.plays,
      completes: row.completes,
      likes: row.likes,
    }),
    { nowMs, catalogImpressions, weights: DEFAULT_WEIGHTS },
  )
    .slice(0, SPOTLIGHT_SIZE)
    .map((entry) => mapTitle(entry.item));

  const weekAgoIso = new Date(nowMs - 7 * 86_400_000).toISOString();
  const newThisWeek = results
    .filter((row) => row.published_at !== null && row.published_at >= weekAgoIso)
    .slice(0, RAIL_SIZE)
    .map(mapTitle);

  const byGenre = new Map<string, TitleSummary[]>();
  for (const row of results) {
    const rail = byGenre.get(row.genre) ?? [];
    if (rail.length < RAIL_SIZE) rail.push(mapTitle(row));
    byGenre.set(row.genre, rail);
  }

  const rails: Rail[] = [{ key: 'spotlight', heading: 'Spotlight', titles: spotlight }];
  if (newThisWeek.length > 0) {
    rails.push({ key: 'new', heading: 'New this week', titles: newThisWeek });
  }
  for (const [genre, titles] of byGenre) {
    rails.push({ key: `genre-${genre.toLowerCase()}`, heading: genre, titles });
  }

  const payload: HomePayload = {
    continueWatching: await continueWatching(c.env.DB, c.get('user')?.id ?? null),
    rails: rails.filter((rail) => rail.titles.length > 0),
  };

  // Spotlight placements count as discovery impressions for the ranking loop.
  await recordImpressions(c.env.DB, spotlight.map((t) => t.id));

  return c.json(payload);
});

catalogRoutes.get('/search', async (c) => {
  const parsed = searchQuerySchema.safeParse({ q: c.req.query('q') ?? '' });
  if (!parsed.success) fail(400, 'validation_failed', parsed.error.issues[0]?.message ?? 'Invalid search.');
  const pattern = `%${likeEscape(parsed.data.q)}%`;

  const { results } = await c.env.DB.prepare(
    `SELECT ${TITLE_SELECT}
     ${TITLE_FROM}
     WHERE t.published = 1
       AND (t.name LIKE ? ESCAPE '\\'
            OR t.synopsis LIKE ? ESCAPE '\\'
            OR cp.handle LIKE ? ESCAPE '\\'
            OR u.display_name LIKE ? ESCAPE '\\')
     ORDER BY t.published_at DESC
     LIMIT 25`,
  )
    .bind(pattern, pattern, pattern, pattern)
    .all<TitleRow>();

  return c.json({ query: parsed.data.q, results: results.map(mapTitle) });
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
