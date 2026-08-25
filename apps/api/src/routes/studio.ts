import { Hono } from 'hono';
import type { Context } from 'hono';
import type {
  MultipartInit,
  StudioEpisode,
  StudioStanding,
  StudioTitleDetail,
  StudioTitleSummary,
  TitleAnalytics,
  TranscodeStatus,
} from '@sweam/shared';
import type { AppEnv } from '../env';
import { loadDailySeries, loadRetention } from '../lib/analytics';
import { fail, nowIso, parseBody } from '../lib/http';
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
  publishSchema,
  titleCreateSchema,
  titleUpdateSchema,
} from '../lib/validate';
import { enqueueTranscode } from './transcode';

export const studioRoutes = new Hono<AppEnv>();

/** Uploads are capped well below R2's single-PUT limit; enough for a 1080p short. */
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

const UPLOAD_CONTENT_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'text/vtt',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

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
    stats: {
      impressions: row.impressions,
      plays: row.plays,
      completes: row.completes,
      likes: row.likes,
    },
  };
}

const STUDIO_TITLE_QUERY = `
  SELECT t.id, t.slug, t.name, t.kind, t.genre, t.synopsis, t.advisory, t.poster_url, t.published, t.scoutable,
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
       e.source_url, e.thumbnail_url,
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
    ...mapEpisode(row),
    sourceUrl: row.source_url,
    thumbnailUrl: row.thumbnail_url,
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

  const taken = await c.env.DB.prepare('SELECT 1 AS x FROM creator_profiles WHERE handle = ?')
    .bind(body.handle)
    .first();
  if (taken) fail(409, 'handle_taken', 'That handle is already in use.');

  await c.env.DB.prepare(
    'INSERT INTO creator_profiles (user_id, handle, bio, verified, created_at) VALUES (?, ?, ?, 0, ?)',
  )
    .bind(user.id, body.handle, body.bio, nowIso())
    .run();
  return c.json({ handle: body.handle }, 201);
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
  const payload: StudioTitleDetail = {
    ...mapStudioSummary(row),
    synopsis: row.synopsis,
    advisory: row.advisory,
    posterUrl: row.poster_url,
    scoutable: row.scoutable === 1,
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
  return c.json({ ok: true });
});

studioRoutes.delete('/titles/:titleId', requireCreator, async (c) => {
  const row = await ownedTitle(c, c.req.param('titleId'));
  await c.env.DB.prepare('DELETE FROM titles WHERE id = ?').bind(row.id).run();
  return c.json({ ok: true });
});

studioRoutes.post('/titles/:titleId/publish', requireCreator, async (c) => {
  const row = await ownedTitle(c, c.req.param('titleId'));
  const body = await parseBody(c, publishSchema);

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
    await c.env.DB.prepare(
      'UPDATE titles SET published = 1, published_at = COALESCE(published_at, ?) WHERE id = ?',
    )
      .bind(nowIso(), row.id)
      .run();
  } else {
    await c.env.DB.prepare('UPDATE titles SET published = 0 WHERE id = ?').bind(row.id).run();
  }
  return c.json({ published: body.published });
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

  try {
    await c.env.DB.prepare(
      `INSERT INTO episodes (id, title_id, season, episode, name, synopsis, video_url, captions_url, duration_s, source_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      )
      .run();
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      fail(409, 'episode_exists', `Season ${body.season} episode ${body.episode} already exists.`);
    }
    throw err;
  }
  if (sourceUrl) await enqueueTranscode(c.env.DB, id, sourceUrl);
  return c.json({ id, transcodeQueued: sourceUrl !== null }, 201);
});

/** Loads an episode only if its parent title belongs to the signed-in creator. */
async function ownedEpisode(
  c: Context<AppEnv>,
  episodeId: string,
): Promise<{ id: string; source_url: string | null }> {
  const row = await c.env.DB.prepare(
    `SELECT e.id, e.source_url FROM episodes e
     JOIN titles t ON t.id = e.title_id
     WHERE e.id = ? AND t.creator_id = ?`,
  )
    .bind(episodeId, currentUser(c).id)
    .first<{ id: string; source_url: string | null }>();
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
  return c.json({ ok: true, transcodeQueued: newSource !== null });
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

studioRoutes.delete('/episodes/:episodeId', requireCreator, async (c) => {
  const episode = await ownedEpisode(c, c.req.param('episodeId'));
  await c.env.DB.prepare('DELETE FROM episodes WHERE id = ?').bind(episode.id).run();
  return c.json({ ok: true });
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

  const [daily, retention, viewsResult, interestsResult] = await Promise.all([
    loadDailySeries(c.env.DB, row.id, ANALYTICS_DAILY_DAYS),
    loadRetention(c.env.DB, row.id),
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
  const contentType = c.req.header('content-type') ?? '';
  if (!UPLOAD_CONTENT_TYPES.has(contentType)) {
    fail(415, 'unsupported_type', 'Upload MP4/WebM video, WebVTT captions, or JPEG/PNG/WebP images.');
  }
  const contentLength = Number(c.req.header('content-length') ?? '0');
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    fail(411, 'length_required', 'Uploads must include a Content-Length header.');
  }
  if (contentLength > MAX_UPLOAD_BYTES) {
    fail(413, 'too_large', 'Uploads are limited to 512 MB in this release.');
  }
  if (!c.req.raw.body) fail(400, 'empty_body', 'Upload body is empty.');

  const key = mediaKeyFor(currentUser(c).id, c.req.param('filename'));
  await c.env.MEDIA.put(key, c.req.raw.body, { httpMetadata: { contentType } });
  return c.json({ url: `/media/${key}` }, 201);
});

function mediaKeyFor(userId: string, filename: string): string {
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
const MAX_PART_BYTES = 64 * 1024 * 1024;

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
  if (!UPLOAD_CONTENT_TYPES.has(body.contentType)) {
    fail(415, 'unsupported_type', 'Upload MP4/WebM video, WebVTT captions, or JPEG/PNG/WebP images.');
  }
  const key = mediaKeyFor(currentUser(c).id, body.filename);
  const upload = await c.env.MEDIA.createMultipartUpload(key, {
    httpMetadata: { contentType: body.contentType },
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
