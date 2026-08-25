import { Hono } from 'hono';
import type { Context } from 'hono';
import type { EpisodeSummary, StudioTitleDetail, StudioTitleSummary } from '@sweam/shared';
import type { AppEnv } from '../env';
import { fail, nowIso, parseBody } from '../lib/http';
import type { EpisodeRow } from '../lib/mappers';
import { mapEpisode } from '../lib/mappers';
import { requireCreator, requireUser, currentUser } from '../lib/session';
import { makeSlug } from '../lib/slug';
import {
  creatorProfileSchema,
  episodeCreateSchema,
  episodeUpdateSchema,
  publishSchema,
  titleCreateSchema,
  titleUpdateSchema,
} from '../lib/validate';

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
  SELECT t.id, t.slug, t.name, t.kind, t.genre, t.synopsis, t.advisory, t.poster_url, t.published,
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

async function titleEpisodes(c: Context<AppEnv>, titleId: string): Promise<EpisodeSummary[]> {
  const { results } = await c.env.DB.prepare(
    `SELECT id, season, episode, name, synopsis, video_url, captions_url, duration_s
     FROM episodes WHERE title_id = ? ORDER BY season, episode`,
  )
    .bind(titleId)
    .all<EpisodeRow>();
  return results.map(mapEpisode);
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
  const row = await ownedTitle(c, c.req.param('titleId'));
  const body = await parseBody(c, episodeCreateSchema);
  const id = crypto.randomUUID();

  try {
    await c.env.DB.prepare(
      `INSERT INTO episodes (id, title_id, season, episode, name, synopsis, video_url, captions_url, duration_s, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        nowIso(),
      )
      .run();
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      fail(409, 'episode_exists', `Season ${body.season} episode ${body.episode} already exists.`);
    }
    throw err;
  }
  return c.json({ id }, 201);
});

/** Loads an episode only if its parent title belongs to the signed-in creator. */
async function ownedEpisode(c: Context<AppEnv>, episodeId: string): Promise<{ id: string }> {
  const row = await c.env.DB.prepare(
    `SELECT e.id FROM episodes e
     JOIN titles t ON t.id = e.title_id
     WHERE e.id = ? AND t.creator_id = ?`,
  )
    .bind(episodeId, currentUser(c).id)
    .first<{ id: string }>();
  if (!row) fail(404, 'episode_not_found', 'No such episode in your Studio.');
  return row;
}

studioRoutes.patch('/episodes/:episodeId', requireCreator, async (c) => {
  const episode = await ownedEpisode(c, c.req.param('episodeId'));
  const body = await parseBody(c, episodeUpdateSchema);

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
  return c.json({ ok: true });
});

studioRoutes.delete('/episodes/:episodeId', requireCreator, async (c) => {
  const episode = await ownedEpisode(c, c.req.param('episodeId'));
  await c.env.DB.prepare('DELETE FROM episodes WHERE id = ?').bind(episode.id).run();
  return c.json({ ok: true });
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

  const safeName = c.req
    .param('filename')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  const key = `u/${currentUser(c).id}/${crypto.randomUUID()}/${safeName || 'upload'}`;

  await c.env.MEDIA.put(key, c.req.raw.body, { httpMetadata: { contentType } });
  return c.json({ url: `/media/${key}` }, 201);
});
