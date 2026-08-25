import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { TranscodeJobClaim } from '@sweam/shared';
import type { AppEnv } from '../env';
import { sha256Hex } from '../lib/auth';
import { fail, nowIso, parseBody } from '../lib/http';
import { transcodeClaimSchema, transcodeCompleteSchema, transcodeFailSchema } from '../lib/validate';

/**
 * Service API for transcoder workers. The Worker is the control plane only:
 * it owns the job queue, validates outputs, and flips episodes to HLS when a
 * job lands. The data plane (ffmpeg) runs in apps/transcoder on any machine
 * with the shared TRANSCODER_TOKEN.
 *
 * Queue semantics: at-least-once. Claiming is one atomic UPDATE; attempts
 * increment on claim so a poison job stops after MAX_ATTEMPTS; a running job
 * whose claim is older than STALE_CLAIM_MINUTES is claimable again (the
 * worker died mid-job). Outputs are written under hls/{episode}/{job}/, so a
 * superseded job can never overwrite its replacement's files, and complete is
 * refused for jobs that are no longer running.
 */
export const transcodeRoutes = new Hono<AppEnv>();

const MAX_ATTEMPTS = 3;
const STALE_CLAIM_MINUTES = 15;

const OUTPUT_CONTENT_TYPES: Record<string, string> = {
  m3u8: 'application/vnd.apple.mpegurl',
  ts: 'video/mp2t',
  m4s: 'video/iso.segment',
  mp4: 'video/mp4',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

/** 100 MB per output object is far above any sane segment or playlist. */
const MAX_OUTPUT_BYTES = 100 * 1024 * 1024;

export const DEV_TRANSCODER_TOKEN = 'dev-transcoder-token';

const requireTranscoder = createMiddleware<AppEnv>(async (c, next) => {
  const configured = c.env.TRANSCODER_TOKEN;
  if (!configured) {
    fail(503, 'transcoder_disabled', 'TRANSCODER_TOKEN is not configured on this deployment.');
  }
  if (c.env.ENVIRONMENT === 'production' && configured === DEV_TRANSCODER_TOKEN) {
    fail(503, 'transcoder_misconfigured', 'Production requires a real TRANSCODER_TOKEN secret.');
  }
  const presented = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
  // Hash both sides so the comparison cost does not depend on where they differ.
  if (!presented || (await sha256Hex(presented)) !== (await sha256Hex(configured))) {
    fail(401, 'bad_service_token', 'Invalid transcoder token.');
  }
  await next();
});

transcodeRoutes.use('*', requireTranscoder);

interface JobRow {
  id: string;
  episode_id: string;
  source_url: string;
  status: string;
  attempts: number;
}

/** Enqueue a transcode for an episode, superseding any active job for it. */
export async function enqueueTranscode(
  db: D1Database,
  episodeId: string,
  sourceUrl: string,
): Promise<void> {
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `UPDATE transcode_jobs SET status = 'canceled', updated_at = ?
         WHERE episode_id = ? AND status IN ('queued', 'running')`,
      )
      .bind(now, episodeId),
    db
      .prepare(
        `INSERT INTO transcode_jobs (id, episode_id, source_url, status, attempts, created_at, updated_at)
         VALUES (?, ?, ?, 'queued', 0, ?, ?)`,
      )
      .bind(crypto.randomUUID(), episodeId, sourceUrl, now, now),
  ]);
}

transcodeRoutes.post('/claim', async (c) => {
  const body = await parseBody(c, transcodeClaimSchema);
  const staleCutoff = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString();

  const row = await c.env.DB.prepare(
    `UPDATE transcode_jobs
     SET status = 'running', claimed_by = ?, claimed_at = ?, updated_at = ?, attempts = attempts + 1
     WHERE id = (
       SELECT id FROM transcode_jobs
       WHERE attempts < ${MAX_ATTEMPTS}
         AND (status = 'queued' OR (status = 'running' AND claimed_at < ?))
       ORDER BY created_at
       LIMIT 1
     )
     RETURNING id, episode_id, source_url, attempts`,
  )
    .bind(body.workerId, nowIso(), nowIso(), staleCutoff)
    .first<JobRow>();

  if (!row) return c.json({ job: null });
  const job: TranscodeJobClaim = {
    id: row.id,
    episodeId: row.episode_id,
    sourceUrl: row.source_url,
    attempts: row.attempts,
  };
  return c.json({ job });
});

async function runningJob(db: D1Database, jobId: string): Promise<JobRow> {
  const row = await db
    .prepare('SELECT id, episode_id, source_url, status, attempts FROM transcode_jobs WHERE id = ?')
    .bind(jobId)
    .first<JobRow>();
  if (!row) fail(404, 'job_not_found', 'No such transcode job.');
  if (row.status !== 'running') {
    // A canceled/superseded job's worker should discard its work, not retry.
    fail(409, 'job_not_running', `Job is ${row.status}; discard this run's outputs.`);
  }
  return row;
}

transcodeRoutes.put('/jobs/:jobId/output/:filename', async (c) => {
  const job = await runningJob(c.env.DB, c.req.param('jobId'));
  const filename = c.req.param('filename');
  if (!/^[A-Za-z0-9_.-]+$/.test(filename)) {
    fail(400, 'bad_filename', 'Output filenames are flat: letters, numbers, dot, dash, underscore.');
  }
  const extension = filename.split('.').pop() ?? '';
  const contentType = OUTPUT_CONTENT_TYPES[extension.toLowerCase()];
  if (!contentType) {
    fail(415, 'unsupported_type', 'Outputs are HLS playlists, segments, or poster images.');
  }
  const contentLength = Number(c.req.header('content-length') ?? '0');
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    fail(411, 'length_required', 'Output uploads must include a Content-Length header.');
  }
  if (contentLength > MAX_OUTPUT_BYTES) {
    fail(413, 'too_large', 'Output objects are limited to 100 MB.');
  }
  if (!c.req.raw.body) fail(400, 'empty_body', 'Output body is empty.');

  const key = `hls/${job.episode_id}/${job.id}/${filename}`;
  await c.env.MEDIA.put(key, c.req.raw.body, { httpMetadata: { contentType } });
  return c.json({ key: `/media/${key}` }, 201);
});

transcodeRoutes.post('/jobs/:jobId/complete', async (c) => {
  const job = await runningJob(c.env.DB, c.req.param('jobId'));
  const body = await parseBody(c, transcodeCompleteSchema);

  const prefix = `hls/${job.episode_id}/${job.id}`;
  // The playlist must actually exist before the episode flips to it.
  const master = await c.env.MEDIA.head(`${prefix}/${body.master}`);
  if (!master) fail(400, 'master_missing', 'The master playlist was not uploaded to this job.');
  if (body.poster) {
    const poster = await c.env.MEDIA.head(`${prefix}/${body.poster}`);
    if (!poster) fail(400, 'poster_missing', 'The named poster was not uploaded to this job.');
  }

  const masterUrl = `/media/${prefix}/${body.master}`;
  const posterUrl = body.poster ? `/media/${prefix}/${body.poster}` : null;
  const now = nowIso();

  const statements = [
    c.env.DB.prepare(
      `UPDATE transcode_jobs SET status = 'done', error = NULL, updated_at = ? WHERE id = ?`,
    ).bind(now, job.id),
    c.env.DB.prepare(
      `UPDATE episodes SET
         video_url = ?,
         thumbnail_url = COALESCE(?, thumbnail_url),
         duration_s = CASE WHEN ? > 0 THEN ? ELSE duration_s END
       WHERE id = ?`,
    ).bind(masterUrl, posterUrl, body.durationS, body.durationS, job.episode_id),
  ];
  if (posterUrl) {
    // First generated thumbnail becomes the title poster if the creator has not set one.
    statements.push(
      c.env.DB.prepare(
        `UPDATE titles SET poster_url = COALESCE(poster_url, ?)
         WHERE id = (SELECT title_id FROM episodes WHERE id = ?)`,
      ).bind(posterUrl, job.episode_id),
    );
  }
  await c.env.DB.batch(statements);

  return c.json({ done: true, videoUrl: masterUrl });
});

transcodeRoutes.post('/jobs/:jobId/fail', async (c) => {
  const job = await runningJob(c.env.DB, c.req.param('jobId'));
  const body = await parseBody(c, transcodeFailSchema);

  const exhausted = job.attempts >= MAX_ATTEMPTS;
  await c.env.DB.prepare(
    `UPDATE transcode_jobs
     SET status = ?, error = ?, claimed_by = NULL, claimed_at = NULL, updated_at = ?
     WHERE id = ?`,
  )
    .bind(exhausted ? 'failed' : 'queued', body.error, nowIso(), job.id)
    .run();

  return c.json({ requeued: !exhausted });
});
