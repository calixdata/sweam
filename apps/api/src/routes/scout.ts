import { Hono } from 'hono';
import type {
  ContentKind,
  EpisodeViews,
  FinishLeader,
  Genre,
  GenreBreakout,
  GrowthLeader,
  OneSheet,
  ScoutLeaderboards,
  ScoutOfferKind,
  ScoutOfferMine,
  ScoutOfferStatus,
  ScoutPreferences,
} from '@sweam/shared';
import {
  SCOUT_ALL_ACCESS_CENTS,
  SCOUT_BETA_TRIAL_DAYS,
  SCOUT_FINISH_BOARD_MIN_PLAYS,
} from '@sweam/shared';
import type { AppEnv } from '../env';
import { loadDailySeries, loadEpisodeViews, loadRetention } from '../lib/analytics';
import { fail, nowIso, parseBody } from '../lib/http';
import type { TitleRow, TitleStatsRow } from '../lib/mappers';
import { TITLE_FROM, TITLE_SELECT, mapTitle, parseJsonArray } from '../lib/mappers';
import { breakoutScore, growthRatio } from '../lib/momentum';
import { notify } from '../lib/notify';
import { smoothedFinishRate } from '../lib/ranking';
import { RATE_LIMITS, enforceRateLimit } from '../lib/ratelimit';
import { betaSeatsLeft, trialEligible } from '../lib/scoutMembership';
import { requireScout, requireUser, currentUser } from '../lib/session';
import {
  scoutApplySchema,
  scoutInterestSchema,
  scoutOfferSchema,
  scoutPreferencesSchema,
} from '../lib/validate';
import { createScoutCheckout, stripeConfigured } from '../lib/stripe';

export const scoutRoutes = new Hono<AppEnv>();

/** Growth boards need at least a handful of recent plays to mean anything. */
const MIN_RECENT_PLAYS_GROWTH = 3;
const BOARD_SIZE = 10;
const ONESHEET_DAILY_DAYS = 30;

/**
 * Every scout query reads real creator work only: published, opted in by the
 * creator, and never from a demo/seed account (their staged stats are mock
 * data, and scouts pay for real signal).
 */
const SCOUTABLE_WHERE = 't.published = 1 AND t.scoutable = 1 AND u.is_demo = 0';

/** Series-shaped kinds get a per-episode view breakdown on the boards. */
const SERIES_KINDS: ReadonlySet<ContentKind> = new Set<ContentKind>(['series', 'reality']);

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/**
 * How many of the first-50 free-for-90-days scout spots remain, whether this
 * account can still claim one, and the price. Drives the "Congratulations,
 * you're one of the first 50" messaging on the application form.
 */
scoutRoutes.get('/intro', requireUser, async (c) => {
  const user = currentUser(c);
  const [seatsLeft, eligible] = await Promise.all([
    betaSeatsLeft(c.env.DB),
    trialEligible(c.env.DB, user.id),
  ]);
  return c.json({
    seatsLeft,
    trialEligible: eligible,
    priceCents: SCOUT_ALL_ACCESS_CENTS,
    trialDays: SCOUT_BETA_TRIAL_DAYS,
  });
});

/**
 * Apply for scout access. Collects the applicant's details + accepted terms,
 * then returns a Stripe Checkout URL to put a card on file (a free trial for the
 * first 50 scouts). Completing checkout auto-grants provisional approval via the
 * webhook, so there is no manual admin gate.
 */
scoutRoutes.post('/apply', requireUser, async (c) => {
  const user = currentUser(c);
  await enforceRateLimit(c.env.DB, RATE_LIMITS.scoutApply, user.id);
  // A pending application can be resumed (re-issue checkout); approved/rejected cannot re-apply.
  if (user.scout && user.scout.status !== 'pending') {
    const messages: Record<string, string> = {
      approved: 'You already have scout access.',
      rejected: 'Your scout application was reviewed and not approved.',
    };
    fail(409, 'already_applied', messages[user.scout.status] ?? 'You already applied.');
  }
  if (!stripeConfigured(c.env)) {
    fail(503, 'stripe_not_configured', 'Scout applications are not open yet.');
  }
  const body = await parseBody(c, scoutApplySchema);
  const now = nowIso();

  // The first 50 scouts to start a membership get a free trial, once per account.
  const [seatsLeft, eligible] = await Promise.all([
    betaSeatsLeft(c.env.DB),
    trialEligible(c.env.DB, user.id),
  ]);
  const betaFree = seatsLeft > 0 && eligible;

  // beta_free is deliberately not written here: the webhook records the claim
  // only when the trial membership actually starts.
  await c.env.DB.prepare(
    `INSERT INTO scout_profiles
       (user_id, org_name, org_url, contact_email, status, created_at,
        first_name, last_name, position, work_email, terms_accepted_at)
     VALUES (?, ?, NULL, ?, 'pending', ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       org_name = excluded.org_name, contact_email = excluded.contact_email,
       first_name = excluded.first_name, last_name = excluded.last_name,
       position = excluded.position, work_email = excluded.work_email,
       terms_accepted_at = excluded.terms_accepted_at`,
  )
    .bind(
      user.id,
      body.orgName,
      body.workEmail,
      now,
      body.firstName,
      body.lastName,
      body.position,
      body.workEmail,
      now,
    )
    .run();

  const session = await createScoutCheckout(c.env, {
    // Bill the organization's address, not the applicant's personal login email.
    customerEmail: body.workEmail,
    priceCents: SCOUT_ALL_ACCESS_CENTS,
    userId: user.id,
    trialDays: betaFree ? SCOUT_BETA_TRIAL_DAYS : 0,
  });
  return c.json({ url: session.url, betaFree }, 201);
});

// ---------------------------------------------------------------------------
// Content-alert preferences
// ---------------------------------------------------------------------------

scoutRoutes.get('/preferences', requireScout, async (c) => {
  const user = currentUser(c);
  const row = await c.env.DB.prepare(
    'SELECT notify_enabled, notify_genres, notify_kinds FROM scout_profiles WHERE user_id = ?',
  )
    .bind(user.id)
    .first<{ notify_enabled: number; notify_genres: string | null; notify_kinds: string | null }>();
  const prefs: ScoutPreferences = {
    notifyEnabled: row ? row.notify_enabled === 1 : true,
    genres: parseJsonArray(row?.notify_genres ?? null) as Genre[],
    kinds: parseJsonArray(row?.notify_kinds ?? null) as ContentKind[],
  };
  return c.json(prefs);
});

scoutRoutes.put('/preferences', requireScout, async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, scoutPreferencesSchema);
  await c.env.DB.prepare(
    'UPDATE scout_profiles SET notify_enabled = ?, notify_genres = ?, notify_kinds = ? WHERE user_id = ?',
  )
    .bind(body.notifyEnabled ? 1 : 0, JSON.stringify(body.genres), JSON.stringify(body.kinds), user.id)
    .run();
  const prefs: ScoutPreferences = {
    notifyEnabled: body.notifyEnabled,
    genres: body.genres,
    kinds: body.kinds,
  };
  return c.json(prefs);
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
 * opted into scouting (demo accounts excluded). Recent = the last 7 days
 * including today; prior = the 7 days before that. Series carry a per-episode
 * view breakdown so a scout can see how a show holds its audience.
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
      WHERE ${SCOUTABLE_WHERE}`,
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

  // Ranked by the smoothed rate (small samples are pulled toward the prior);
  // the raw rate and the counts behind it are shown so scouts can judge the sample.
  const finishRows = titles
    .filter((row) => row.plays >= SCOUT_FINISH_BOARD_MIN_PLAYS)
    .map((row) => ({ row, smoothed: smoothedFinishRate(row) }))
    .sort((a, b) => b.smoothed - a.smoothed)
    .slice(0, BOARD_SIZE);

  const withWindows = titles.map((row) => {
    const window = windows.get(row.id) ?? { recent: 0, prior: 0 };
    return { row, ...window };
  });

  const growthRows = withWindows
    .filter((entry) => entry.recent >= MIN_RECENT_PLAYS_GROWTH)
    .sort((a, b) => breakoutScore(b.recent, b.prior) - breakoutScore(a.recent, a.prior))
    .slice(0, BOARD_SIZE);

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
  const genreRows = [...bestPerGenre.values()].sort(
    (a, b) => breakoutScore(b.recent, b.prior) - breakoutScore(a.recent, a.prior),
  );

  // One read for every series on any board.
  const seriesIds = new Set<string>();
  for (const { row } of [...finishRows, ...growthRows, ...genreRows]) {
    if (SERIES_KINDS.has(row.kind)) seriesIds.add(row.id);
  }
  const episodeViews = await loadEpisodeViews(c.env.DB, [...seriesIds]);
  const episodesFor = (row: TitleRow): EpisodeViews[] | null =>
    SERIES_KINDS.has(row.kind) ? (episodeViews.get(row.id) ?? []) : null;

  const finishLeaders: FinishLeader[] = finishRows.map(({ row, smoothed }) => ({
    title: mapTitle(row),
    plays: row.plays,
    finishes: row.completes,
    finishRate: Number((row.plays > 0 ? Math.min(1, row.completes / row.plays) : 0).toFixed(2)),
    smoothedFinishRate: Number(smoothed.toFixed(2)),
    episodes: episodesFor(row),
  }));

  const fastestGrowing: GrowthLeader[] = growthRows.map((entry) => ({
    title: mapTitle(entry.row),
    recentPlays: entry.recent,
    priorPlays: entry.prior,
    growth: Number(growthRatio(entry.recent, entry.prior).toFixed(2)),
    episodes: episodesFor(entry.row),
  }));

  const genreBreakouts: GenreBreakout[] = genreRows.map((entry) => ({
    genre: entry.row.genre,
    title: mapTitle(entry.row),
    recentPlays: entry.recent,
    growth: Number(growthRatio(entry.recent, entry.prior).toFixed(2)),
    episodes: episodesFor(entry.row),
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
      WHERE t.id = ? AND ${SCOUTABLE_WHERE}`,
    )
    .bind(titleId)
    .first<OneSheetRow>();
}

scoutRoutes.get('/titles/:titleId/onesheet', requireScout, async (c) => {
  const scout = currentUser(c);
  const row = await scoutableTitle(c.env.DB, c.req.param('titleId'));
  if (!row) fail(404, 'title_not_found', 'That title is not available for scouting.');

  const [daily, retention, episodeViews, myInterest] = await Promise.all([
    loadDailySeries(c.env.DB, row.id, ONESHEET_DAILY_DAYS),
    loadRetention(c.env.DB, row.id),
    loadEpisodeViews(c.env.DB, [row.id]),
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
    episodes: episodeViews.get(row.id) ?? [],
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

// ---------------------------------------------------------------------------
// Offers and deals
// ---------------------------------------------------------------------------

/** Make the creator an offer on a title: sign externally, or a Sweam promotion deal. */
scoutRoutes.post('/titles/:titleId/offer', requireScout, async (c) => {
  const scout = currentUser(c);
  const body = await parseBody(c, scoutOfferSchema);
  const row = await scoutableTitle(c.env.DB, c.req.param('titleId'));
  if (!row) fail(404, 'title_not_found', 'That title is not available for scouting.');

  const existing = await c.env.DB.prepare(
    "SELECT 1 AS x FROM scout_offers WHERE scout_user_id = ? AND title_id = ? AND kind = ? AND status = 'pending'",
  )
    .bind(scout.id, row.id, body.kind)
    .first();
  if (existing) {
    fail(409, 'offer_pending', 'You already have a pending offer of this kind on this title.');
  }

  const percent = body.kind === 'sweam_promo' ? (body.promoPercent ?? null) : null;
  await c.env.DB.prepare(
    `INSERT INTO scout_offers (id, scout_user_id, creator_id, title_id, kind, message, promo_percent, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  )
    .bind(crypto.randomUUID(), scout.id, row.creator_id, row.id, body.kind, body.message, percent, nowIso())
    .run();

  if (scout.scout) {
    const what =
      body.kind === 'sweam_promo'
        ? `a Sweam promotion deal (${percent}% of earnings)`
        : 'an offer to sign with their network';
    await notify(
      c.env.DB,
      row.creator_id,
      'scout_offer',
      `${scout.scout.orgName} sent ${what} for ${row.name}. Review it in your Studio.`,
      '/studio',
    );
  }
  return c.json({ sent: true }, 201);
});

/** The scout's own outgoing offers, newest first. */
scoutRoutes.get('/offers', requireScout, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.kind, o.status, o.promo_percent, o.message, o.created_at,
       t.id AS title_id, t.name AS title_name
     FROM scout_offers o JOIN titles t ON t.id = o.title_id
     WHERE o.scout_user_id = ?
     ORDER BY o.created_at DESC LIMIT 100`,
  )
    .bind(currentUser(c).id)
    .all<{
      id: string;
      kind: ScoutOfferKind;
      status: ScoutOfferStatus;
      promo_percent: number | null;
      message: string;
      created_at: string;
      title_id: string;
      title_name: string;
    }>();
  const offers: ScoutOfferMine[] = results.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    promoPercent: r.promo_percent,
    message: r.message,
    title: { id: r.title_id, name: r.title_name },
    createdAt: r.created_at,
  }));
  return c.json({ offers });
});
