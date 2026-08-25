import { Hono } from 'hono';
import type {
  FinishLeader,
  GenreBreakout,
  GrowthLeader,
  OneSheet,
  ScoutLeaderboards,
} from '@sweam/shared';
import type { AppEnv } from '../env';
import { loadDailySeries, loadRetention } from '../lib/analytics';
import { fail, nowIso, parseBody } from '../lib/http';
import type { TitleRow, TitleStatsRow } from '../lib/mappers';
import { TITLE_FROM, TITLE_SELECT, mapTitle } from '../lib/mappers';
import { breakoutScore, growthRatio } from '../lib/momentum';
import { notify } from '../lib/notify';
import { smoothedFinishRate } from '../lib/ranking';
import { RATE_LIMITS, enforceRateLimit } from '../lib/ratelimit';
import { requireScout, requireUser, currentUser } from '../lib/session';
import { scoutApplySchema, scoutInterestSchema } from '../lib/validate';

export const scoutRoutes = new Hono<AppEnv>();

/** Finish-rate board excludes tiny samples the smoothing can only partly tame. */
const MIN_PLAYS_FINISH_BOARD = 20;
/** Growth boards need at least a handful of recent plays to mean anything. */
const MIN_RECENT_PLAYS_GROWTH = 3;
const BOARD_SIZE = 10;
const ONESHEET_DAILY_DAYS = 30;

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

scoutRoutes.post('/apply', requireUser, async (c) => {
  const user = currentUser(c);
  await enforceRateLimit(c.env.DB, RATE_LIMITS.scoutApply, user.id);
  if (user.scout) {
    const messages: Record<string, string> = {
      approved: 'You already have scout access.',
      pending: 'Your scout application is already pending review.',
      rejected: 'Your scout application was reviewed and not approved.',
    };
    fail(409, 'already_applied', messages[user.scout.status] ?? 'You already applied.');
  }
  const body = await parseBody(c, scoutApplySchema);
  await c.env.DB.prepare(
    `INSERT INTO scout_profiles (user_id, org_name, org_url, contact_email, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
  )
    .bind(user.id, body.orgName, body.orgUrl, body.contactEmail, nowIso())
    .run();
  return c.json({ status: 'pending' }, 201);
});

// ---------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------

type ScoutTitleRow = TitleRow & TitleStatsRow;

interface WindowRow {
  title_id: string;
  recent: number;
  prior: number;
}

/**
 * The three momentum boards, computed over published titles whose creators
 * opted into scouting. Recent = the last 7 days including today; prior = the
 * 7 days before that.
 */
scoutRoutes.get('/leaderboards', requireScout, async (c) => {
  const [titlesResult, windowsResult] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT ${TITLE_SELECT},
        COALESCE(s.impressions, 0) AS impressions,
        COALESCE(s.plays, 0) AS plays,
        COALESCE(s.completes, 0) AS completes,
        COALESCE(s.likes, 0) AS likes
      ${TITLE_FROM}
      LEFT JOIN title_stats s ON s.title_id = t.id
      WHERE t.published = 1 AND t.scoutable = 1`,
    ),
    c.env.DB.prepare(
      `SELECT title_id,
         SUM(CASE WHEN day >= date('now', '-6 days') THEN plays ELSE 0 END) AS recent,
         SUM(CASE WHEN day < date('now', '-6 days') THEN plays ELSE 0 END) AS prior
       FROM title_stats_daily
       WHERE day >= date('now', '-13 days')
       GROUP BY title_id`,
    ),
  ]);

  const titles = (titlesResult?.results ?? []) as ScoutTitleRow[];
  const windows = new Map(
    ((windowsResult?.results ?? []) as WindowRow[]).map((row) => [
      row.title_id,
      { recent: row.recent, prior: row.prior },
    ]),
  );

  const finishLeaders: FinishLeader[] = titles
    .filter((row) => row.plays >= MIN_PLAYS_FINISH_BOARD)
    .map((row) => ({
      title: mapTitle(row),
      plays: row.plays,
      finishRate: Number(smoothedFinishRate(row).toFixed(2)),
    }))
    .sort((a, b) => b.finishRate - a.finishRate)
    .slice(0, BOARD_SIZE);

  const withWindows = titles.map((row) => {
    const window = windows.get(row.id) ?? { recent: 0, prior: 0 };
    return { row, ...window };
  });

  const fastestGrowing: GrowthLeader[] = withWindows
    .filter((entry) => entry.recent >= MIN_RECENT_PLAYS_GROWTH)
    .sort((a, b) => breakoutScore(b.recent, b.prior) - breakoutScore(a.recent, a.prior))
    .slice(0, BOARD_SIZE)
    .map((entry) => ({
      title: mapTitle(entry.row),
      recentPlays: entry.recent,
      priorPlays: entry.prior,
      growth: Number(growthRatio(entry.recent, entry.prior).toFixed(2)),
    }));

  const bestPerGenre = new Map<string, (typeof withWindows)[number]>();
  for (const entry of withWindows) {
    if (entry.recent < 1) continue;
    const incumbent = bestPerGenre.get(entry.row.genre);
    if (
      !incumbent ||
      breakoutScore(entry.recent, entry.prior) > breakoutScore(incumbent.recent, incumbent.prior)
    ) {
      bestPerGenre.set(entry.row.genre, entry);
    }
  }
  const genreBreakouts: GenreBreakout[] = [...bestPerGenre.values()]
    .sort((a, b) => breakoutScore(b.recent, b.prior) - breakoutScore(a.recent, a.prior))
    .map((entry) => ({
      genre: entry.row.genre,
      title: mapTitle(entry.row),
      recentPlays: entry.recent,
      growth: Number(growthRatio(entry.recent, entry.prior).toFixed(2)),
    }));

  const payload: ScoutLeaderboards = { finishLeaders, fastestGrowing, genreBreakouts };
  return c.json(payload);
});

// ---------------------------------------------------------------------------
// One-sheets
// ---------------------------------------------------------------------------

type OneSheetRow = TitleRow &
  TitleStatsRow & { bio: string; verified: number; watch_seconds: number; creator_id: string };

/** Loads a title for scout surfaces: must be published and opted in. */
async function scoutableTitle(db: D1Database, titleId: string): Promise<OneSheetRow | null> {
  return db
    .prepare(
      `SELECT ${TITLE_SELECT},
        cp.bio, cp.verified, t.creator_id,
        COALESCE(s.impressions, 0) AS impressions,
        COALESCE(s.plays, 0) AS plays,
        COALESCE(s.completes, 0) AS completes,
        COALESCE(s.likes, 0) AS likes,
        COALESCE(s.watch_seconds, 0) AS watch_seconds
      ${TITLE_FROM}
      LEFT JOIN title_stats s ON s.title_id = t.id
      WHERE t.id = ? AND t.published = 1 AND t.scoutable = 1`,
    )
    .bind(titleId)
    .first<OneSheetRow>();
}

scoutRoutes.get('/titles/:titleId/onesheet', requireScout, async (c) => {
  const scout = currentUser(c);
  const row = await scoutableTitle(c.env.DB, c.req.param('titleId'));
  if (!row) fail(404, 'title_not_found', 'That title is not available for scouting.');

  const [daily, retention, myInterest] = await Promise.all([
    loadDailySeries(c.env.DB, row.id, ONESHEET_DAILY_DAYS),
    loadRetention(c.env.DB, row.id),
    c.env.DB.prepare('SELECT 1 AS x FROM scout_interests WHERE scout_user_id = ? AND title_id = ?')
      .bind(scout.id, row.id)
      .first()
      .then((hit) => hit !== null),
  ]);

  // Opening a one-sheet is part of the deal: the creator sees who looked.
  // The first look from each organization also notifies the creator; repeat
  // views stay in the log without pinging them again.
  const seenBefore = await c.env.DB.prepare(
    'SELECT 1 AS x FROM onesheet_views WHERE scout_user_id = ? AND title_id = ? LIMIT 1',
  )
    .bind(scout.id, row.id)
    .first();
  await c.env.DB.prepare(
    'INSERT INTO onesheet_views (id, scout_user_id, title_id, viewed_at) VALUES (?, ?, ?, ?)',
  )
    .bind(crypto.randomUUID(), scout.id, row.id, nowIso())
    .run();
  if (!seenBefore && scout.scout) {
    await notify(
      c.env.DB,
      row.creator_id,
      'scout_view',
      `${scout.scout.orgName} viewed the one-sheet for ${row.name}.`,
      `/studio/t/${row.id}/analytics`,
    );
  }

  const payload: OneSheet = {
    title: mapTitle(row),
    creatorBio: row.bio,
    creatorVerified: row.verified === 1,
    stats: {
      impressions: row.impressions,
      plays: row.plays,
      completes: row.completes,
      likes: row.likes,
      watchSeconds: row.watch_seconds,
    },
    daily,
    retention,
    myInterest,
  };
  return c.json(payload);
});

scoutRoutes.post('/titles/:titleId/interest', requireScout, async (c) => {
  const scout = currentUser(c);
  const body = await parseBody(c, scoutInterestSchema);
  const row = await scoutableTitle(c.env.DB, c.req.param('titleId'));
  if (!row) fail(404, 'title_not_found', 'That title is not available for scouting.');

  const result = await c.env.DB.prepare(
    `INSERT INTO scout_interests (id, scout_user_id, title_id, note, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (scout_user_id, title_id) DO NOTHING`,
  )
    .bind(crypto.randomUUID(), scout.id, row.id, body.note, nowIso())
    .run();
  if (result.meta.changes > 0 && scout.scout) {
    await notify(
      c.env.DB,
      row.creator_id,
      'scout_interest',
      `${scout.scout.orgName} expressed interest in ${row.name}. Their contact details are in your analytics.`,
      `/studio/t/${row.id}/analytics`,
    );
  }
  return c.json({ interested: true });
});
