import { Hono } from 'hono';
import type { Context } from 'hono';
import type {
  EarningsSummary,
  MultipartInit,
  PayoutEntry,
  ScoutOfferForCreator,
  ScoutOfferKind,
  ScoutOfferStatus,
  StudioEpisode,
  StudioStanding,
  StudioTitleDetail,
  StudioTitleSummary,
  TitleAnalytics,
  TranscodeStatus,
} from '@sweam/shared';
import {
  CREATOR_REVENUE_SHARE,
  MIN_PAYOUT_MILLICENTS,
  OFFICIAL_MAX_UPLOAD_BYTES,
  ageInYears,
  easternMidnightUtc,
  isReleased,
} from '@sweam/shared';
import type { AppEnv } from '../env';
import { loadDailySeries, loadEpisodeViews, loadRetention } from '../lib/analytics';
import { BLU_NOT_ELIGIBLE_MESSAGE, getBluOfferGate } from '../lib/blufund';
import { creatorFundPayouts } from '../lib/fund';
import { fail, nowIso, parseBody } from '../lib/http';
import { getCreatorEligibility } from '../lib/monetize';
import { notify, notifyFollowers, notifyScoutsOfTitle } from '../lib/notify';
import { isOfficialAccount } from '../lib/official';
import { RATE_LIMITS, enforceRateLimit } from '../lib/ratelimit';
import { SUSPENSION_STRIKES, activeStrikeCount, assertGoodStanding } from '../lib/standing';
import type { EpisodeRow } from '../lib/mappers';
import { mapEpisode } from '../lib/mappers';
import { requireCreator, requireUser, currentUser } from '../lib/session';
import { makeSlug } from '../lib/slug';
import {
  creatorProfileSchema,
  episodeCreateSchema,
  episodeUpdateSchema,
  multipartAbortSchema,
  multipartCompleteSchema,
  multipartInitSchema,
  bluFundSettingsSchema,
  offerDecideSchema,
  publishSchema,
  removalRequestSchema,
  replaceRequestSchema,
  titleCreateSchema,
  titleUpdateSchema,
} from '../lib/validate';
import { enqueueTranscode } from './transcode';

export const studioRoutes = new Hono<AppEnv>();

/** Uploads are capped well below R2's single-PUT limit; enough for a 1080p short. */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

export const UPLOAD_CONTENT_TYPES = new Set([
  'video/mp4',
  'video/webm',
  // iPhone recordings (expo-camera on iOS writes .mov); ffmpeg transcodes them like any other source.
  'video/quicktime',
  'text/vtt',
  'image/jpeg',
  'image/png',
  'image/webp',
  // Rights/identification proof documents for adaptations.
  'application/pdf',
]);

/** Accepted file extension -> stored content type, used when the client's
 *  reported content-type is missing or a non-standard variant (common for MP4
 *  from phone galleries and some browsers). */
const EXTENSION_CONTENT_TYPE: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  vtt: 'text/vtt',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

/**
 * Resolve the content type to store from the client's header and the filename.
 * The header is normalized (parameters stripped, lowercased); if it is not an
 * accepted type, the filename extension is used instead. Returns null when the
 * upload is genuinely unsupported.
 */
export function resolveUploadContentType(
  contentType: string | undefined,
  filename: string,
): string | null {
  const header = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (UPLOAD_CONTENT_TYPES.has(header)) return header;
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const byExt = EXTENSION_CONTENT_TYPE[ext];
  return byExt && UPLOAD_CONTENT_TYPES.has(byExt) ? byExt : null;
}

interface StudioTitleRow {
  id: string;
  slug: string;
  name: string;
  kind: StudioTitleSummary['kind'];
  genre: StudioTitleSummary['genre'];
  synopsis: string;
  advisory: StudioTitleDetail['advisory'];
  poster_url: string | null;
  published: number;
  scoutable: number;
  admin_locked: number;
  is_blu: number;
  ever_blu: number;
  allow_download: number;
  suppressed: number;
  episode_count: number;
  impressions: number;
  plays: number;
  completes: number;
  likes: number;
}

function mapStudioSummary(row: StudioTitleRow): StudioTitleSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    genre: row.genre,
    published: row.published === 1,
    episodeCount: row.episode_count,
    isBlu: row.is_blu === 1,
    everBlu: row.ever_blu === 1,
    stats: {
      impressions: row.impressions,
      plays: row.plays,
      completes: row.completes,
      likes: row.likes,
    },
  };
}

const STUDIO_TITLE_QUERY = `
  SELECT t.id, t.slug, t.name, t.kind, t.genre, t.synopsis, t.advisory, t.poster_url, t.published, t.scoutable, t.admin_locked,
    t.is_blu, t.ever_blu, t.allow_download, t.suppressed,
    (SELECT COUNT(*) FROM episodes e WHERE e.title_id = t.id) AS episode_count,
    COALESCE(s.impressions, 0) AS impressions,
    COALESCE(s.plays, 0) AS plays,
    COALESCE(s.completes, 0) AS completes,
    COALESCE(s.likes, 0) AS likes
  FROM titles t
  LEFT JOIN title_stats s ON s.title_id = t.id
`;

/** Loads a title only if it belongs to the signed-in creator; 404 otherwise. */
async function ownedTitle(c: Context<AppEnv>, titleId: string): Promise<StudioTitleRow> {
  const row = await c.env.DB.prepare(`${STUDIO_TITLE_QUERY} WHERE t.id = ? AND t.creator_id = ?`)
    .bind(titleId, currentUser(c).id)
    .first<StudioTitleRow>();
  if (!row) fail(404, 'title_not_found', 'No such title in your Studio.');
  return row;
}

/** An uploaded /media/ source goes through the pipeline; HLS outputs and external URLs do not. */
function isPipelineSource(url: string): boolean {
  return url.startsWith('/media/') && !url.startsWith('/media/hls/');
}

type StudioEpisodeRow = EpisodeRow & {
  source_url: string | null;
  thumbnail_url: string | null;
  t_status: TranscodeStatus | null;
  t_error: string | null;
  t_updated: string | null;
};

async function titleEpisodes(c: Context<AppEnv>, titleId: string): Promise<StudioEpisode[]> {
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.season, e.episode, e.name, e.synopsis, e.video_url, e.captions_url, e.duration_s,
       e.source_url, e.thumbnail_url, e.release_at,
       j.status AS t_status, j.error AS t_error, j.updated_at AS t_updated
     FROM episodes e
     LEFT JOIN transcode_jobs j ON j.id = (
       SELECT id FROM transcode_jobs
       WHERE episode_id = e.id AND status != 'canceled'
       ORDER BY created_at DESC LIMIT 1
     )
     WHERE e.title_id = ? ORDER BY e.season, e.episode`,
  )
    .bind(titleId)
    .all<StudioEpisodeRow>();
  return results.map((row) => ({
    // The creator always sees their own playback URLs, released or scheduled.
    ...mapEpisode(row, { reveal: true }),
    sourceUrl: row.source_url,
    transcode:
      row.t_status && row.t_updated
        ? { status: row.t_status, error: row.t_error, updatedAt: row.t_updated }
        : null,
  }));
}

// ---------------------------------------------------------------------------
// Creator profile
// ---------------------------------------------------------------------------

studioRoutes.post('/profile', requireUser, async (c) => {
  const user = currentUser(c);
  if (user.handle) fail(409, 'already_creator', 'You already have a creator profile.');
  const body = await parseBody(c, creatorProfileSchema);

  // The creator handle is the account's @username, which is already unique and
  // chosen at sign-up; any submitted handle is ignored so the two never diverge.
  const account = await c.env.DB.prepare('SELECT username FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ username: string | null }>();
  const handle = account?.username ?? body.handle;

  const taken = await c.env.DB.prepare('SELECT 1 AS x FROM creator_profiles WHERE handle = ?')
    .bind(handle)
    .first();
  if (taken) fail(409, 'handle_taken', 'That handle is already in use.');

  await c.env.DB.prepare(
    'INSERT INTO creator_profiles (user_id, handle, bio, verified, created_at) VALUES (?, ?, ?, 0, ?)',
  )
    .bind(user.id, handle, body.bio, nowIso())
    .run();
  return c.json({ handle }, 201);
});

// ---------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------

studioRoutes.get('/titles', requireCreator, async (c) => {
  const { results } = await c.env.DB.prepare(
    `${STUDIO_TITLE_QUERY} WHERE t.creator_id = ? ORDER BY t.created_at DESC`,
  )
    .bind(currentUser(c).id)
    .all<StudioTitleRow>();
  return c.json({ titles: results.map(mapStudioSummary) });
});

studioRoutes.post('/titles', requireCreator, async (c) => {
  await assertGoodStanding(c.env.DB, currentUser(c).id);
  const body = await parseBody(c, titleCreateSchema);
  const id = crypto.randomUUID();
  const slug = makeSlug(body.name);
  const now = nowIso();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO titles (id, creator_id, kind, name, slug, synopsis, genre, advisory, poster_url, published, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    ).bind(
      id,
      currentUser(c).id,
      body.kind,
      body.name,
      slug,
      body.synopsis,
      body.genre,
      body.advisory,
      body.posterUrl,
      now,
    ),
    c.env.DB.prepare('INSERT INTO title_stats (title_id) VALUES (?)').bind(id),
  ]);
  return c.json({ id, slug }, 201);
});

studioRoutes.get('/titles/:titleId', requireCreator, async (c) => {
  const row = await ownedTitle(c, c.req.param('titleId'));
  const openRemoval = await c.env.DB.prepare(
    "SELECT 1 AS x FROM removal_requests WHERE title_id = ? AND status = 'open'",
  )
    .bind(row.id)
    .first();
  const payload: StudioTitleDetail = {
    ...mapStudioSummary(row),
    synopsis: row.synopsis,
    advisory: row.advisory,
    posterUrl: row.poster_url,
    scoutable: row.scoutable === 1,
    adminLocked: row.admin_locked === 1,
    removalRequested: Boolean(openRemoval),
    isBlu: row.is_blu === 1,
    everBlu: row.ever_blu === 1,
    allowDownload: row.allow_download === 1,
    suppressed: row.suppressed === 1,
    episodes: await titleEpisodes(c, row.id),
  };
  return c.json(payload);
});

studioRoutes.patch('/titles/:titleId', requireCreator, async (c) => {
  const row = await ownedTitle(c, c.req.param('titleId'));
  const body = await parseBody(c, titleUpdateSchema);

  const sets: string[] = [];
  const values: unknown[] = [];
  const columns: Record<string, unknown> = {
    name: body.name,
    kind: body.kind,
    genre: body.genre,
    synopsis: body.synopsis,
    advisory: body.advisory,
    poster_url: body.posterUrl,
    scoutable: body.scoutable === undefined ? undefined : body.scoutable ? 1 : 0,
    // Downloads can only be enabled on free titles; Blu is always forced off.
    allow_download:
      body.allowDownload === undefined ? undefined : body.allowDownload && row.is_blu !== 1 ? 1 : 0,
  };
  for (const [column, value] of Object.entries(columns)) {
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      values.push(value);
    }
  }
  await c.env.DB.prepare(`UPDATE titles SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values, row.id)
    .run();
  // Opting a live title into scouting is a moment matching scouts want to know
  // about; the helper no-ops unless it is now published AND scoutable (once only).
  if (body.scoutable) await notifyScoutsOfTitle(c.env.DB, row.id);
  return c.json({ ok: true });
});

studioRoutes.delete('/titles/:titleId', requireCreator, async (c) => {
  const row = await ownedTitle(c, c.req.param('titleId'));
  if (row.suppressed === 1) {
    fail(403, 'suppressed', 'Sweam has this title under review. It cannot be deleted while the review is open.');
  }
  // The Blu delete locks protect paying subscribers from ordinary creators;
  // Sweam's own and flagship accounts decide for themselves.
  const official = await isOfficialAccount(c.env.DB, currentUser(c).id);
  if (row.is_blu === 1 && !official) {
    fail(403, 'blu_no_delete', 'Sweam Blu content cannot be deleted. Send Sweam a removal request with your reason.');
  }
  if (row.ever_blu === 1 && !official) {
    fail(403, 'was_blu_no_delete', 'This title was Sweam Blu before, so it cannot be deleted. You can make it private, or send Sweam a removal request.');
  }
  await c.env.DB.prepare('DELETE FROM titles WHERE id = ?').bind(row.id).run();
  return c.json({ ok: true });
});

/** A creator asks Sweam to remove a live title. Only Sweam can act on it. */
studioRoutes.post('/titles/:titleId/removal-request', requireCreator, async (c) => {
  const row = await ownedTitle(c, c.req.param('titleId'));
  const body = await parseBody(c, removalRequestSchema);
  const existing = await c.env.DB.prepare(
    "SELECT 1 AS x FROM removal_requests WHERE title_id = ? AND status = 'open'",
  )
    .bind(row.id)
    .first();
  if (existing) fail(409, 'already_requested', 'A removal request for this title is already open.');
  await c.env.DB.prepare(
    `INSERT INTO removal_requests (id, title_id, user_id, reason, status, created_at)
     VALUES (?, ?, ?, ?, 'open', ?)`,
  )
    .bind(crypto.randomUUID(), row.id, currentUser(c).id, body.reason, nowIso())
    .run();
  return c.json({ requested: true }, 201);
});

studioRoutes.post('/titles/:titleId/publish', requireCreator, async (c) => {
  const row = await ownedTitle(c, c.req.param('titleId'));
  const body = await parseBody(c, publishSchema);

  // A suppressed title is on an investigation hold: its visibility is frozen
  // until Sweam lifts the hold, so the creator cannot publish or unpublish it.
  if (row.suppressed === 1) {
    fail(403, 'suppressed', 'Sweam has this title under review. You cannot change its visibility right now.');
  }
  if (body.published && row.episode_count === 0) {
    fail(400, 'no_episodes', 'Add at least one episode before publishing.');
  }
  if (body.published) {
    await assertGoodStanding(c.env.DB, currentUser(c).id);
    const takedown = await c.env.DB.prepare(
      'SELECT 1 AS x FROM takedowns WHERE title_id = ? AND released_at IS NULL',
    )
      .bind(row.id)
      .first();
    if (takedown) {
      fail(403, 'takedown_active', 'This title is under an active takedown and cannot be republished.');
    }
  }

  if (body.published) {
    const before = await c.env.DB.prepare('SELECT published_at FROM titles WHERE id = ?')
      .bind(row.id)
      .first<{ published_at: string | null }>();
    await c.env.DB.prepare(
      'UPDATE titles SET published = 1, published_at = COALESCE(published_at, ?) WHERE id = ?',
    )
      .bind(nowIso(), row.id)
      .run();
    // A first publish announces the title to the creator's followers;
    // republishing after an unpublish or takedown release does not re-ping.
    if (before?.published_at === null) {
      await notifyFollowers(
        c.env.DB,
        currentUser(c).id,
        'new_episode',
        `${currentUser(c).displayName} published ${row.name}.`,
        `/t/${row.slug}`,
      );
    }
    // Alert matching scouts if this title is opted into scouting (once only).
    await notifyScoutsOfTitle(c.env.DB, row.id);
  } else {
    await c.env.DB.prepare('UPDATE titles SET published = 0 WHERE id = ?').bind(row.id).run();
  }
  return c.json({ published: body.published });
});

// ---------------------------------------------------------------------------
// Scout offers received by the creator
// ---------------------------------------------------------------------------

/** Offers a creator has received, pending first then newest. */
studioRoutes.get('/offers', requireCreator, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.kind, o.status, o.message, o.promo_percent, o.created_at,
       sp.org_name, sp.org_url, sp.contact_email,
       t.id AS title_id, t.name AS title_name, t.slug AS title_slug
     FROM scout_offers o
     JOIN scout_profiles sp ON sp.user_id = o.scout_user_id
     JOIN titles t ON t.id = o.title_id
     WHERE o.creator_id = ?
     ORDER BY (o.status = 'pending') DESC, o.created_at DESC
     LIMIT 100`,
  )
    .bind(currentUser(c).id)
    .all<{
      id: string;
      kind: ScoutOfferKind;
      status: ScoutOfferStatus;
      message: string;
      promo_percent: number | null;
      created_at: string;
      org_name: string;
      org_url: string | null;
      contact_email: string;
      title_id: string;
      title_name: string;
      title_slug: string;
    }>();
  const offers: ScoutOfferForCreator[] = results.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    orgName: r.org_name,
    orgUrl: r.org_url,
    contactEmail: r.contact_email,
    message: r.message,
    promoPercent: r.promo_percent,
    title: { id: r.title_id, name: r.title_name, slug: r.title_slug },
    createdAt: r.created_at,
  }));
  return c.json({ offers });
});

/** Accept or decline a received offer. Accepting a promotion deal promotes the title. */
studioRoutes.post('/offers/:id/decide', requireCreator, async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, offerDecideSchema);
  const offer = await c.env.DB.prepare(
    `SELECT o.id, o.scout_user_id, o.title_id, o.kind, o.promo_percent, o.status,
       t.name AS title_name, sp.org_name
     FROM scout_offers o
     JOIN titles t ON t.id = o.title_id
     JOIN scout_profiles sp ON sp.user_id = o.scout_user_id
     WHERE o.id = ? AND o.creator_id = ?`,
  )
    .bind(c.req.param('id'), user.id)
    .first<{
      id: string;
      scout_user_id: string;
      title_id: string;
      kind: ScoutOfferKind;
      promo_percent: number | null;
      status: ScoutOfferStatus;
      title_name: string;
      org_name: string;
    }>();
  if (!offer) fail(404, 'offer_not_found', 'That offer does not exist.');
  if (offer.status !== 'pending') fail(409, 'offer_decided', 'That offer has already been decided.');

  const status: ScoutOfferStatus = body.accept ? 'accepted' : 'declined';
  const statements = [
    c.env.DB.prepare('UPDATE scout_offers SET status = ?, decided_at = ? WHERE id = ?').bind(
      status,
      nowIso(),
      offer.id,
    ),
  ];
  // Accepting a Sweam promotion deal labels the title "Promoted by [company]"
  // and boosts it. Signing offers are handled off Sweam, so they just resolve.
  if (body.accept && offer.kind === 'sweam_promo') {
    statements.push(
      c.env.DB.prepare(
        'UPDATE titles SET promoted_by = ?, promoted_scout_id = ?, promoted_percent = ?, promoted_at = ? WHERE id = ?',
      ).bind(offer.org_name, offer.scout_user_id, offer.promo_percent, nowIso(), offer.title_id),
    );
  }
  await c.env.DB.batch(statements);

  await notify(
    c.env.DB,
    offer.scout_user_id,
    'scout_offer',
    body.accept
      ? `${user.displayName} accepted your ${offer.kind === 'sweam_promo' ? 'promotion deal' : 'offer'} for ${offer.title_name}.`
      : `${user.displayName} declined your offer for ${offer.title_name}.`,
    '/scout',
  );
  return c.json({ status });
});

// ---------------------------------------------------------------------------
// Episodes
// ---------------------------------------------------------------------------

studioRoutes.post('/titles/:titleId/episodes', requireCreator, async (c) => {
  await assertGoodStanding(c.env.DB, currentUser(c).id);
  const row = await ownedTitle(c, c.req.param('titleId'));
  const body = await parseBody(c, episodeCreateSchema);
  const id = crypto.randomUUID();
  const sourceUrl = isPipelineSource(body.videoUrl) ? body.videoUrl : null;
  // A scheduled episode unlocks at midnight Eastern on the chosen date.
  const releaseAt = body.releaseDate ? easternMidnightUtc(body.releaseDate) : null;

  try {
    await c.env.DB.prepare(
      `INSERT INTO episodes (id, title_id, season, episode, name, synopsis, video_url, captions_url, duration_s, source_url, created_at, release_at, thumbnail_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        row.id,
        body.season,
        body.episode,
        body.name,
        body.synopsis,
        body.videoUrl,
        body.captionsUrl,
        body.durationS,
        sourceUrl,
        nowIso(),
        releaseAt,
        body.thumbnailUrl,
      )
      .run();
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      fail(409, 'episode_exists', `Season ${body.season} episode ${body.episode} already exists.`);
    }
    throw err;
  }
  if (sourceUrl) await enqueueTranscode(c.env.DB, id, sourceUrl);
  // New episodes on an already-published title go straight to followers; a
  // scheduled one waits for its release (the release cron notifies then).
  if (row.published === 1 && isReleased(releaseAt)) {
    await notifyFollowers(
      c.env.DB,
      currentUser(c).id,
      'new_episode',
      `New episode of ${row.name}: S${body.season} E${body.episode}, ${body.name}.`,
      `/watch/${id}`,
    );
  }
  return c.json({ id, transcodeQueued: sourceUrl !== null, releaseAt }, 201);
});

interface OwnedEpisodeRow {
  id: string;
  source_url: string | null;
  release_at: string | null;
  season: number;
  episode: number;
  name: string;
  title_name: string;
  title_published: number;
}

/** Loads an episode only if its parent title belongs to the signed-in creator. */
async function ownedEpisode(c: Context<AppEnv>, episodeId: string): Promise<OwnedEpisodeRow> {
  const row = await c.env.DB.prepare(
    `SELECT e.id, e.source_url, e.release_at, e.season, e.episode, e.name,
       t.name AS title_name, t.published AS title_published
     FROM episodes e
     JOIN titles t ON t.id = e.title_id
     WHERE e.id = ? AND t.creator_id = ?`,
  )
    .bind(episodeId, currentUser(c).id)
    .first<OwnedEpisodeRow>();
  if (!row) fail(404, 'episode_not_found', 'No such episode in your Studio.');
  return row;
}

studioRoutes.patch('/episodes/:episodeId', requireCreator, async (c) => {
  const episode = await ownedEpisode(c, c.req.param('episodeId'));
  const body = await parseBody(c, episodeUpdateSchema);

  // A new uploaded source re-enters the pipeline; re-saving the same source
  // or pointing at an external URL does not.
  const newSource =
    body.videoUrl !== undefined &&
    isPipelineSource(body.videoUrl) &&
    body.videoUrl !== episode.source_url
      ? body.videoUrl
      : null;

  // Scheduling: a date sets (or moves) the release; null clears it so the
  // episode is available now. Omitted leaves the schedule alone.
  const releaseAt =
    body.releaseDate === undefined
      ? undefined
      : body.releaseDate === null
        ? null
        : easternMidnightUtc(body.releaseDate);
  const wasScheduled = !isReleased(episode.release_at);
  const scheduleChanged = releaseAt !== undefined && releaseAt !== episode.release_at;

  const sets: string[] = [];
  const values: unknown[] = [];
  const columns: Record<string, unknown> = {
    season: body.season,
    episode: body.episode,
    name: body.name,
    synopsis: body.synopsis,
    video_url: body.videoUrl,
    captions_url: body.captionsUrl,
    duration_s: body.durationS,
    source_url: newSource ?? undefined,
    thumbnail_url: body.thumbnailUrl,
    release_at: releaseAt,
    // A moved schedule is announced again when it actually releases.
    release_notified_at: scheduleChanged ? null : undefined,
  };
  for (const [column, value] of Object.entries(columns)) {
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      values.push(value);
    }
  }
  try {
    await c.env.DB.prepare(`UPDATE episodes SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...values, episode.id)
      .run();
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      fail(409, 'episode_exists', 'Another episode already has that season and number.');
    }
    throw err;
  }
  if (newSource) await enqueueTranscode(c.env.DB, episode.id, newSource);
  // Clearing a future schedule on a live title releases the episode right now.
  if (scheduleChanged && wasScheduled && isReleased(releaseAt ?? null) && episode.title_published === 1) {
    const season = body.season ?? episode.season;
    const number = body.episode ?? episode.episode;
    const name = body.name ?? episode.name;
    await c.env.DB.prepare('UPDATE episodes SET release_notified_at = ? WHERE id = ?')
      .bind(nowIso(), episode.id)
      .run();
    await notifyFollowers(
      c.env.DB,
      currentUser(c).id,
      'new_episode',
      `New episode of ${episode.title_name}: S${season} E${number}, ${name}.`,
      `/watch/${episode.id}`,
    );
  }
  return c.json({ ok: true, transcodeQueued: newSource !== null, releaseAt: releaseAt ?? episode.release_at });
});

/** Re-run the pipeline for an episode that has an uploaded source. */
studioRoutes.post('/episodes/:episodeId/transcode', requireCreator, async (c) => {
  const episode = await ownedEpisode(c, c.req.param('episodeId'));
  if (!episode.source_url) {
    fail(400, 'no_source', 'This episode has no uploaded source to transcode.');
  }
  await enqueueTranscode(c.env.DB, episode.id, episode.source_url);
  return c.json({ queued: true });
});

/**
 * Submit a replacement video for a live episode, for an admin to swap in — no
 * fresh submission, same title/episode. (Creators can also replace a draft or
 * live episode's video directly by editing it; this is the admin-reviewed path.)
 */
studioRoutes.post('/episodes/:episodeId/replace-request', requireCreator, async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, replaceRequestSchema);
  const ep = await c.env.DB.prepare(
    `SELECT e.id, e.title_id, t.creator_id FROM episodes e JOIN titles t ON t.id = e.title_id
     WHERE e.id = ? AND t.creator_id = ?`,
  )
    .bind(c.req.param('episodeId'), user.id)
    .first<{ id: string; title_id: string; creator_id: string }>();
  if (!ep) fail(404, 'episode_not_found', 'No such episode in your Studio.');
  if (
    !body.sourceUrl.startsWith(`/media/u/${user.id}/`) &&
    !body.sourceUrl.startsWith(`/media/sub/${user.id}/`)
  ) {
    fail(403, 'not_your_upload', 'That upload does not belong to you.');
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO video_replacements
       (id, episode_id, title_id, creator_id, requested_by, kind, source_url, captions_url, note, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'creator_request', ?, ?, ?, 'pending', ?)`,
  )
    .bind(id, ep.id, ep.title_id, ep.creator_id, user.id, body.sourceUrl, body.captionsUrl, body.note, nowIso())
    .run();
  return c.json({ id }, 201);
});

studioRoutes.delete('/episodes/:episodeId', requireCreator, async (c) => {
  const episode = await ownedEpisode(c, c.req.param('episodeId'));
  await c.env.DB.prepare('DELETE FROM episodes WHERE id = ?').bind(episode.id).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Earnings and payouts
// ---------------------------------------------------------------------------

async function payoutTotals(
  db: D1Database,
  creatorId: string,
): Promise<{ pending: number; paid: number }> {
  const { results } = await db
    .prepare(
      `SELECT status, COALESCE(SUM(amount_millicents), 0) AS total
       FROM payout_requests WHERE creator_id = ? GROUP BY status`,
    )
    .bind(creatorId)
    .all<{ status: string; total: number }>();
  const byStatus = new Map(results.map((row) => [row.status, row.total]));
  return { pending: byStatus.get('pending') ?? 0, paid: byStatus.get('paid') ?? 0 };
}

studioRoutes.get('/earnings', requireCreator, async (c) => {
  const user = currentUser(c);
  const [lifetimeRow, payouts, perTitleResult, dailyResult, payoutList, eligibility] = await Promise.all([
    c.env.DB.prepare(
      'SELECT COALESCE(SUM(creator_millicents), 0) AS n FROM ad_impressions WHERE creator_id = ?',
    )
      .bind(user.id)
      .first<{ n: number }>(),
    payoutTotals(c.env.DB, user.id),
    c.env.DB.prepare(
      `SELECT t.name AS title_name, COUNT(*) AS impressions, SUM(ai.creator_millicents) AS earned
       FROM ad_impressions ai JOIN titles t ON t.id = ai.title_id
       WHERE ai.creator_id = ?
       GROUP BY ai.title_id ORDER BY earned DESC`,
    )
      .bind(user.id)
      .all<{ title_name: string; impressions: number; earned: number }>(),
    c.env.DB.prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS impressions, SUM(creator_millicents) AS earned
       FROM ad_impressions
       WHERE creator_id = ? AND date(created_at) >= date('now', '-13 days')
       GROUP BY day ORDER BY day`,
    )
      .bind(user.id)
      .all<{ day: string; impressions: number; earned: number }>(),
    c.env.DB.prepare(
      `SELECT id, amount_millicents, status, requested_at, decided_at
       FROM payout_requests WHERE creator_id = ?
       ORDER BY requested_at DESC LIMIT 20`,
    )
      .bind(user.id)
      .all<{
        id: string;
        amount_millicents: number;
        status: PayoutEntry['status'];
        requested_at: string;
        decided_at: string | null;
      }>(),
    getCreatorEligibility(c.env.DB, user.id),
  ]);

  const lifetime = lifetimeRow?.n ?? 0;
  const payload: EarningsSummary = {
    lifetimeMillicents: lifetime,
    availableMillicents: Math.max(0, lifetime - payouts.pending - payouts.paid),
    pendingMillicents: payouts.pending,
    paidMillicents: payouts.paid,
    perTitle: perTitleResult.results.map((row) => ({
      titleName: row.title_name,
      impressions: row.impressions,
      creatorMillicents: row.earned,
    })),
    daily: dailyResult.results.map((row) => ({
      day: row.day,
      impressions: row.impressions,
      creatorMillicents: row.earned,
    })),
    payouts: payoutList.results.map((row) => ({
      id: row.id,
      amountMillicents: row.amount_millicents,
      status: row.status,
      requestedAt: row.requested_at,
      decidedAt: row.decided_at,
    })),
    minPayoutMillicents: MIN_PAYOUT_MILLICENTS,
    creatorSharePercent: Math.round(CREATOR_REVENUE_SHARE * 100),
    eligibility,
  };
  return c.json(payload);
});

/** A creator's recent monthly Blu Fund payouts. */
studioRoutes.get('/fund-payouts', requireCreator, async (c) => {
  return c.json({ payouts: await creatorFundPayouts(c.env.DB, currentUser(c).id) });
});

/**
 * Manual payout requests are retired: the Sweam Blu Fund now pays eligible
 * creators automatically each month by watch-time. Kept so older clients get a
 * clear message instead of a 404.
 */
studioRoutes.post('/payouts', requireCreator, async () => {
  fail(
    410,
    'payouts_retired',
    'Manual payout requests are retired. The Sweam Blu Fund now pays eligible creators automatically each month.',
  );
});

// ---------------------------------------------------------------------------
// Account standing
// ---------------------------------------------------------------------------

studioRoutes.get('/standing', requireCreator, async (c) => {
  const user = currentUser(c);
  const [activeStrikes, takedownsResult] = await Promise.all([
    activeStrikeCount(c.env.DB, user.id),
    c.env.DB.prepare(
      `SELECT t.name AS title_name, td.kind, td.created_at
       FROM takedowns td
       JOIN titles t ON t.id = td.title_id
       WHERE t.creator_id = ? AND td.released_at IS NULL
       ORDER BY td.created_at DESC`,
    )
      .bind(user.id)
      .all<{ title_name: string; kind: 'dmca' | 'guidelines'; created_at: string }>(),
  ]);

  const payload: StudioStanding = {
    activeStrikes,
    suspended: activeStrikes >= SUSPENSION_STRIKES,
    takedowns: takedownsResult.results.map((row) => ({
      titleName: row.title_name,
      kind: row.kind,
      createdAt: row.created_at,
    })),
  };
  return c.json(payload);
});

// ---------------------------------------------------------------------------
// Sweam Blu Fund + monetization defaults
// ---------------------------------------------------------------------------

interface BluFundProfileRow {
  content_default: string | null;
  dob: string | null;
  blu_fund_attested_at: string | null;
}

async function bluFundStatus(c: Context<AppEnv>, creatorId: string, isAdmin: boolean) {
  const gate = await getBluOfferGate(c.env.DB, creatorId, isAdmin);
  const profile = await c.env.DB.prepare(
    'SELECT content_default, dob, blu_fund_attested_at FROM creator_profiles WHERE user_id = ?',
  )
    .bind(creatorId)
    .first<BluFundProfileRow>();
  return {
    eligibility: gate.eligibility,
    platformOpen: gate.platformOpen,
    canOfferBlu: gate.canOfferBlu,
    adminBypass: gate.adminBypass,
    officialBypass: gate.officialBypass ?? false,
    contentDefault: profile?.content_default === 'blu' ? ('blu' as const) : ('free' as const),
    dob: profile?.dob ?? null,
    attested: Boolean(profile?.blu_fund_attested_at),
  };
}

// Any signed-in user can read the gate (the upload form needs it before a
// creator profile exists); only creators can change settings.
studioRoutes.get('/blu-fund', requireUser, async (c) => {
  const user = currentUser(c);
  return c.json(await bluFundStatus(c, user.id, user.isAdmin));
});

studioRoutes.post('/blu-fund', requireCreator, async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, bluFundSettingsSchema);

  const profile = await c.env.DB.prepare('SELECT dob FROM creator_profiles WHERE user_id = ?')
    .bind(user.id)
    .first<{ dob: string | null }>();

  // Apply DOB + 18+ attestation first so a same-request contentDefault='blu'
  // sees the updated age.
  const sets: string[] = [];
  const binds: unknown[] = [];
  let effectiveDob = profile?.dob ?? null;
  if (body.dob !== undefined) {
    effectiveDob = body.dob;
    sets.push('dob = ?');
    binds.push(body.dob);
  }
  if (body.attest18) {
    if (!effectiveDob) {
      fail(400, 'dob_required', 'Add your date of birth before confirming you are 18 or older.');
    }
    const age = ageInYears(effectiveDob);
    if (age == null) fail(400, 'bad_dob', 'That date of birth is not valid.');
    if (age < 18) {
      fail(400, 'under_18', 'Your date of birth indicates you are under 18, so you cannot join the Blu Fund.');
    }
    sets.push('blu_fund_attested_at = ?');
    binds.push(nowIso());
  }
  if (sets.length > 0) {
    await c.env.DB.prepare(`UPDATE creator_profiles SET ${sets.join(', ')} WHERE user_id = ?`)
      .bind(...binds, user.id)
      .run();
  }

  if (body.contentDefault !== undefined) {
    if (body.contentDefault === 'blu') {
      const gate = await getBluOfferGate(c.env.DB, user.id, user.isAdmin);
      if (!gate.canOfferBlu) fail(403, 'blu_not_eligible', BLU_NOT_ELIGIBLE_MESSAGE);
    }
    await c.env.DB.prepare('UPDATE creator_profiles SET content_default = ? WHERE user_id = ?')
      .bind(body.contentDefault, user.id)
      .run();
  }

  return c.json(await bluFundStatus(c, user.id, user.isAdmin));
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

const ANALYTICS_DAILY_DAYS = 30;
const ANALYTICS_LIST_LIMIT = 50;

/**
 * The creator's view of their title's performance: the same daily series and
 * retention curves a scout sees on the one-sheet, plus the other side of the
 * loop — who opened the one-sheet and who expressed interest.
 */
studioRoutes.get('/titles/:titleId/analytics', requireCreator, async (c) => {
  const row = await ownedTitle(c, c.req.param('titleId'));

  const [daily, retention, episodeViews, viewsResult, interestsResult] = await Promise.all([
    loadDailySeries(c.env.DB, row.id, ANALYTICS_DAILY_DAYS),
    loadRetention(c.env.DB, row.id),
    loadEpisodeViews(c.env.DB, [row.id]),
    c.env.DB.prepare(
      `SELECT sp.org_name, v.viewed_at
       FROM onesheet_views v
       JOIN scout_profiles sp ON sp.user_id = v.scout_user_id
       WHERE v.title_id = ?
       ORDER BY v.viewed_at DESC
       LIMIT ${ANALYTICS_LIST_LIMIT}`,
    )
      .bind(row.id)
      .all<{ org_name: string; viewed_at: string }>(),
    c.env.DB.prepare(
      `SELECT sp.org_name, sp.org_url, sp.contact_email, i.note, i.created_at
       FROM scout_interests i
       JOIN scout_profiles sp ON sp.user_id = i.scout_user_id
       WHERE i.title_id = ?
       ORDER BY i.created_at DESC
       LIMIT ${ANALYTICS_LIST_LIMIT}`,
    )
      .bind(row.id)
      .all<{
        org_name: string;
        org_url: string | null;
        contact_email: string;
        note: string;
        created_at: string;
      }>(),
  ]);

  const payload: TitleAnalytics = {
    scoutable: row.scoutable === 1,
    daily,
    retention,
    episodes: episodeViews.get(row.id) ?? [],
    oneSheetViews: viewsResult.results.map((view) => ({
      orgName: view.org_name,
      viewedAt: view.viewed_at,
    })),
    interests: interestsResult.results.map((interest) => ({
      orgName: interest.org_name,
      orgUrl: interest.org_url,
      contactEmail: interest.contact_email,
      note: interest.note,
      createdAt: interest.created_at,
    })),
  };
  return c.json(payload);
});

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

/**
 * Direct-to-R2 upload. The request body streams straight into the bucket (the
 * Worker never buffers the file), and the returned /media/... URL is what the
 * episode form stores as videoUrl / captionsUrl / posterUrl.
 */
studioRoutes.put('/upload/:filename', requireCreator, async (c) => {
  await assertGoodStanding(c.env.DB, currentUser(c).id);
  await enforceRateLimit(c.env.DB, RATE_LIMITS.upload, currentUser(c).id);
  const filename = c.req.param('filename');
  const contentType = resolveUploadContentType(c.req.header('content-type'), filename);
  if (!contentType) {
    fail(415, 'unsupported_type', 'Upload MP4/WebM video, WebVTT captions, or JPEG/PNG/WebP images.');
  }
  const contentLength = Number(c.req.header('content-length') ?? '0');
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    fail(411, 'length_required', 'Uploads must include a Content-Length header.');
  }
  if (contentLength > (await uploadCapFor(c.env.DB, currentUser(c).id))) {
    fail(413, 'too_large', 'Uploads are limited to 512 MB in this release.');
  }
  if (!c.req.raw.body) fail(400, 'empty_body', 'Upload body is empty.');

  const key = mediaKeyFor(currentUser(c).id, filename);
  await c.env.MEDIA.put(key, c.req.raw.body, { httpMetadata: { contentType } });
  return c.json({ url: `/media/${key}` }, 201);
});

/** The upload size cap for an account: the normal 512 MB, or far more for official accounts. */
export async function uploadCapFor(db: D1Database, userId: string): Promise<number> {
  return (await isOfficialAccount(db, userId)) ? OFFICIAL_MAX_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
}

export function mediaKeyFor(userId: string, filename: string): string {
  const safeName = filename
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `u/${userId}/${crypto.randomUUID()}/${safeName || 'upload'}`;
}

// ---------------------------------------------------------------------------
// Multipart uploads
// ---------------------------------------------------------------------------

/** R2 requires equal part sizes (except the last) with a 5 MiB minimum. */
export const MULTIPART_PART_SIZE = 8 * 1024 * 1024;
export const MAX_PART_BYTES = 64 * 1024 * 1024;

/** A multipart key must belong to the signed-in creator; a miss is a 404. */
function assertOwnKey(c: Context<AppEnv>, key: string): void {
  if (!key.startsWith(`u/${currentUser(c).id}/`)) {
    fail(404, 'upload_not_found', 'No such upload.');
  }
}

studioRoutes.post('/upload/multipart', requireCreator, async (c) => {
  await assertGoodStanding(c.env.DB, currentUser(c).id);
  await enforceRateLimit(c.env.DB, RATE_LIMITS.upload, currentUser(c).id);
  const body = await parseBody(c, multipartInitSchema);
  const contentType = resolveUploadContentType(body.contentType, body.filename);
  if (!contentType) {
    fail(415, 'unsupported_type', 'Upload MP4/WebM video, WebVTT captions, or JPEG/PNG/WebP images.');
  }
  const key = mediaKeyFor(currentUser(c).id, body.filename);
  const upload = await c.env.MEDIA.createMultipartUpload(key, {
    httpMetadata: { contentType },
  });
  const payload: MultipartInit = { key, uploadId: upload.uploadId, partSize: MULTIPART_PART_SIZE };
  return c.json(payload, 201);
});

studioRoutes.put('/upload/multipart/part', requireCreator, async (c) => {
  const key = c.req.query('key') ?? '';
  const uploadId = c.req.query('uploadId') ?? '';
  const partNumber = Number(c.req.query('partNumber') ?? '0');
  assertOwnKey(c, key);
  if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
    fail(400, 'bad_part', 'Provide uploadId and a part number between 1 and 10000.');
  }
  const contentLength = Number(c.req.header('content-length') ?? '0');
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > MAX_PART_BYTES) {
    fail(400, 'bad_part_size', 'Each part needs a Content-Length up to 64 MB.');
  }
  if (!c.req.raw.body) fail(400, 'empty_body', 'Part body is empty.');

  const upload = c.env.MEDIA.resumeMultipartUpload(key, uploadId);
  try {
    const part = await upload.uploadPart(partNumber, c.req.raw.body);
    return c.json({ partNumber: part.partNumber, etag: part.etag });
  } catch {
    // R2 rejects parts for unknown/aborted uploads; tell the client to restart.
    fail(409, 'upload_gone', 'That multipart upload no longer exists; start it again.');
  }
});

studioRoutes.post('/upload/multipart/complete', requireCreator, async (c) => {
  const body = await parseBody(c, multipartCompleteSchema);
  assertOwnKey(c, body.key);
  const upload = c.env.MEDIA.resumeMultipartUpload(body.key, body.uploadId);
  try {
    await upload.complete(body.parts.map((part) => ({ partNumber: part.partNumber, etag: part.etag })));
  } catch {
    fail(409, 'upload_gone', 'That multipart upload could not be completed; start it again.');
  }
  return c.json({ url: `/media/${body.key}` }, 201);
});

studioRoutes.post('/upload/multipart/abort', requireCreator, async (c) => {
  const body = await parseBody(c, multipartAbortSchema);
  assertOwnKey(c, body.key);
  const upload = c.env.MEDIA.resumeMultipartUpload(body.key, body.uploadId);
  try {
    await upload.abort();
  } catch {
    // Aborting an already-gone upload is success from the client's view.
  }
  return c.json({ aborted: true });
});
