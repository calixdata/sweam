import { Hono } from 'hono';
import type { WatchPayload } from '@sweam/shared';
import type { AppEnv } from '../env';
import { fail, nowIso, parseBody } from '../lib/http';
import type { EpisodeRow } from '../lib/mappers';
import { mapEpisode } from '../lib/mappers';
import { requireUser, currentUser } from '../lib/session';
import { progressSchema } from '../lib/validate';

export const watchRoutes = new Hono<AppEnv>();

const COMPLETION_THRESHOLD = 0.9;
/** Ignore absurd per-beacon watch-time deltas (clock skew, seeking abuse). */
const MAX_WATCH_DELTA_S = 3_600;

interface WatchRow extends EpisodeRow {
  title_id: string;
  title_slug: string;
  title_name: string;
  title_kind: WatchPayload['title']['kind'];
  creator_id: string;
  published: number;
  creator_name: string;
  creator_handle: string;
}

async function loadEpisode(db: D1Database, episodeId: string): Promise<WatchRow | null> {
  return db
    .prepare(
      `SELECT e.id, e.season, e.episode, e.name, e.synopsis, e.video_url, e.captions_url, e.duration_s,
        t.id AS title_id, t.slug AS title_slug, t.name AS title_name, t.kind AS title_kind,
        t.creator_id, t.published,
        u.display_name AS creator_name, cp.handle AS creator_handle
       FROM episodes e
       JOIN titles t ON t.id = e.title_id
       JOIN users u ON u.id = t.creator_id
       JOIN creator_profiles cp ON cp.user_id = t.creator_id
       WHERE e.id = ?`,
    )
    .bind(episodeId)
    .first<WatchRow>();
}

/** Drafts are only watchable by their creator (Studio preview). */
function assertViewable(row: WatchRow, userId: string | null): void {
  if (row.published !== 1 && row.creator_id !== userId) {
    fail(404, 'episode_not_found', 'That episode does not exist or is not published.');
  }
}

watchRoutes.get('/:episodeId', async (c) => {
  const row = await loadEpisode(c.env.DB, c.req.param('episodeId'));
  if (!row) fail(404, 'episode_not_found', 'That episode does not exist or is not published.');
  const user = c.get('user');
  assertViewable(row, user?.id ?? null);

  const nextEpisode = await c.env.DB.prepare(
    `SELECT id, season, episode, name FROM episodes
     WHERE title_id = ? AND (season > ? OR (season = ? AND episode > ?))
     ORDER BY season, episode LIMIT 1`,
  )
    .bind(row.title_id, row.season, row.season, row.episode)
    .first<{ id: string; season: number; episode: number; name: string }>();

  let positionS = 0;
  if (user) {
    const progress = await c.env.DB.prepare(
      'SELECT position_s, completed FROM progress WHERE user_id = ? AND episode_id = ?',
    )
      .bind(user.id, row.id)
      .first<{ position_s: number; completed: number }>();
    // A completed episode restarts from the top instead of resuming at the credits.
    if (progress && progress.completed === 0) positionS = progress.position_s;
  }

  const payload: WatchPayload = {
    episode: mapEpisode(row),
    title: {
      id: row.title_id,
      slug: row.title_slug,
      name: row.title_name,
      kind: row.title_kind,
      creator: { handle: row.creator_handle, displayName: row.creator_name },
    },
    nextEpisode: nextEpisode ?? null,
    positionS,
  };
  return c.json(payload);
});

/**
 * Progress beacon: upserts resume position and maintains the title_stats
 * counters the ranking reads (plays on first beacon, completes on crossing
 * the 90% threshold, watch_seconds by clamped delta).
 */
watchRoutes.post('/:episodeId/progress', requireUser, async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, progressSchema);
  const row = await loadEpisode(c.env.DB, c.req.param('episodeId'));
  if (!row) fail(404, 'episode_not_found', 'That episode does not exist or is not published.');
  assertViewable(row, user.id);

  const positionS = Math.round(Math.min(body.positionS, body.durationS));
  const durationS = Math.round(body.durationS);
  const completedNow = durationS > 0 && positionS / durationS >= COMPLETION_THRESHOLD;

  const existing = await c.env.DB.prepare(
    'SELECT position_s, completed FROM progress WHERE user_id = ? AND episode_id = ?',
  )
    .bind(user.id, row.id)
    .first<{ position_s: number; completed: number }>();

  const isFirstBeacon = !existing;
  const newlyCompleted = completedNow && (existing?.completed ?? 0) === 0;
  const watchDelta = Math.max(0, Math.min(positionS - (existing?.position_s ?? 0), MAX_WATCH_DELTA_S));

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO progress (user_id, episode_id, position_s, duration_s, completed, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, episode_id) DO UPDATE SET
         position_s = excluded.position_s,
         duration_s = excluded.duration_s,
         completed = MAX(progress.completed, excluded.completed),
         updated_at = excluded.updated_at`,
    ).bind(user.id, row.id, positionS, durationS, completedNow ? 1 : 0, nowIso()),
    c.env.DB.prepare(
      `UPDATE title_stats SET
         plays = plays + ?,
         completes = completes + ?,
         watch_seconds = watch_seconds + ?
       WHERE title_id = ?`,
    ).bind(isFirstBeacon ? 1 : 0, newlyCompleted ? 1 : 0, watchDelta, row.title_id),
  ]);

  return c.json({ ok: true, completed: completedNow });
});
